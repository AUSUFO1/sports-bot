/** Implied probability from decimal odds. */
export function impliedProb(decimalOdds: number): number {
  return 1 / decimalOdds;
}

/** Remove bookmaker margin by proportional normalisation. Returns fair probs and the margin. */
export function removeMargin(odds: number[]): { fair: number[]; margin: number } {
  const implied = odds.map(impliedProb);
  const total = implied.reduce((a, b) => a + b, 0);
  return { fair: implied.map((p) => p / total), margin: total - 1 };
}

export const edge = (modelProb: number, fairProb: number) => modelProb - fairProb;
export const expectedValue = (modelProb: number, decimalOdds: number) => modelProb * decimalOdds - 1;
