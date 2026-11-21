/** Poisson goals model. Pure functions: no randomness, no runtime-specific code. */

export interface PastMatch {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /** kickoff, ISO string */
  date: string;
}

export interface ModelOptions {
  /** weight halves every this many days */
  halfLifeDays: number;
  /** pseudo-matches at league average, to pull small samples toward 1.0 */
  shrinkage: number;
  /** only the last N matches of each side are used for that side's strength */
  lastN: number;
}

export const DEFAULT_OPTIONS: ModelOptions = { halfLifeDays: 60, shrinkage: 3, lastN: 20 };

/** P(X = k) for X ~ Poisson(lambda), built iteratively (no factorial overflow). */
export function poissonPmf(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** matrix[h][a] = P(home scores h, away scores a), truncated at maxGoals and renormalised to 1. */
export function scoreMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 10): number[][] {
  const ph = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaHome));
  const pa = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaAway));
  const m = ph.map((x) => pa.map((y) => x * y));
  const total = m.flat().reduce((s, v) => s + v, 0);
  return m.map((row) => row.map((v) => v / total));
}

/** Exponential decay weight: 1 today, 0.5 after one half-life. */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

const DAY = 86_400_000;

export interface Lambdas {
  lambdaHome: number;
  lambdaAway: number;
  /** matches used for each side (any venue), for the sample-size rule */
  homeMatches: number;
  awayMatches: number;
  leagueAvgHome: number;
  leagueAvgAway: number;
}

/**
 * Expected goals for home vs away, using only matches played BEFORE asOf (no leakage).
 * attack = goals scored vs league average at that venue, defence = goals conceded vs league average,
 * each shrunk toward 1.0 and weighted toward recent matches.
 */
export function computeLambdas(
  matches: PastMatch[],
  homeTeam: string,
  awayTeam: string,
  asOf: string,
  opts: ModelOptions = DEFAULT_OPTIONS,
): Lambdas | null {
  const t0 = Date.parse(asOf);
  const past = matches
    .filter((m) => Date.parse(m.date) < t0)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)); // newest first
  if (past.length === 0) return null;

  const w = (m: PastMatch) => decayWeight((t0 - Date.parse(m.date)) / DAY, opts.halfLifeDays);
  let sw = 0;
  let sh = 0;
  let sa = 0;
  for (const m of past) {
    sw += w(m);
    sh += w(m) * m.homeGoals;
    sa += w(m) * m.awayGoals;
  }
  const avgHome = sh / sw;
  const avgAway = sa / sw;
  if (avgHome <= 0 || avgAway <= 0) return null;

  const lastOf = (team: string) => past.filter((m) => m.home === team || m.away === team).slice(0, opts.lastN);
  const homeAll = lastOf(homeTeam);
  const awayAll = lastOf(awayTeam);

  const strength = (sumWeighted: number, sumW: number, avg: number) =>
    (sumWeighted + opts.shrinkage * avg) / ((sumW + opts.shrinkage) * avg);

  // Home team at home: scores avgHome-scale goals, concedes avgAway-scale goals.
  const hHome = homeAll.filter((m) => m.home === homeTeam);
  const attH = strength(hHome.reduce((s, m) => s + w(m) * m.homeGoals, 0), hHome.reduce((s, m) => s + w(m), 0), avgHome);
  const defH = strength(hHome.reduce((s, m) => s + w(m) * m.awayGoals, 0), hHome.reduce((s, m) => s + w(m), 0), avgAway);
  // Away team away: scores avgAway-scale goals, concedes avgHome-scale goals.
  const aAway = awayAll.filter((m) => m.away === awayTeam);
  const attA = strength(aAway.reduce((s, m) => s + w(m) * m.awayGoals, 0), aAway.reduce((s, m) => s + w(m), 0), avgAway);
  const defA = strength(aAway.reduce((s, m) => s + w(m) * m.homeGoals, 0), aAway.reduce((s, m) => s + w(m), 0), avgHome);

  return {
    lambdaHome: avgHome * attH * defA,
    lambdaAway: avgAway * attA * defH,
    homeMatches: homeAll.length,
    awayMatches: awayAll.length,
    leagueAvgHome: avgHome,
    leagueAvgAway: avgAway,
  };
}
