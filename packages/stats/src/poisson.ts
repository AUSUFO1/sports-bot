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

/**
 * Dixon-Coles adjustment for the four low scores. Plain Poisson treats both teams' goals as independent,
 * which gets 0-0, 1-0, 0-1 and 1-1 slightly wrong. rho < 0 adds draws at 0-0 and 1-1. rho = 0 is plain Poisson.
 */
export function dixonColesTau(h: number, a: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (h === 0 && a === 1) return 1 + lambdaHome * rho;
  if (h === 1 && a === 0) return 1 + lambdaAway * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/** matrix[h][a] = P(home scores h, away scores a), truncated at maxGoals and renormalised to 1. */
export function scoreMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 10, rho = 0): number[][] {
  const ph = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaHome));
  const pa = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaAway));
  const m = ph.map((x, h) => pa.map((y, a) => Math.max(0, x * y * dixonColesTau(h, a, lambdaHome, lambdaAway, rho))));
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
  // Parse each date once (the free plan allows only 10 ms of CPU per run), then sort newest first.
  const timed = matches.map((m) => ({ m, t: Date.parse(m.date) })).filter((x) => x.t < t0);
  timed.sort((a, b) => b.t - a.t);
  const past = timed.map((x) => x.m);
  if (past.length === 0) return null;
  const weightOf = new Map<PastMatch, number>(timed.map((x) => [x.m, decayWeight((t0 - x.t) / DAY, opts.halfLifeDays)]));

  const w = (m: PastMatch) => weightOf.get(m)!;
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
