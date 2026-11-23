/**
 * The AI's own research: it reads web search results (team news, injuries, form) and gives its OWN view.
 * Code checks the answer and compares that view with the model. The research never changes the model's numbers.
 */

export type ResultLean = "home" | "draw" | "away" | "unclear";
export type GoalsLean = "over" | "under" | "unclear";
export type BttsLean = "yes" | "no" | "unclear";
export type Agreement = "agree" | "disagree" | "unclear";

export interface ResearchView {
  result: ResultLean;
  goals: GoalsLean;
  btts: BttsLean;
  confidence: "low" | "medium" | "high";
  summary: string;
  keyNews: string[];
  /** numbers of the search results it used (1-based, as shown to it) */
  sources: number[];
}

export interface ModelLeans {
  p1x2: { home: number; draw: number; away: number };
  pOver25: number;
  pBttsYes: number;
}

export interface Comparison {
  result: { model: ResultLean; ai: ResultLean; verdict: Agreement };
  goals: { model: GoalsLean; ai: GoalsLean; verdict: Agreement };
  btts: { model: BttsLean; ai: BttsLean; verdict: Agreement };
  agreeCount: number;
  disagreeCount: number;
  /** true only when all three were compared and all agree */
  allAgree: boolean;
}

const CERTAINTY = /\b(guarantee[ds]?|guaranteed win|100% (?:sure|certain|safe)|certain to win|sure win|sure thing|cannot lose|can't lose|risk[- ]free|lock)\b/i;
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);

/** Checks the research answer. sourceCount = how many search results the AI was given. */
export function validateResearch(raw: unknown, sourceCount: number): { ok: boolean; view: ResearchView | null; issues: string[] } {
  const fail = (why: string) => ({ ok: false, view: null, issues: [why] });
  if (!raw || typeof raw !== "object") return fail("not a JSON object");
  const r = raw as Record<string, unknown>;
  const result = pick(r.result, ["home", "draw", "away", "unclear"] as const);
  const goals = pick(r.goals, ["over", "under", "unclear"] as const);
  const btts = pick(r.btts, ["yes", "no", "unclear"] as const);
  const confidence = pick(r.confidence, ["low", "medium", "high"] as const);
  if (!result || !goals || !btts || !confidence) return fail("result, goals, btts or confidence has a value outside the allowed list");
  if (typeof r.summary !== "string" || r.summary.trim() === "") return fail("summary missing");
  if (!Array.isArray(r.keyNews) || !r.keyNews.every((x) => typeof x === "string")) return fail("keyNews must be a list of text");

  const summary = r.summary.trim().slice(0, 1200);
  const keyNews = (r.keyNews as string[]).slice(0, 8).map((s) => s.trim().slice(0, 300)).filter(Boolean);
  if ([summary, ...keyNews].some((t) => CERTAINTY.test(t))) return fail("promised a certain result");

  const issues: string[] = [];
  const rawSources = Array.isArray(r.sources) ? r.sources : [];
  const sources = [...new Set(rawSources.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= sourceCount))];
  if (sources.length < rawSources.length) issues.push("Some source numbers did not match a search result and were dropped.");
  // Research with no source behind it is only an opinion: keep it, but it cannot be more than low confidence.
  let conf = confidence;
  if (sources.length === 0 && conf !== "low") {
    conf = "low";
    issues.push("No search result backed this view, so confidence was lowered to low by code.");
  }
  return { ok: true, view: { result, goals, btts, confidence: conf, summary, keyNews, sources }, issues };
}

/** The model's own leans, from its probabilities: the most likely result, over if P(over 2.5) >= 50%, BTTS yes if >= 50%. */
export function modelLeans(m: ModelLeans): { result: ResultLean; goals: GoalsLean; btts: BttsLean } {
  const r = m.p1x2;
  const result: ResultLean = r.home >= r.draw && r.home >= r.away ? "home" : r.away >= r.draw ? "away" : "draw";
  return { result, goals: m.pOver25 >= 0.5 ? "over" : "under", btts: m.pBttsYes >= 0.5 ? "yes" : "no" };
}

const verdict = (model: string, ai: string): Agreement => (ai === "unclear" ? "unclear" : ai === model ? "agree" : "disagree");

/** Compares the AI's research view with the model, one item at a time. */
export function compareWithModel(view: ResearchView, m: ModelLeans): Comparison {
  const lean = modelLeans(m);
  const result = { model: lean.result, ai: view.result, verdict: verdict(lean.result, view.result) };
  const goals = { model: lean.goals, ai: view.goals, verdict: verdict(lean.goals, view.goals) };
  const btts = { model: lean.btts, ai: view.btts, verdict: verdict(lean.btts, view.btts) };
  const all = [result.verdict, goals.verdict, btts.verdict];
  const agreeCount = all.filter((v) => v === "agree").length;
  const disagreeCount = all.filter((v) => v === "disagree").length;
  return { result, goals, btts, agreeCount, disagreeCount, allAgree: agreeCount === 3 };
}
