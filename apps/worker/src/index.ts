import { Hono } from "hono";

type Env = { APP_TOKEN?: string };
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

export default app;
