import { parseModelJson, validateAnalysis, type Analysis, type HistorySummary, type ReportLike } from "@sports/stats";
import type { Env } from "../types";
import { AiCallError, availableProviders, callProvider } from "./providers";
import { SYSTEM_PROMPT, userPrompt } from "./prompts";

/** Calls to AI providers per UTC day. Free-tier limits are not published per model, so stay conservative. */
const AI_DAILY_LIMIT = 100;

export interface AnalysisResponse {
  provider: string;
  model: string;
  cached: boolean;
  createdAt: string;
  verdictLine: string;
  analysis: Analysis;
  /** notes about what code changed or flagged (removed recommendation, numbers not in the data, ...) */
  issues: string[];
  numberMismatches: string[];
}

export type AnalyseResult =
  | { ok: true; value: AnalysisResponse }
  | { ok: false; status: number; message: string; attempts?: string[] };

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Counted by code from the picks log: the only history the AI is allowed to talk about. */
async function historySummary(env: Env): Promise<HistorySummary> {
  const overall = await env.DB.prepare(
    `SELECT COALESCE(SUM(result = 'win'), 0) AS won, COALESCE(SUM(result = 'loss'), 0) AS lost, COALESCE(SUM(result IS NULL), 0) AS waiting FROM picks_log`,
  ).first<{ won: number; lost: number; waiting: number }>();
  const byType = await env.DB.prepare(
    `SELECT market, selection, SUM(result = 'win') AS won, SUM(result = 'loss') AS lost
     FROM picks_log WHERE result IN ('win', 'loss') GROUP BY market, selection ORDER BY market, selection`,
  ).all<{ market: string; selection: string; won: number; lost: number }>();
  return { overall: overall ?? { won: 0, lost: 0, waiting: 0 }, byType: byType.results };
}

async function loadReport(env: Env, matchId: string): Promise<{ json: string; hash: string } | null> {
  const row = await env.DB.prepare(`SELECT report_json FROM reports WHERE match_id = ?1`).bind(matchId).first<{ report_json: string }>();
  if (!row) return null;
  return { json: row.report_json, hash: await sha256(row.report_json) };
}

interface Stored {
  model: string;
  verdictLine: string;
  analysis: Analysis;
  issues: string[];
  numberMismatches: string[];
}

async function cached(env: Env, matchId: string, hash: string): Promise<AnalysisResponse | null> {
  const row = await env.DB.prepare(`SELECT provider, analysis_json, created_at FROM ai_analyses WHERE match_id = ?1 AND report_hash = ?2`)
    .bind(matchId, hash)
    .first<{ provider: string; analysis_json: string; created_at: string }>();
  if (!row) return null;
  const s = JSON.parse(row.analysis_json) as Stored;
  return { provider: row.provider, model: s.model, cached: true, createdAt: row.created_at, verdictLine: s.verdictLine, analysis: s.analysis, issues: s.issues, numberMismatches: s.numberMismatches };
}

/** Saved analysis for the CURRENT report, if there is one. Never calls an AI. */
export async function savedAnalysis(env: Env, matchId: string): Promise<AnalyseResult> {
  const report = await loadReport(env, matchId);
  if (!report) return { ok: false, status: 404, message: "No report for this game yet." };
  const hit = await cached(env, matchId, report.hash);
  return hit ? { ok: true, value: hit } : { ok: false, status: 404, message: "No analysis yet for the current report." };
}

/** Returns the saved analysis, or asks the AI providers in order, checks the answer in code, saves and returns it. */
export async function analyseMatch(env: Env, matchId: string): Promise<AnalyseResult> {
  const report = await loadReport(env, matchId);
  if (!report) return { ok: false, status: 404, message: "No report for this game yet. It is built after the data job runs." };

  const hit = await cached(env, matchId, report.hash); // the same unchanged report never costs a second AI call
  if (hit) return { ok: true, value: hit };

  const providers = availableProviders(env);
  if (providers.length === 0) return { ok: false, status: 503, message: "No AI key is set on the server." };

  const day = new Date().toISOString().slice(0, 10);
  const quotaKey = `quota:ai:${day}`;
  let used = Number((await env.KV.get(quotaKey)) ?? 0);
  if (used >= AI_DAILY_LIMIT) return { ok: false, status: 429, message: "Today's AI limit is used up. Try again tomorrow." };

  const reportObj = JSON.parse(report.json) as ReportLike;
  const history = await historySummary(env);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt(report.json, JSON.stringify(history)) },
  ];

  const attempts: string[] = [];
  for (const p of providers) {
    if (used >= AI_DAILY_LIMIT) break;
    used++;
    await env.KV.put(quotaKey, String(used), { expirationTtl: 40 * 3600 });
    try {
      const text = await callProvider(env, p, messages);
      const parsed = parseModelJson(text);
      const guard = validateAnalysis(parsed, reportObj, { report: reportObj, history });
      if (!guard.ok || !guard.analysis) {
        attempts.push(`${p.name} ${p.model}: answer rejected (${guard.issues[0] ?? "invalid"})`);
        continue; // try the next provider
      }
      const createdAt = new Date().toISOString();
      const stored: Stored = { model: p.model, verdictLine: guard.verdictLine, analysis: guard.analysis, issues: guard.issues, numberMismatches: guard.numberMismatches };
      await env.DB.prepare(
        `INSERT INTO ai_analyses (match_id, report_hash, provider, analysis_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(match_id, report_hash) DO NOTHING`,
      )
        .bind(matchId, report.hash, p.name, JSON.stringify(stored), createdAt)
        .run();
      return { ok: true, value: { provider: p.name, model: p.model, cached: false, createdAt, verdictLine: guard.verdictLine, analysis: guard.analysis, issues: guard.issues, numberMismatches: guard.numberMismatches } };
    } catch (e) {
      attempts.push(e instanceof AiCallError ? `${p.name} ${p.model}: ${e.kind}` : `${p.name} ${p.model}: failed`); // fall back to the next provider
    }
  }
  return { ok: false, status: 502, message: "No AI provider gave a usable answer. The numbers above are still correct.", attempts };
}
