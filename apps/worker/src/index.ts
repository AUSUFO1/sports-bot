import { Hono } from "hono";
import { fetchFootballData } from "./jobs/fetchFootballData";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

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
  const last = await c.env.KV.get("lastRun:fetchFootballData");
  return c.json({ lastFetchRun: last ? JSON.parse(last) : null });
});

// Manual trigger for the owner (same job as the cron). ?max=1 keeps a test run tiny.
app.post("/api/jobs/fetch", async (c) => {
  const max = Math.min(Number(c.req.query("max") ?? 3) || 3, 3);
  return c.json(await fetchFootballData(c.env, new Date(), max));
});

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(fetchFootballData(env));
  },
};
