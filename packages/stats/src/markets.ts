/** Market probabilities derived from a score matrix (rows = home goals, columns = away goals). */

export interface OneXTwo {
  home: number;
  draw: number;
  away: number;
}

export function oneXTwo(m: number[][]): OneXTwo {
  let home = 0;
  let draw = 0;
  let away = 0;
  m.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }),
  );
  return { home, draw, away };
}

/** line like 2.5: over = P(total goals > line). */
export function overUnder(m: number[][], line: number): { over: number; under: number } {
  let over = 0;
  m.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h + a > line) over += p;
    }),
  );
  return { over, under: 1 - over };
}

export function btts(m: number[][]): { yes: number; no: number } {
  let no = 0;
  m.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h === 0 || a === 0) no += p;
    }),
  );
  return { yes: 1 - no, no };
}

export function topScorelines(m: number[][], n = 5): { score: string; prob: number }[] {
  const all: { score: string; prob: number }[] = [];
  m.forEach((row, h) => row.forEach((p, a) => all.push({ score: `${h}-${a}`, prob: p })));
  return all.sort((x, y) => y.prob - x.prob).slice(0, n);
}
