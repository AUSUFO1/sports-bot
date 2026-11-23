import { removeMargin } from "./odds";
import { topPicks, type TopPick } from "./targets";
import { buildEloRatings, eloExpected, eloOneXTwo, ELO_START } from "./elo";
import { btts, oneXTwo, overUnder, topScorelines } from "./markets";
import { computeLambdas, scoreMatrix, type PastMatch } from "./poisson";
import {
  confidenceOf,
  DEFAULT_PICK_CONFIG,
  modelsAgree,
  suspiciousEdge,
  shortlist,
  valueRows,
  verdictOf,
  type Candidate,
  type PickConfig,
  type ValueRow,
} from "./picks";

export const MODEL_VERSION = "poisson-dc-v2";

/** Model settings chosen by the backtest (scripts/backtest.mjs), never by feel. */
export interface ModelTuning {
  /** Dixon-Coles low-score correction; 0 = plain Poisson */
  rho: number;
  /**
   * Share of the final probability that comes from our model; the rest is Pinnacle's fair price.
   * 1 = model only. Used only where Pinnacle prices the whole market.
   */
  modelWeight: number;
}

// Backtest 2026-11-23 (3,654 games, 5 leagues, 2023-26): Pinnacle alone had the lowest log loss; every share of the
// model made it worse, and value picks lost about 10% per bet. So Pinnacle leads; rho only shapes the model fallback.
export const DEFAULT_TUNING: ModelTuning = { rho: -0.15, modelWeight: 0 };
/** The sharp bookmaker whose prices define the "fair" market probability. */
export const REFERENCE_BOOK = "pinnacle";

/** One bookmaker price. Callers pass the LATEST price per bookmaker, market and selection. */
export interface OddsInput {
  bookmaker: string;
  market: string; // 1x2 | ou_1_5 | ou_2_5 | ou_3_5 | btts
  selection: string; // home|draw|away|over|under|yes|no
  decimalOdds: number;
  capturedAt: string;
}

export interface ReportInput {
  matchId: string;
  league: string;
  kickoffUtc: string;
  home: string;
  away: string;
  /** finished league matches; anything at or after kickoff is ignored (no leakage) */
  history: PastMatch[];
  odds: OddsInput[];
  fixturesFetchedAt: string;
  /** "now", ISO string; passed in so the function stays pure */
  now: string;
  config?: PickConfig;
  tuning?: ModelTuning;
}

const MARKETS: Record<string, string[]> = {
  "1x2": ["home", "draw", "away"],
  ou_1_5: ["over", "under"],
  ou_2_5: ["over", "under"],
  ou_3_5: ["over", "under"],
  btts: ["yes", "no"],
};

type Probs = Record<string, number>;

export interface Report {
  matchId: string;
  league: string;
  kickoffUtc: string;
  home: string;
  away: string;
  dataFreshness: { fixtures: string; odds: string | null };
  sample: { homeMatches: number; awayMatches: number };
  model: {
    version: string;
    expectedGoals: { home: number; away: number };
    /** final probabilities: the model blended with Pinnacle's fair price where Pinnacle priced the market */
    probabilities: Record<string, Probs>;
    /** the model on its own, before the blend */
    rawProbabilities?: Record<string, Probs>;
    /** how the final numbers were made; absent on reports from before this was added */
    tuning?: ModelTuning & { blendedMarkets: string[] };
    topScorelines: { score: string; prob: number }[];
    eloCheck: { home: number; draw: number; away: number; agrees: boolean };
  } | null;
  market: {
    /** the prices used for value: Pinnacle's when it prices the whole market, else the best across books */
    bestOdds: Record<string, Probs>;
    fairProbabilities: Record<string, Probs>;
    marginByMarket: Record<string, number>;
    /** every bookmaker's price: byBook[slug][market][selection] */
    byBook: Record<string, Record<string, Probs>>;
  };
  value: { market: string; selection: string; modelProb: number; fairProb: number; edge: number; odds: number; ev: number }[];
  shortlist: { market: string; selection: string; odds: number; ev: number; confidence: "LOW" | "MEDIUM" | "HIGH" }[];
  verdict: "BET_CANDIDATE" | "NO_BET";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  /** the model's most likely scoreline, kept so the tracker can compare it to the final score */
  predictedScore: string | null;
  /** top picks: the selections the model is confident enough to shortlist (see targets.ts) */
  picks: TopPick[];
  warnings: string[];
}

const HOUR = 3_600_000;

/** Builds the section 8 report. Pure: same input, same output. Never fills a gap with a guess. */
export function buildReport(input: ReportInput): Report {
  const cfg = input.config ?? DEFAULT_PICK_CONFIG;
  const tuning = input.tuning ?? DEFAULT_TUNING;
  const now = Date.parse(input.now);
  const warnings: string[] = [];
  const emptyMarket = { bestOdds: {}, fairProbabilities: {}, marginByMarket: {}, byBook: {} };
  const base = {
    matchId: input.matchId,
    league: input.league,
    kickoffUtc: input.kickoffUtc,
    home: input.home,
    away: input.away,
  };

  const fixturesAgeH = (now - Date.parse(input.fixturesFetchedAt)) / HOUR;
  if (fixturesAgeH > 24) warnings.push(`Fixture data is ${Math.round(fixturesAgeH)} hours old`);

  const lam = computeLambdas(input.history, input.home, input.away, input.kickoffUtc);
  if (!lam) {
    warnings.push("No past results available, so no model was run");
    return {
      ...base,
      dataFreshness: { fixtures: input.fixturesFetchedAt, odds: null },
      sample: { homeMatches: 0, awayMatches: 0 },
      model: null,
      market: emptyMarket,
      value: [],
      shortlist: [],
      verdict: "NO_BET",
      confidence: "LOW",
      predictedScore: null,
      picks: [],
      warnings,
    };
  }

  // Model probabilities from the Poisson score matrix.
  const matrix = scoreMatrix(lam.lambdaHome, lam.lambdaAway, 10, tuning.rho);
  const probabilities: Record<string, Probs> = {
    "1x2": { ...oneXTwo(matrix) },
    ou_1_5: { ...overUnder(matrix, 1.5) },
    ou_2_5: { ...overUnder(matrix, 2.5) },
    ou_3_5: { ...overUnder(matrix, 3.5) },
    btts: { ...btts(matrix) },
  };

  // Elo sanity check on 1X2.
  const ratings = buildEloRatings(input.history, input.kickoffUtc);
  const e = eloExpected(ratings[input.home] ?? ELO_START, ratings[input.away] ?? ELO_START);
  const elo = eloOneXTwo(e);
  const p1 = probabilities["1x2"]!;
  const modelGap = Math.max(Math.abs(elo.home - p1.home!), Math.abs(elo.draw - p1.draw!), Math.abs(elo.away - p1.away!));
  const agrees = modelsAgree(modelGap, cfg);
  if (!agrees) warnings.push(`Poisson and Elo disagree strongly (largest gap ${(modelGap * 100).toFixed(0)} points)`);

  if (Math.min(lam.homeMatches, lam.awayMatches) < cfg.minMatches) {
    warnings.push(`Low sample: ${lam.homeMatches} home-side and ${lam.awayMatches} away-side matches (need ${cfg.minMatches})`);
  }

  // Keep the model's own numbers before any blending (deep copy).
  const raw: Record<string, Probs> = Object.fromEntries(Object.entries(probabilities).map(([k, v]) => [k, { ...v }]));
  const blendedMarkets: string[] = [];

  // Market side: best odds per selection, margin removed per market.
  const bestOdds: Record<string, Probs> = {};
  const fair: Record<string, Probs> = {};
  const margins: Record<string, number> = {};
  const books: Record<string, Set<string>> = {};
  const byBook: Record<string, Record<string, Probs>> = {};
  const candidates: Candidate[] = [];
  let oldest = Infinity;
  let newest = -Infinity;

  for (const [market, selections] of Object.entries(MARKETS)) {
    const rows = input.odds.filter((o) => o.market === market && selections.includes(o.selection) && o.decimalOdds > 1);
    if (rows.length === 0) continue;
    const best: Probs = {};
    const ref: Probs = {};
    for (const r of rows) {
      best[r.selection] = Math.max(best[r.selection] ?? 0, r.decimalOdds);
      if (r.bookmaker === REFERENCE_BOOK) ref[r.selection] = r.decimalOdds;
      ((byBook[r.bookmaker] ??= {})[market] ??= {})[r.selection] = r.decimalOdds;
      (books[market] ??= new Set()).add(r.bookmaker);
      const t = Date.parse(r.capturedAt);
      oldest = Math.min(oldest, t);
      newest = Math.max(newest, t);
    }
    if (!selections.every((s) => best[s] !== undefined)) {
      warnings.push(`Market ${market} is missing a selection, so it was skipped`);
      continue;
    }
    // The sharp reference book (Pinnacle) sets the fair price when it prices the whole market.
    // Otherwise fall back to the best price across the bookmakers we have.
    const useRef = selections.every((s) => ref[s] !== undefined);
    const priced = useRef ? ref : best;
    const { fair: f, margin } = removeMargin(selections.map((s) => priced[s]!));
    bestOdds[market] = priced;
    fair[market] = Object.fromEntries(selections.map((s, i) => [s, f[i]!]));
    margins[market] = margin;
    if (!useRef && books[market]!.size === 1) warnings.push(`Only 1 bookmaker priced ${market}`);
    // Blend with the sharp price. Only Pinnacle is trusted for this; a soft book's price is not a good anchor.
    if (useRef && tuning.modelWeight < 1) {
      const w = Math.max(0, Math.min(1, tuning.modelWeight));
      for (const s of selections) probabilities[market]![s] = w * raw[market]![s]! + (1 - w) * fair[market]![s]!;
      blendedMarkets.push(market);
    }
    for (const s of selections) {
      candidates.push({ market, selection: s, modelProb: probabilities[market]![s]!, fairProb: fair[market]![s]!, odds: priced[s]! });
    }
  }

  const hasOdds = candidates.length > 0;
  if (!hasOdds) warnings.push("No bookmaker odds available, so no value check was possible");
  const oddsAgeHours = hasOdds ? (now - oldest) / HOUR : Infinity;
  if (hasOdds && oddsAgeHours > cfg.maxOddsAgeHours) warnings.push(`Odds are ${Math.round(oddsAgeHours)} hours old`);

  const value: ValueRow[] = valueRows(candidates);
  const far = value.filter((v) => suspiciousEdge(v.edge, cfg)).sort((a, b) => b.edge - a.edge).slice(0, 3);
  for (const v of far) {
    warnings.push(
      `Model is ${(v.edge * 100).toFixed(0)} points above the market on ${v.market} ${v.selection}: more likely a model error than value`,
    );
  }
  const ctx = { homeMatches: lam.homeMatches, awayMatches: lam.awayMatches, oddsAgeHours, modelGap };
  const list = hasOdds ? shortlist(value, ctx, cfg) : [];
  const picks = topPicks(
    {
      probabilities,
      expectedGoals: { home: lam.lambdaHome, away: lam.lambdaAway },
      homeMatches: lam.homeMatches,
      awayMatches: lam.awayMatches,
      modelsAgree: agrees,
      value,
      shortlisted: list,
    },
    undefined,
    cfg,
  );

  return {
    ...base,
    dataFreshness: { fixtures: input.fixturesFetchedAt, odds: hasOdds ? new Date(newest).toISOString() : null },
    sample: { homeMatches: lam.homeMatches, awayMatches: lam.awayMatches },
    model: {
      version: MODEL_VERSION,
      expectedGoals: { home: lam.lambdaHome, away: lam.lambdaAway },
      probabilities,
      rawProbabilities: raw,
      tuning: { ...tuning, blendedMarkets },
      topScorelines: topScorelines(matrix, 5),
      eloCheck: { ...elo, agrees },
    },
    market: { bestOdds, fairProbabilities: fair, marginByMarket: margins, byBook },
    value: value.map((v) => ({
      market: v.market,
      selection: v.selection,
      modelProb: v.modelProb,
      fairProb: v.fairProb,
      edge: v.edge,
      odds: v.odds,
      ev: v.ev,
    })),
    shortlist: list,
    verdict: verdictOf(list),
    confidence: confidenceOf(ctx, cfg),
    predictedScore: topScorelines(matrix, 1)[0]?.score ?? null,
    picks,
    warnings,
  };
}
