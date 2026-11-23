/**
 * Top picks: which selections the model is confident enough to shortlist.
 * Thresholds are STARTING VALUES, to be tuned from the backtest (Phase 3), never by feel.
 * A "model" pick comes from the model's probability alone; a "value" pick also passes the odds rules.
 */
import { DEFAULT_PICK_CONFIG, type PickConfig } from "./picks";

export interface Target {
  market: string;
  selection: string;
  /** model probability must reach this */
  minProb: number;
  /** only if both teams are expected to score little (used for draws) */
  maxTotalXg?: number;
}

export const DEFAULT_TARGETS: Target[] = [
  { market: "1x2", selection: "home", minProb: 0.6 },
  { market: "1x2", selection: "away", minProb: 0.6 },
  { market: "1x2", selection: "draw", minProb: 0.3, maxTotalXg: 2.4 },
  { market: "ou_3_5", selection: "under", minProb: 0.8 },
  { market: "ou_2_5", selection: "under", minProb: 0.62 },
  { market: "ou_2_5", selection: "over", minProb: 0.62 },
  { market: "btts", selection: "yes", minProb: 0.6 },
  { market: "btts", selection: "no", minProb: 0.6 },
];

export interface TopPick {
  market: string;
  selection: string;
  modelProb: number;
  minProb: number;
  /** how far above its threshold the probability is (bigger = stronger) */
  strength: number;
  kind: "value" | "model";
  odds: number | null;
  ev: number | null;
  edge: number | null;
  /** true when it is fine to put on a ticket: no odds known, or the odds still give value (EV >= 0) */
  ticketOk: boolean;
  flags: string[];
}

export interface TopPickInput {
  probabilities: Record<string, Record<string, number>>;
  expectedGoals: { home: number; away: number };
  homeMatches: number;
  awayMatches: number;
  /** Poisson and Elo 1X2 agree */
  modelsAgree: boolean;
  value: { market: string; selection: string; odds: number; ev: number; edge: number }[];
  shortlisted: { market: string; selection: string }[];
}

const MAX_PER_MATCH = 2;

export function topPicks(
  input: TopPickInput,
  targets: Target[] = DEFAULT_TARGETS,
  cfg: PickConfig = DEFAULT_PICK_CONFIG,
): TopPick[] {
  // Not enough data on either side: no picks at all (never guess).
  if (Math.min(input.homeMatches, input.awayMatches) < cfg.minMatches) return [];
  const totalXg = input.expectedGoals.home + input.expectedGoals.away;
  const out: TopPick[] = [];

  for (const t of targets) {
    const p = input.probabilities[t.market]?.[t.selection];
    if (p === undefined || p < t.minProb) continue;
    if (t.maxTotalXg !== undefined && totalXg > t.maxTotalXg) continue;
    // Result picks need the Elo cross-check to agree; goal markets have no second opinion yet.
    if (t.market === "1x2" && !input.modelsAgree) continue;

    const v = input.value.find((x) => x.market === t.market && x.selection === t.selection);
    const isValue = input.shortlisted.some((s) => s.market === t.market && s.selection === t.selection);
    const flags: string[] = [];
    if (!v) flags.push("No odds yet");
    else if (v.ev < 0) flags.push("Odds too low: no value");
    out.push({
      market: t.market,
      selection: t.selection,
      modelProb: p,
      minProb: t.minProb,
      strength: p - t.minProb,
      kind: isValue ? "value" : "model",
      odds: v?.odds ?? null,
      ev: v?.ev ?? null,
      edge: v?.edge ?? null,
      ticketOk: !v || v.ev >= 0,
      flags,
    });
  }
  // One pick per type per match (result / draw / goals / btts): "under 2.5" and "under 3.5" are nearly
  // the same bet, so only the stronger one is kept. Then at most MAX_PER_MATCH picks overall.
  const typeOf = (p: TopPick) => (p.market === "btts" ? "btts" : p.market.startsWith("ou_") ? "goals" : p.selection === "draw" ? "draw" : "result");
  const seen = new Set<string>();
  const kept: TopPick[] = [];
  for (const p of out.sort((a, b) => b.strength - a.strength)) {
    const t = typeOf(p);
    if (seen.has(t)) continue;
    seen.add(t);
    kept.push(p);
  }
  return kept.slice(0, MAX_PER_MATCH);
}
