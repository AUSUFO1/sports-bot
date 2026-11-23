import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildTicket, type TicketCandidate } from "@sports/stats";
import { buildReports } from "./jobs/buildReports";
import { fetchFootballData } from "./jobs/fetchFootballData";
import { settlePicks } from "./jobs/settlePicks";
import { registerOddsRoutes } from "./routes/odds";
import { analyseMatch, savedAnalysis } from "./ai/analyse";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// The app lives on a different address (Pages), so the browser needs CORS. The token still guards every route.
app.use(
  "/api/*",
  cors({
    origin: ["https://sports-bot-web.pages.dev", "http://localhost:5173", "http://127.0.0.1:5173"],
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

// Health is public and shows no secrets. Everything else under /api needs the token.
app.get("/api/health", (c) => c.json({ ok: true, service: "sports-bot-api" }));

app.use("/api/*", async (c, next) => {
  const sent = c.req.header("Authorization") ?? "";
  const appToken = c.env.APP_TOKEN;
  const ingest = c.env.INGEST_TOKEN;
  // The app token opens everything. The ingest token opens ONLY /api/odds/*, so the GitHub odds job can never read picks.
  const ok =
    (!!appToken && sent === `Bearer ${appToken}`) ||
    (!!ingest && c.req.path.startsWith("/api/odds/") && sent === `Bearer ${ingest}`);
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  await next();
});

registerOddsRoutes(app);

// All leagues the provider lists. A league with no matches yet says "not_filled".
app.get("/api/leagues", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.name, COUNT(m.id) AS matches, MAX(m.fetched_at) AS fetched_at
     FROM leagues l LEFT JOIN matches m ON m.league_id = l.id
     WHERE l.active = 1 GROUP BY l.id ORDER BY l.name`,
  ).all<{ id: string; name: string; matches: number; fetched_at: string | null }>();
  return c.json(
    rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      matches: r.matches,
      fetchedAt: r.fetched_at,
      dataStatus: r.matches > 0 ? "ready" : "not_filled",
    })),
  );
});

app.get("/api/health/details", async (c) => {
  const fetchRun = await c.env.KV.get("lastRun:fetchFootballData");
  const reportRun = await c.env.KV.get("lastRun:buildReports");
  return c.json({
    lastFetchRun: fetchRun ? JSON.parse(fetchRun) : null,
    lastReportRun: reportRun ? JSON.parse(reportRun) : null,
  });
});

// AI analysis. Reads the saved report only; the AI explains numbers the backend already produced.
app.get("/api/games/:id/analysis", async (c) => {
  const r = await savedAnalysis(c.env, c.req.param("id"));
  return r.ok ? c.json(r.value) : c.json({ error: r.message }, r.status as 404);
});
app.post("/api/games/:id/analyse", async (c) => {
  const r = await analyseMatch(c.env, c.req.param("id"));
  return r.ok ? c.json(r.value) : c.json({ error: r.message, attempts: r.attempts ?? [] }, r.status as 404 | 429 | 502 | 503);
});

// Upcoming games with the verdict badge and data freshness. Reads saved reports only (no maths here).
// ?league=fd-PL narrows to one league; ?date=YYYY-MM-DD narrows to one day; default is the next 7 days.
app.get("/api/games", async (c) => {
  const league = c.req.query("league");
  const date = c.req.query("date");
  const from = date ? `${date}T00:00:00.000Z` : new Date(Date.now() - 3 * 3600_000).toISOString(); // include games just started
  const to = date ? `${date}T23:59:59.999Z` : new Date(Date.now() + 7 * 86400_000).toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.league_id AS leagueId, l.name AS leagueName, m.kickoff_utc AS kickoffUtc, m.status,
            ht.name AS home, at2.name AS away, ht.crest AS homeCrest, at2.crest AS awayCrest, m.fetched_at AS fixturesFetchedAt,
            r.match_id IS NOT NULL AS hasReport,
            json_extract(r.report_json, '$.verdict') AS verdict,
            json_extract(r.report_json, '$.confidence') AS confidence,
            json_extract(r.report_json, '$.dataFreshness.odds') AS oddsFetchedAt,
            json_extract(r.report_json, '$.model.probabilities."1x2".home') AS pHome,
            json_extract(r.report_json, '$.model.probabilities."1x2".draw') AS pDraw,
            json_extract(r.report_json, '$.model.probabilities."1x2".away') AS pAway,
            json_extract(r.report_json, '$.model.probabilities.ou_2_5.over') AS pOver25,
            (SELECT MAX(json_extract(v.value, '$.ev')) FROM json_each(r.report_json, '$.shortlist') v) AS bestEv
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at2 ON at2.id = m.away_team_id
     LEFT JOIN reports r ON r.match_id = m.id
     WHERE m.status IN ('scheduled', 'live') AND m.kickoff_utc >= ?1 AND m.kickoff_utc <= ?2
       AND (?3 IS NULL OR m.league_id = ?3)
     ORDER BY m.kickoff_utc, l.name LIMIT 300`,
  )
    .bind(from, to, league ?? null)
    .all();
  return c.json(rows.results.map((r) => ({ ...r, hasReport: Boolean(r.hasReport) })));
});

// Full saved report for one match (read only: no maths happens in a request).
app.get("/api/games/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT r.report_json, ht.crest AS homeCrest, at2.crest AS awayCrest
     FROM reports r JOIN matches m ON m.id = r.match_id
     JOIN teams ht ON ht.id = m.home_team_id JOIN teams at2 ON at2.id = m.away_team_id
     WHERE r.match_id = ?1`,
  )
    .bind(c.req.param("id"))
    .first<{ report_json: string; homeCrest: string | null; awayCrest: string | null }>();
  if (!row) return c.json({ error: "no report for this match yet" }, 404);
  return c.json({ ...JSON.parse(row.report_json), homeCrest: row.homeCrest, awayCrest: row.awayCrest });
});

// Top picks for upcoming games, read straight out of the saved reports (no maths in a request).
async function upcomingPicks(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT m.id AS matchId, l.name AS leagueName, m.kickoff_utc AS kickoffUtc, ht.name AS home, at2.name AS away,
            ht.crest AS homeCrest, at2.crest AS awayCrest,
            json_extract(r.report_json, '$.predictedScore') AS predictedScore,
            json_extract(r.report_json, '$.model.probabilities.ou_2_5.over') AS pOver25,
            json_extract(r.report_json, '$.confidence') AS confidence,
            json_extract(p.value, '$.market') AS market, json_extract(p.value, '$.selection') AS selection,
            json_extract(p.value, '$.modelProb') AS modelProb, json_extract(p.value, '$.strength') AS strength,
            json_extract(p.value, '$.minOdds') AS minOdds, json_extract(p.value, '$.breakEven') AS breakEven,
            json_extract(r.report_json, '$.market.byBook.pinnacle."' || json_extract(p.value, '$.market') || '"."' || json_extract(p.value, '$.selection') || '"') AS refPinnacle,
            json_extract(r.report_json, '$.market.byBook."1xbet"."' || json_extract(p.value, '$.market') || '"."' || json_extract(p.value, '$.selection') || '"') AS ref1xbet,
            json_extract(p.value, '$.kind') AS kind, json_extract(p.value, '$.odds') AS odds,
            json_extract(p.value, '$.ev') AS ev, json_extract(p.value, '$.ticketOk') AS ticketOk,
            json_extract(p.value, '$.flags') AS flags
     FROM reports r
     JOIN matches m ON m.id = r.match_id
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at2 ON at2.id = m.away_team_id
     JOIN json_each(r.report_json, '$.picks') p
     WHERE m.status = 'scheduled' AND m.kickoff_utc > ?1
     ORDER BY m.kickoff_utc, json_extract(p.value, '$.strength') DESC LIMIT 200`,
  )
    .bind(new Date().toISOString())
    .all<Record<string, unknown>>();
  return rows.results.map((r) => ({
    ...r,
    ticketOk: r.ticketOk === 1 || r.ticketOk === true,
    flags: typeof r.flags === "string" ? JSON.parse(r.flags) : [],
  }));
}

app.get("/api/picks", async (c) => c.json(await upcomingPicks(c.env)));

// Accumulator built from the safest top picks. The user places it by hand.
app.get("/api/ticket", async (c) => {
  const legs = Math.min(Math.max(Number(c.req.query("legs") ?? 4) || 4, 1), 8);
  const picks = await upcomingPicks(c.env);
  const ticket = buildTicket(picks as unknown as TicketCandidate[], legs);
  return c.json(ticket ?? { legs: [], combinedProb: 0, combinedOdds: null, ev: null });
});

// History of every logged pick, with record totals. Settled picks show the final score.
app.get("/api/history", async (c) => {
  const list = await c.env.DB.prepare(
    `SELECT p.id, p.match_id AS matchId, l.name AS leagueName, p.kickoff_utc AS kickoffUtc,
            ht.name AS home, at2.name AS away, ht.crest AS homeCrest, at2.crest AS awayCrest,
            p.market, p.selection, p.model_prob AS modelProb,
            CASE WHEN p.odds_taken > 0 THEN p.odds_taken END AS odds, p.ev, p.kind, p.confidence,
            p.pred_score AS predictedScore, p.final_score AS finalScore, p.result
     FROM picks_log p
     JOIN matches m ON m.id = p.match_id
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at2 ON at2.id = m.away_team_id
     ORDER BY p.kickoff_utc DESC LIMIT 1000`,
  ).all();
  const byMarket = await c.env.DB.prepare(
    `SELECT market, selection, SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses
     FROM picks_log WHERE result IN ('win', 'loss') GROUP BY market, selection ORDER BY market, selection`,
  ).all();
  const byBucket = await c.env.DB.prepare(
    `SELECT CAST(model_prob * 10 AS INTEGER) * 10 AS bucket, SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses
     FROM picks_log WHERE result IN ('win', 'loss') GROUP BY bucket ORDER BY bucket`,
  ).all();
  const open = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM picks_log WHERE result IS NULL`).first<{ n: number }>();
  return c.json({ picks: list.results, byMarket: byMarket.results, byBucket: byBucket.results, open: open?.n ?? 0 });
});

app.post("/api/jobs/settle", async (c) => c.json(await settlePicks(c.env)));

// Manual trigger for the owner (same job as the cron). ?max=1 keeps a test run tiny.
app.post("/api/jobs/fetch", async (c) => {
  const max = Math.min(Number(c.req.query("max") ?? 3) || 3, 3);
  return c.json(await fetchFootballData(c.env, new Date(), max));
});

app.post("/api/jobs/reports", async (c) => {
  const max = Math.min(Number(c.req.query("max") ?? 12) || 12, 60);
  return c.json(await buildReports(c.env, new Date(), max));
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 * * * *") {
      // On the hour: fetch data, then build reports and log picks, then settle finished games.
      ctx.waitUntil(
        fetchFootballData(env)
          .then(() => buildReports(env))
          .then(() => settlePicks(env)),
      );
    } else {
      // At :20 and :40: only build reports. Each trigger is its own run with its own CPU allowance,
      // so more reports get built per hour without risking the free 10 ms limit in one run.
      ctx.waitUntil(buildReports(env));
    }
  },
};
