import type { Env } from "./types";

/**
 * Health: what last ran, whether it worked, and why not. Only names, times and short reasons are kept, never key values.
 */

export type ServiceName = "research_search" | "research_ai" | "analysis_ai";

export interface ServiceEvent {
  at: string;
  ok: boolean;
  detail: string;
  attempts?: string[];
}

/** Remember the last result of a live service call (one KV write; kept 14 days). */
export async function recordService(env: Env, name: ServiceName, ok: boolean, detail: string, attempts?: string[]) {
  const ev: ServiceEvent = { at: new Date().toISOString(), ok, detail: detail.slice(0, 200), ...(attempts?.length ? { attempts: attempts.slice(0, 10) } : {}) };
  try {
    await env.KV.put(`health:${name}`, JSON.stringify(ev), { expirationTtl: 14 * 86400 });
    if (!ok) await env.KV.put(`health:${name}:lastFail`, JSON.stringify(ev), { expirationTtl: 14 * 86400 });
  } catch {
    // health logging must never break the real request
  }
}

const KEY_NAMES = ["APP_TOKEN", "FOOTBALL_DATA_KEY", "INGEST_TOKEN", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "TAVILY_API_KEY"] as const;

/** How old a job run may be before it counts as late (minutes). */
const JOBS: { key: string; label: string; lateAfterMin: number }[] = [
  { key: "lastRun:fetchFootballData", label: "Fixtures and results (hourly)", lateAfterMin: 130 },
  { key: "lastRun:buildReports", label: "Model reports (every 20 min)", lateAfterMin: 70 },
  { key: "lastRun:settlePicks", label: "Settle finished picks (hourly)", lateAfterMin: 130 },
  { key: "lastRun:oddsIngest", label: "Odds from GitHub (twice a day)", lateAfterMin: 15 * 60 },
];

const SERVICES: { name: ServiceName; label: string }[] = [
  { name: "analysis_ai", label: "AI analysis" },
  { name: "research_search", label: "Web search (Tavily)" },
  { name: "research_ai", label: "AI research answer" },
];

const parse = <T,>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

type JobRun = Record<string, unknown> & { at?: string; error?: string; failed?: number };

export async function healthDetails(env: Env, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);

  const jobs = await Promise.all(
    JOBS.map(async (j) => {
      const run = parse<JobRun>(await env.KV.get(j.key));
      const ageMin = run?.at ? (now.getTime() - Date.parse(run.at)) / 60000 : null;
      const problem = !run
        ? "Never ran"
        : run.error
          ? String(run.error)
          : ageMin !== null && ageMin > j.lateAfterMin
            ? "Late: has not run when expected"
            : typeof run.failed === "number" && run.failed > 0
              ? `${run.failed} failed`
              : null;
      return { label: j.label, ok: problem === null, problem, at: run?.at ?? null, summary: run };
    }),
  );

  const services = await Promise.all(
    SERVICES.map(async (s) => ({
      label: s.label,
      last: parse<ServiceEvent>(await env.KV.get(`health:${s.name}`)),
      lastFail: parse<ServiceEvent>(await env.KV.get(`health:${s.name}:lastFail`)),
    })),
  );

  // Names only: true/false for "is it set". Values are never read out.
  const keys = KEY_NAMES.map((name) => ({ name, set: !!env[name] }));

  const [aiUsed, researchUsed, oddsUsed] = await Promise.all([
    env.KV.get(`quota:ai:${day}`),
    env.KV.get(`quota:research:${day}`),
    env.KV.get(`quota:oddspapi:${month}`),
  ]);

  let database = true;
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    database = false;
  }

  return {
    checkedAt: now.toISOString(),
    database,
    jobs,
    services,
    keys,
    usage: {
      aiToday: Number(aiUsed ?? 0),
      researchToday: Number(researchUsed ?? 0),
      aiDailyLimit: 100,
      researchDailyLimit: 15,
      oddsCallsThisMonth: Number(oddsUsed ?? 0),
      oddsMonthlyLimit: 220,
    },
  };
}
