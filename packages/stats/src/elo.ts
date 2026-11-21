/** Elo ratings, used only as a sanity check on the Poisson model. */

export const ELO_START = 1500;
export const ELO_K = 20;
export const ELO_HOME_ADVANTAGE = 65;

/** Expected score (win = 1, draw = 0.5, loss = 0) for the home side. */
export function eloExpected(ratingHome: number, ratingAway: number, homeAdv = ELO_HOME_ADVANTAGE): number {
  return 1 / (1 + Math.pow(10, -(ratingHome + homeAdv - ratingAway) / 400));
}

/** Returns new ratings after a result. Goal-difference multiplier: ln(|gd| + 1) + 1 (1 for a draw or 1-goal win scales to ~1.7). */
export function eloUpdate(
  ratingHome: number,
  ratingAway: number,
  homeGoals: number,
  awayGoals: number,
  k = ELO_K,
  homeAdv = ELO_HOME_ADVANTAGE,
): { home: number; away: number } {
  const expected = eloExpected(ratingHome, ratingAway, homeAdv);
  const actual = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
  const mult = Math.log(Math.abs(homeGoals - awayGoals) + 1) + 1;
  const delta = k * mult * (actual - expected);
  return { home: ratingHome + delta, away: ratingAway - delta };
}

/** Ratings after replaying every match played before asOf, oldest first. Unknown teams start at 1500. */
export function buildEloRatings(
  matches: { home: string; away: string; homeGoals: number; awayGoals: number; date: string }[],
  asOf: string,
): Record<string, number> {
  const t0 = Date.parse(asOf);
  const ratings: Record<string, number> = {};
  const ordered = matches.filter((m) => Date.parse(m.date) < t0).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const m of ordered) {
    const rh = ratings[m.home] ?? ELO_START;
    const ra = ratings[m.away] ?? ELO_START;
    const next = eloUpdate(rh, ra, m.homeGoals, m.awayGoals);
    ratings[m.home] = next.home;
    ratings[m.away] = next.away;
  }
  return ratings;
}

/**
 * 1X2 estimate from an expected score E. Approximation (documented, not a law):
 * draw = 0.30 - 0.20 * |2E - 1|, then home/away split so the expected score stays E.
 */
export function eloOneXTwo(expected: number): { home: number; draw: number; away: number } {
  const draw = Math.max(0.05, 0.3 - 0.2 * Math.abs(2 * expected - 1));
  const home = Math.max(0.01, expected - draw / 2);
  const away = Math.max(0.01, 1 - expected - draw / 2);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}
