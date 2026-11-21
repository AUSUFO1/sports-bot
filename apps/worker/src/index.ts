import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildReports } from "./jobs/buildReports";
import { fetchFootballData } from "./jobs/fetchFootballData";
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
  const token = c.env.APP_TOKEN;
  if (!token || c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

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

// Upcoming games with the verdict badge and data freshness. Reads saved reports only (no maths here).
// ?league=fd-PL narrows to one league; ?date=YYYY-MM-DD narrows to one day; default is the next 7 days.
app.get("/api/games", async (c) => {
  const league = c.req.query("league");
  const date = c.req.query("date");
  const from = date ? `${date}T00:00:00.000Z` : new Date(Date.now() - 3 * 3600_000).toISOString(); // include games just started
  const to = date ? `${date}T23:59:59.999Z` : new Date(Date.now() + 7 * 86400_000).toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.league_id AS leagueId, l.name AS leagueName, m.kickoff_utc AS kickoffUtc, m.status,
            ht.name AS home, at2.name AS away, m.fetched_at AS fixturesFetchedAt,
            r.match_id IS NOT NULL AS hasReport,
            json_extract(r.report_json, '$.verdict') AS verdict,
            json_extract(r.report_json, '$.confidence') AS confidence,
            json_extract(r.report_json, '$.dataFreshness.odds') AS oddsFetchedAt,
            json_extract(r.report_json, '$.model.probabilities."1x2".home') AS pHome,
            json_extract(r.report_json, '$.model.probabilities."1x2".draw') AS pDraw,
            json_extract(r.report_json, '$.model.probabilities."1x2".away') AS pAway,
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
  const row = await c.env.DB.prepare(`SELECT report_json FROM reports WHERE match_id = ?1`)
    .bind(c.req.param("id"))
    .first<{ report_json: string }>();
  if (!row) return c.json({ error: "no report for this match yet" }, 404);
  return c.json(JSON.parse(row.report_json));
});

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
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Fetch first, then build reports from what is now stored.
    ctx.waitUntil(fetchFootballData(env).then(() => buildReports(env)));
  },
};
