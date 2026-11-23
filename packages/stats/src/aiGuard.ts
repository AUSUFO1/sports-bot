/**
 * Checks every AI answer before anyone sees it. The AI only explains; the backend's report is the truth.
 * Pure functions, no network. Rules (PROJECT.md section 9.2):
 *  - the answer must match the schema, or it is rejected (the caller tries the next provider)
 *  - a recommendation must exist in the report's shortlist, or the answer is rejected
 *  - if the verdict is NO_BET, code removes any recommendation (the code wins over the AI)
 *  - the AI may only advise SKIPPING picks that exist; it can never add one
 *  - every number in its text is checked against the report and history; mismatches are flagged
 *  - words that promise certainty reject the answer
 */

export interface Analysis {
  summary: string;
  keyFactors: string[];
  risks: string[];
  recommendation: { market: string; selection: string } | null;
  /** picks the AI advises against. Downgrade only: it can never add or upgrade a pick. */
  skip: { market: string; selection: string; reason: string }[];
  reasoning: string;
}

export interface ReportLike {
  verdict: "BET_CANDIDATE" | "NO_BET";
  shortlist: { market: string; selection: string }[];
  picks?: { market: string; selection: string }[];
  /** when the odds were captured; null means no bookmaker odds yet */
  dataFreshness?: { odds: string | null };
}

/** What the AI is allowed to know about past results. Computed in code from the picks log. */
export interface HistorySummary {
  overall: { won: number; lost: number; waiting: number };
  byType: { market: string; selection: string; won: number; lost: number }[];
}

export interface GuardResult {
  ok: boolean;
  /** why the answer was rejected, or notes about what code changed */
  issues: string[];
  analysis: Analysis | null;
  /** numbers the AI quoted that are not in the report or history */
  numberMismatches: string[];
  /** written by code, never by the AI */
  verdictLine: string;
}

const MAX_TEXT = 1500;
const MAX_LIST = 8;
const MAX_ITEM = 400;
// Words that promise a result. Any of these rejects the answer.
const CERTAINTY = /\b(guarantee[ds]?|guaranteed win|100% (?:sure|certain|safe)|certain to win|sure win|sure thing|cannot lose|can't lose|risk[- ]free|lock)\b/i;

export const VERDICT_LINES = {
  NO_ODDS: "Odds pending: the picks are the model's view; value cannot be checked until bookmaker odds arrive.",
  NO_BET: "No value at the current odds: the model has a view, but the price is too low to be worth it.",
  BET_CANDIDATE: "Value found: the odds pay more than the model thinks is fair. Still an estimate, not a promise.",
} as const;

/** The verdict line is written by code: value found, no value at these odds, or odds not in yet. */
export function verdictLineFor(report: ReportLike): string {
  if (report.verdict === "BET_CANDIDATE") return VERDICT_LINES.BET_CANDIDATE;
  return report.dataFreshness?.odds ? VERDICT_LINES.NO_BET : VERDICT_LINES.NO_ODDS;
}

/** Pulls the first JSON object out of a model reply, tolerating ``` fences and chatter around it. */
export function parseModelJson(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Every number that appears anywhere in the data, including digits inside strings (dates, club names). */
export function collectNumbers(data: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof data === "number" && Number.isFinite(data)) into.add(data);
  else if (typeof data === "string") {
    for (const m of data.matchAll(/\d+(?:\.\d+)?/g)) into.add(Number(m[0]));
    // A market name like "ou_2_5" means the 2.5 goals line, so 2.5 is a real figure in the data.
    for (const m of data.matchAll(/ou_(\d)_(\d)/g)) into.add(Number(`${m[1]}.${m[2]}`));
  } else if (Array.isArray(data)) for (const x of data) collectNumbers(x, into);
  else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      collectNumbers(k, into); // keys carry the market lines too (probabilities.ou_2_5)
      collectNumbers(v, into);
    }
  }
  return into;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** True when a number in the AI's text is explained by the data: as-is, as a percentage, or a small count. */
export function numberIsKnown(token: string, allowed: Set<number>): boolean {
  const x = Number(token);
  if (!Number.isFinite(x)) return true;
  const d = token.includes(".") ? token.split(".")[1]!.length : 0;
  if (Number.isInteger(x) && x >= 0 && x <= 10) return true; // small counts and score digits
  for (const v of allowed) {
    if (Math.abs(round(v, d) - x) < 1e-9) return true; // 2.42 vs 2.4243
    if (Math.abs(round(v * 100, d) - x) < 1e-9) return true; // 67.6 vs 0.676
  }
  return false;
}

/** Numbers quoted in text that the data does not explain. Percent signs and thousands commas are ignored. */
export function findNumberMismatches(texts: string[], allowed: Set<number>): string[] {
  const bad = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) {
      if (!numberIsKnown(m[0], allowed)) bad.add(m[0]);
    }
  }
  return [...bad];
}

const isStr = (v: unknown): v is string => typeof v === "string";
const clean = (s: string, max: number) => s.trim().slice(0, max);

export function validateAnalysis(raw: unknown, report: ReportLike, data: { report: unknown; history: HistorySummary }): GuardResult {
  const verdictLine = verdictLineFor(report);
  const reject = (issue: string): GuardResult => ({ ok: false, issues: [issue], analysis: null, numberMismatches: [], verdictLine });
  const issues: string[] = [];

  if (!raw || typeof raw !== "object") return reject("not a JSON object");
  const r = raw as Record<string, unknown>;
  if (!isStr(r.summary) || r.summary.trim().length === 0) return reject("summary missing");
  if (!isStr(r.reasoning)) return reject("reasoning missing");
  if (!Array.isArray(r.keyFactors) || !r.keyFactors.every(isStr)) return reject("keyFactors must be a list of text");
  if (!Array.isArray(r.risks) || !r.risks.every(isStr)) return reject("risks must be a list of text");
  if (r.recommendation !== null && r.recommendation !== undefined) {
    const rec = r.recommendation as Record<string, unknown>;
    if (typeof rec !== "object" || !isStr(rec.market) || !isStr(rec.selection)) return reject("recommendation has the wrong shape");
  }

  const analysis: Analysis = {
    summary: clean(r.summary, MAX_TEXT),
    reasoning: clean(r.reasoning, MAX_TEXT),
    keyFactors: (r.keyFactors as string[]).slice(0, MAX_LIST).map((s) => clean(s, MAX_ITEM)),
    risks: (r.risks as string[]).slice(0, MAX_LIST).map((s) => clean(s, MAX_ITEM)),
    recommendation: null,
    skip: [],
  };

  // Certainty language is never allowed.
  const allText = [analysis.summary, analysis.reasoning, ...analysis.keyFactors, ...analysis.risks];
  if (allText.some((t) => CERTAINTY.test(t))) return reject("promised a certain result");

  // Recommendation: must be in the shortlist. NO_BET overrides everything.
  const rec = r.recommendation as { market: string; selection: string } | null | undefined;
  if (rec) {
    const inShortlist = report.shortlist.some((s) => s.market === rec.market && s.selection === rec.selection);
    if (report.verdict === "NO_BET") {
      issues.push("No value was found at these odds, so the recommendation was removed by code.");
    } else if (!inShortlist) {
      return reject("recommended a selection that is not in the shortlist");
    } else {
      analysis.recommendation = { market: rec.market, selection: rec.selection };
    }
  }

  // Skip advice: only for picks that exist. Anything else is dropped.
  if (Array.isArray(r.skip)) {
    for (const s of r.skip as Record<string, unknown>[]) {
      if (!s || !isStr(s.market) || !isStr(s.selection)) continue;
      const exists = (report.picks ?? []).some((p) => p.market === s.market && p.selection === s.selection);
      if (!exists) {
        issues.push(`Skip advice for ${s.market} ${s.selection} was dropped: that pick does not exist.`);
        continue;
      }
      const reason = isStr(s.reason) ? clean(s.reason, MAX_ITEM) : "";
      analysis.skip.push({ market: s.market, selection: s.selection, reason });
    }
  }

  // Numbers: every figure the AI quotes should come from the report or the history.
  const allowed = collectNumbers(data.report);
  collectNumbers(data.history, allowed);
  const numberMismatches = findNumberMismatches([...allText, ...analysis.skip.map((s) => s.reason)], allowed);
  if (numberMismatches.length > 0) issues.push(`The AI quoted numbers that are not in the data: ${numberMismatches.join(", ")}.`);

  return { ok: true, issues, analysis, numberMismatches, verdictLine };
}
