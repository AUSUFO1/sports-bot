import { compareWithModel, parseModelJson, validateResearch, type Comparison, type ResearchView } from "@sports/stats";
import type { Env } from "../types";
import { AiCallError, availableProviders, callProvider } from "./providers";
import { recordService } from "../health";

/**
 * The AI's own research. Tavily searches the web for team news; the AI reads ONLY those results and gives its own view;
 * code checks the answer and compares it with the model. Nothing here changes the model's numbers or picks.
 */

const RESEARCH_DAILY_LIMIT = 15; // each run uses 2 Tavily searches; the free plan is 1,000 a month
const MAX_SOURCES = 8;
const SNIPPET_CHARS = 600;

export interface ResearchResponse {
  provider: string;
  model: string;
  cached: boolean;
  createdAt: string;
  view: ResearchView;
  sources: { n: number; title: string; url: string }[];
  comparison: Comparison;
  issues: string[];
}
export type ResearchResult = { ok: true; value: ResearchResponse } | { ok: false; status: number; message: string; attempts?: string[] };

const SYSTEM = `You are a football analyst doing your OWN research for one match, for a non-expert reader.
You get a numbered list of web search results. Use ONLY what those results say. Never invent injuries, suspensions, lineups, form or quotes.
If the results do not cover something, say so and use "unclear". Web results can be old or wrong: prefer the most recent, and mention doubt.
Give your own independent view; do not try to agree with any model.
Never say a result is certain, guaranteed, safe or risk free. Write short, plain sentences.
Return ONLY JSON:
{"result": "home"|"draw"|"away"|"unclear", "goals": "over"|"under"|"unclear", "btts": "yes"|"no"|"unclear",
 "confidence": "low"|"medium"|"high", "summary": string, "keyNews": string[], "sources": number[]}
"goals" means over or under 2.5 goals. "sources" lists the numbers of the results you actually used.`;

interface TavilyHit {
  title: string;
  url: string;
  content: string;
}

async function tavily(env: Env, query: string): Promise<TavilyHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic", topic: "news", days: 10 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`search answered ${res.status}`);
  const body = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (body.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({ title: String(r.title), url: String(r.url), content: String(r.content ?? "").slice(0, SNIPPET_CHARS) }));
}

interface Stored {
  model: string;
  view: ResearchView;
  sources: { n: number; title: string; url: string }[];
  issues: string[];
}

interface ReportBits {
  home: string;
  away: string;
  league: string;
  kickoffUtc: string;
  model: { probabilities: Record<string, Record<string, number>> } | null;
}

const cacheKey = (day: string) => `research:${day}`; // research is refreshed once per UTC day per game

async function loadReport(env: Env, matchId: string): Promise<ReportBits | null> {
  const row = await env.DB.prepare(`SELECT report_json FROM reports WHERE match_id = ?1`).bind(matchId).first<{ report_json: string }>();
  return row ? (JSON.parse(row.report_json) as ReportBits) : null;
}

function leansFrom(r: ReportBits) {
  const p = r.model?.probabilities;
  if (!p?.["1x2"] || !p.ou_2_5 || !p.btts) return null;
  return {
    p1x2: { home: p["1x2"].home ?? 0, draw: p["1x2"].draw ?? 0, away: p["1x2"].away ?? 0 },
    pOver25: p.ou_2_5.over ?? 0,
    pBttsYes: p.btts.yes ?? 0,
  };
}

async function fromCache(env: Env, matchId: string, day: string, r: ReportBits): Promise<ResearchResponse | null> {
  const row = await env.DB.prepare(`SELECT provider, analysis_json, created_at FROM ai_analyses WHERE match_id = ?1 AND report_hash = ?2`)
    .bind(matchId, cacheKey(day))
    .first<{ provider: string; analysis_json: string; created_at: string }>();
  const leans = leansFrom(r);
  if (!row || !leans) return null;
  const s = JSON.parse(row.analysis_json) as Stored;
  // The comparison is always redone against the CURRENT model numbers.
  return { provider: row.provider, model: s.model, cached: true, createdAt: row.created_at, view: s.view, sources: s.sources, comparison: compareWithModel(s.view, leans), issues: s.issues };
}

export async function savedResearch(env: Env, matchId: string): Promise<ResearchResult> {
  const r = await loadReport(env, matchId);
  if (!r) return { ok: false, status: 404, message: "No report for this game yet." };
  const hit = await fromCache(env, matchId, new Date().toISOString().slice(0, 10), r);
  return hit ? { ok: true, value: hit } : { ok: false, status: 404, message: "No research yet today." };
}

export async function researchMatch(env: Env, matchId: string): Promise<ResearchResult> {
  const r = await loadReport(env, matchId);
  if (!r) return { ok: false, status: 404, message: "No report for this game yet. It is built after the data job runs." };
  const leans = leansFrom(r);
  if (!leans) return { ok: false, status: 409, message: "The model has no numbers for this game, so there is nothing to compare with." };
  if (!env.TAVILY_API_KEY) return { ok: false, status: 503, message: "Web search is not set up on the server (TAVILY_API_KEY)." };

  const day = new Date().toISOString().slice(0, 10);
  const hit = await fromCache(env, matchId, day, r); // one research per game per day
  if (hit) return { ok: true, value: hit };

  const quotaKey = `quota:research:${day}`;
  const used = Number((await env.KV.get(quotaKey)) ?? 0);
  if (used >= RESEARCH_DAILY_LIMIT) return { ok: false, status: 429, message: "Today's research limit is used up. Try again tomorrow." };
  await env.KV.put(quotaKey, String(used + 1), { expirationTtl: 40 * 3600 });

  // 1) Search: team news and a match preview. Only team names and the date are sent, never anything personal.
  let hits: TavilyHit[];
  try {
    const date = r.kickoffUtc.slice(0, 10);
    const [a, b] = await Promise.all([
      tavily(env, `${r.home} vs ${r.away} team news injuries suspensions ${date}`),
      tavily(env, `${r.home} vs ${r.away} preview form prediction`),
    ]);
    const seen = new Set<string>();
    hits = [...a, ...b].filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).slice(0, MAX_SOURCES);
  } catch (e) {
    await recordService(env, "research_search", false, e instanceof Error ? e.message : "search failed");
    return { ok: false, status: 502, message: "The web search did not answer. Try again in a minute." };
  }
  await recordService(env, "research_search", true, `${hits.length} results`);
  if (hits.length === 0) return { ok: false, status: 404, message: "The web search found nothing recent about this game." };

  const list = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${h.content}`).join("\n\n");
  const user = `Match: ${r.home} (home) vs ${r.away} (away), ${r.league}, kickoff ${r.kickoffUtc} (UTC).\n\nSEARCH RESULTS:\n${list}\n\nWrite the JSON now.`;
  const messages = [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: user },
  ];

  // 2) The AI reads only those results. Providers are tried in order; a bad or busy answer moves to the next.
  const attempts: string[] = [];
  for (const p of availableProviders(env)) {
    try {
      const text = await callProvider(env, p, messages);
      const checked = validateResearch(parseModelJson(text), hits.length);
      if (!checked.ok || !checked.view) {
        attempts.push(`${p.name} ${p.model}: answer rejected (${checked.issues[0] ?? "invalid"})`);
        continue;
      }
      const sources = checked.view.sources.map((n) => ({ n, title: hits[n - 1]!.title, url: hits[n - 1]!.url }));
      const createdAt = new Date().toISOString();
      const stored: Stored = { model: p.model, view: checked.view, sources, issues: checked.issues };
      await env.DB.prepare(
        `INSERT INTO ai_analyses (match_id, report_hash, provider, analysis_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(match_id, report_hash) DO NOTHING`,
      )
        .bind(matchId, cacheKey(day), p.name, JSON.stringify(stored), createdAt)
        .run();
      await recordService(env, "research_ai", true, `${p.name} ${p.model} answered`, attempts);
      return {
        ok: true,
        value: { provider: p.name, model: p.model, cached: false, createdAt, view: checked.view, sources, comparison: compareWithModel(checked.view, leans), issues: checked.issues },
      };
    } catch (e) {
      attempts.push(e instanceof AiCallError ? `${p.name} ${p.model}: ${e.kind}` : `${p.name} ${p.model}: failed`);
    }
  }
  await recordService(env, "research_ai", false, attempts.length ? "every AI model failed" : "no AI key set", attempts);
  return { ok: false, status: 502, message: "No AI gave a usable research answer. Try again in a few minutes.", attempts };
}
