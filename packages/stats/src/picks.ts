import { edge as edgeOf, expectedValue } from "./odds";

/** Thresholds are config, to be tuned from the backtest (Phase 3), never by feel. */
export interface PickConfig {
  minEv: number;
  minEdge: number;
  minMatches: number;
  /** odds older than this are too stale to act on */
  maxOddsAgeHours: number;
  /** Poisson and Elo 1X2 may differ by at most this much per outcome */
  maxModelDisagreement: number;
}

export const DEFAULT_PICK_CONFIG: PickConfig = {
  minEv: 0.05,
  minEdge: 0.04,
  minMatches: 8,
  maxOddsAgeHours: 6,
  maxModelDisagreement: 0.15,
};

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface Candidate {
  market: string;
  selection: string;
  modelProb: number;
  fairProb: number;
  odds: number;
}

export interface ValueRow extends Candidate {
  edge: number;
  ev: number;
}

export interface PickContext {
  homeMatches: number;
  awayMatches: number;
  oddsAgeHours: number;
  /** largest per-outcome gap between Poisson and Elo 1X2 */
  modelGap: number;
}

const EPS = 1e-9; // keeps 0.54 - 0.50 >= 0.04 true despite floating point

export function valueRows(cands: Candidate[]): ValueRow[] {
  return cands.map((c) => ({
    ...c,
    edge: edgeOf(c.modelProb, c.fairProb),
    ev: expectedValue(c.modelProb, c.odds),
  }));
}

export function modelsAgree(gap: number, cfg: PickConfig = DEFAULT_PICK_CONFIG): boolean {
  return gap <= cfg.maxModelDisagreement + EPS;
}

/** LOW / MEDIUM / HIGH from sample size, model agreement and freshness (max 4 points). */
export function confidenceOf(ctx: PickContext, cfg: PickConfig = DEFAULT_PICK_CONFIG): Confidence {
  const n = Math.min(ctx.homeMatches, ctx.awayMatches);
  let points = 0;
  if (n >= 20) points += 2;
  else if (n >= cfg.minMatches) points += 1;
  if (modelsAgree(ctx.modelGap, cfg)) points += 1;
  if (ctx.oddsAgeHours <= 2) points += 1;
  return points >= 4 ? "HIGH" : points >= 2 ? "MEDIUM" : "LOW";
}

/**
 * Deterministic shortlist. A row passes only if EV, edge, sample, freshness and
 * model agreement ALL hold. Empty shortlist means the verdict is NO_BET.
 */
export function shortlist(
  rows: ValueRow[],
  ctx: PickContext,
  cfg: PickConfig = DEFAULT_PICK_CONFIG,
): { market: string; selection: string; odds: number; ev: number; confidence: Confidence }[] {
  const enoughData = ctx.homeMatches >= cfg.minMatches && ctx.awayMatches >= cfg.minMatches;
  const fresh = ctx.oddsAgeHours <= cfg.maxOddsAgeHours;
  if (!enoughData || !fresh || !modelsAgree(ctx.modelGap, cfg)) return [];
  const confidence = confidenceOf(ctx, cfg);
  return rows
    .filter((r) => r.ev + EPS >= cfg.minEv && r.edge + EPS >= cfg.minEdge)
    .map((r) => ({ market: r.market, selection: r.selection, odds: r.odds, ev: r.ev, confidence }));
}

export const verdictOf = (list: unknown[]): "BET_CANDIDATE" | "NO_BET" => (list.length > 0 ? "BET_CANDIDATE" : "NO_BET");
