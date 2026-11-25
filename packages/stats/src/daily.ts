/**
 * Malin's picks of the day. From every game kicking off today, take each game's single strongest selection,
 * keep the ones that clear the bar, and return the best few, strongest first. The count is decided by the data:
 * a weak day can give 0 picks, a strong day up to `max`. Pure: the live job and the backtest call this same code.
 */

export interface DailyCandidate {
  matchId: string;
  kickoffUtc: string;
  market: string; // 1x2 | ou_1_5 | ou_2_5 | ou_3_5 | btts
  selection: string;
  /** final probability (Pinnacle-led where Pinnacle priced the market) */
  prob: number;
  /** our own model's probability for the same selection; null when not known */
  ourProb: number | null;
  /** best decimal odds on offer across bookmakers; null = no price, so it cannot be played */
  bestOdds: number | null;
}

export interface DailyRules {
  /** final probability must reach this */
  minProb: number;
  /** our own model must give at least this to the same selection (it must agree) */
  minAgree: number;
  /** odds shorter than this are not worth a place (a 1.10 "banker" adds little and still loses sometimes) */
  minOdds: number;
  /** never more than this many picks in a day */
  max: number;
}

/** Selections Malin may pick. Draws are left out: even strong draws rarely pass 40%. */
export const DAILY_MARKETS: Record<string, string[]> = {
  "1x2": ["home", "away"],
  ou_1_5: ["over"],
  ou_2_5: ["over", "under"],
  ou_3_5: ["under"],
  btts: ["yes", "no"],
};

// Set from the backtest (2026-11-25, 3,654 games, 5 leagues, best price across books): chance >= 65% at odds >= 1.40
// won 71% at average odds 1.45, +3% per pick with the "our model leans the same way" check (+4% without it).
// Safer bars (75%+, odds 1.20+) won ~80% but lost money: the price is too short.
export const DAILY_RULES: DailyRules = { minProb: 0.65, minAgree: 0.5, minOdds: 1.4, max: 6 };

export function selectDaily(cands: DailyCandidate[], rules: DailyRules = DAILY_RULES): DailyCandidate[] {
  const bestPerMatch = new Map<string, DailyCandidate>();
  for (const c of cands) {
    if (!DAILY_MARKETS[c.market]?.includes(c.selection)) continue;
    if (!(c.prob >= rules.minProb)) continue;
    if (c.ourProb !== null && !(c.ourProb >= rules.minAgree)) continue;
    if (c.bestOdds === null || !(c.bestOdds >= rules.minOdds)) continue;
    const cur = bestPerMatch.get(c.matchId);
    if (!cur || c.prob > cur.prob) bestPerMatch.set(c.matchId, c); // one pick per game: its strongest
  }
  return [...bestPerMatch.values()]
    .sort((a, b) => b.prob - a.prob || a.kickoffUtc.localeCompare(b.kickoffUtc))
    .slice(0, rules.max);
}
