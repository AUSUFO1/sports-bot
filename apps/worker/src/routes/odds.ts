import type { Hono } from "hono";
import type { Env } from "../types";

/** Markets and selections the app understands. Anything else in an ingest request is rejected. */
const ALLOWED: Record<string, string[]> = {
  "1x2": ["home", "draw", "away"],
  ou_1_5: ["over", "under"],
  ou_2_5: ["over", "under"],
  ou_3_5: ["over", "under"],
  btts: ["yes", "no"],
};
const MONTHLY_LIMIT = 220; // OddsPapi free tier is about 250 calls a month; stop with a safety margin
const MAX_ROWS = 3000;
const KEEP_DAYS = 14;

const monthKey = (d = new Date()) => `quota:oddspapi:${d.toISOString().slice(0, 7)}`;

interface IngestBody {
  rows?: { matchId: string; bookmaker: string; market: string; selection: string; odds: number }[];
  participants?: Record<string, string>;
  calls?: number;
  note?: string;
}

export function registerOddsRoutes(app: Hono<{ Bindings: Env }>) {
  // Upcoming games the odds job should look for (small list: ids, names, kickoff).
  app.get("/api/odds/games", async (c) => {
    const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 60) || 60, 1), 240);
    const now = new Date();
    const rows = await c.env.DB.prepare(
      `SELECT m.id AS matchId, m.league_id AS leagueId, m.kickoff_utc AS kickoffUtc, ht.name AS home, at2.name AS away
       FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at2 ON at2.id = m.away_team_id
       WHERE m.status = 'scheduled' AND m.kickoff_utc > ?1 AND m.kickoff_utc <= ?2
       ORDER BY m.kickoff_utc LIMIT 400`,
    )
      .bind(now.toISOString(), new Date(now.getTime() + hours * 3600_000).toISOString())
      .all();
    return c.json(rows.results);
  });

  // What the odds job needs to know before it spends any calls: budget used and known team ids.
  app.get("/api/odds/state", async (c) => {
    const used = Number((await c.env.KV.get(monthKey())) ?? 0);
    const parts = await c.env.KV.get("op:participants");
    const last = await c.env.KV.get("lastRun:oddsIngest");
    return c.json({
      callsThisMonth: used,
      monthlyLimit: MONTHLY_LIMIT,
      participants: parts ? JSON.parse(parts) : {},
      lastIngest: last ? JSON.parse(last) : null,
    });
  });

  // Receives matched odds. Stores them, notes the call budget, and queues affected reports for a rebuild.
  app.post("/api/odds/ingest", async (c) => {
    let body: IngestBody;
    try {
      body = (await c.req.json()) as IngestBody;
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length > MAX_ROWS) return c.json({ error: `too many rows (max ${MAX_ROWS})` }, 400);

    const now = new Date().toISOString();
    const good = rows.filter(
      (r) =>
        typeof r.matchId === "string" &&
        typeof r.bookmaker === "string" && /^[a-z0-9.+_-]{2,40}$/.test(r.bookmaker) &&
        ALLOWED[r.market]?.includes(r.selection) &&
        typeof r.odds === "number" && r.odds > 1 && r.odds < 1000,
    );
    const rejected = rows.length - good.length;

    if (good.length > 0) {
      const ins = c.env.DB.prepare(
        `INSERT INTO odds_snapshots (match_id, bookmaker, market, selection, decimal_odds, captured_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM matches WHERE id = ?1)`,
      );
      for (let i = 0; i < good.length; i += 100) {
        await c.env.DB.batch(good.slice(i, i + 100).map((r) => ins.bind(r.matchId, r.bookmaker, r.market, r.selection, r.odds, now)));
      }
      // Rebuild affected reports at the next hourly run, so the new odds reach the value check.
      const ids = [...new Set(good.map((r) => r.matchId))];
      const del = c.env.DB.prepare(`DELETE FROM reports WHERE match_id = ?1`);
      await c.env.DB.batch(ids.map((id) => del.bind(id)));
    }
    await c.env.DB.prepare(`DELETE FROM odds_snapshots WHERE captured_at < ?1`)
      .bind(new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString())
      .run();

    // Budget and team-id memory.
    const calls = Math.min(Math.max(Math.floor(Number(body.calls ?? 0)) || 0, 0), 50);
    if (calls > 0) {
      const used = Number((await c.env.KV.get(monthKey())) ?? 0);
      await c.env.KV.put(monthKey(), String(used + calls), { expirationTtl: 40 * 86400 });
    }
    if (body.participants && typeof body.participants === "object") {
      const cur = JSON.parse((await c.env.KV.get("op:participants")) ?? "{}") as Record<string, string>;
      for (const [id, name] of Object.entries(body.participants)) {
        if (/^\d{1,12}$/.test(id) && typeof name === "string" && name.length < 80) cur[id] = name;
      }
      await c.env.KV.put("op:participants", JSON.stringify(cur));
    }
    const summary = { at: now, stored: good.length, rejected, matches: new Set(good.map((r) => r.matchId)).size, calls, note: body.note ?? null };
    await c.env.KV.put("lastRun:oddsIngest", JSON.stringify(summary));
    return c.json(summary);
  });
}
