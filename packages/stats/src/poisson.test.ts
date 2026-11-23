import { describe, it, expect } from "vitest";
import { computeLambdas, decayWeight, poissonPmf, scoreMatrix, type PastMatch } from "./poisson";
import { btts, oneXTwo, overUnder, topScorelines } from "./markets";

describe("poisson pmf (hand-computed)", () => {
  it("P(0; 1) = e^-1 = 0.367879", () => expect(poissonPmf(0, 1)).toBeCloseTo(0.367879, 6));
  it("P(2; 1.5) = e^-1.5 * 1.5^2/2 = 0.223130 * 1.125 = 0.251021", () =>
    expect(poissonPmf(2, 1.5)).toBeCloseTo(0.251021, 6));
});

describe("score matrix at lambda 1 vs 1", () => {
  const m = scoreMatrix(1, 1);
  it("sums to 1", () => expect(m.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10));
  it("draw = e^-2 * sum(1/k!^2) = 0.135335 * 2.279585 = 0.308509", () =>
    expect(oneXTwo(m).draw).toBeCloseTo(0.308509, 5));
  it("home = away = (1 - 0.308509) / 2 = 0.345746", () => {
    const r = oneXTwo(m);
    expect(r.home).toBeCloseTo(0.345746, 5);
    expect(r.away).toBeCloseTo(0.345746, 5);
    expect(r.home + r.draw + r.away).toBeCloseTo(1, 10);
  });
  it("BTTS yes = (1 - e^-1)^2 = 0.399576", () => expect(btts(m).yes).toBeCloseTo(0.399576, 5));
  it("over 2.5 = 1 - e^-2 * (1 + 2 + 2) = 0.323324", () => expect(overUnder(m, 2.5).over).toBeCloseTo(0.323324, 5));
  it("over 1.5 = 1 - e^-2 * (1 + 2) = 0.593994", () => expect(overUnder(m, 1.5).over).toBeCloseTo(0.593994, 5));
  it("over 3.5 = 1 - e^-2 * (1 + 2 + 2 + 4/3) = 0.142877", () => expect(overUnder(m, 3.5).over).toBeCloseTo(0.142877, 5));
  it("over + under = 1", () => {
    const o = overUnder(m, 2.5);
    expect(o.over + o.under).toBeCloseTo(1, 10);
  });
  it("top scorelines: 0-0, 1-0, 0-1, 1-1 each e^-2 = 0.135335, sorted, 5 returned", () => {
    const t = topScorelines(m, 5);
    expect(t).toHaveLength(5);
    for (let i = 0; i < 4; i++) expect(t[i]!.prob).toBeCloseTo(0.135335, 5);
    expect(t[4]!.prob).toBeCloseTo(0.067668, 5); // 2-0 style, e^-2 / 2
    for (let i = 1; i < t.length; i++) expect(t[i]!.prob).toBeLessThanOrEqual(t[i - 1]!.prob);
  });
});

describe("decay weight", () => {
  it("1 today, 0.5 after one half-life, 0.25 after two", () => {
    expect(decayWeight(0, 60)).toBe(1);
    expect(decayWeight(60, 60)).toBeCloseTo(0.5, 12);
    expect(decayWeight(120, 60)).toBeCloseTo(0.25, 12);
  });
});

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
const flat = { halfLifeDays: 1e12, shrinkage: 3, lastN: 20 }; // weights ~1 so hand arithmetic is exact

describe("computeLambdas", () => {
  it("all 1-1 results give lambda 1 and 1", () => {
    const h: PastMatch[] = Array.from({ length: 10 }, (_, i) => ({
      home: i % 2 ? "A" : "B",
      away: i % 2 ? "B" : "A",
      homeGoals: 1,
      awayGoals: 1,
      date: day(1 + i),
    }));
    const l = computeLambdas(h, "A", "B", day(30))!;
    expect(l.lambdaHome).toBeCloseTo(1, 9);
    expect(l.lambdaAway).toBeCloseTo(1, 9);
  });

  it("hand example: A 3-1 B and C 1-1 D, then A (home) vs B (away)", () => {
    // avgHome = (3+1)/2 = 2, avgAway = (1+1)/2 = 1, shrinkage K = 3
    // A at home: attack = (3 + 3*2) / ((1+3)*2) = 9/8, defence = (1 + 3*1) / ((1+3)*1) = 1
    // B away:    attack = (1 + 3*1) / ((1+3)*1) = 1,   defence = (3 + 3*2) / ((1+3)*2) = 9/8
    // lambdaHome = 2 * 9/8 * 9/8 = 2.53125, lambdaAway = 1 * 1 * 1 = 1
    const h: PastMatch[] = [
      { home: "A", away: "B", homeGoals: 3, awayGoals: 1, date: day(1) },
      { home: "C", away: "D", homeGoals: 1, awayGoals: 1, date: day(2) },
    ];
    const l = computeLambdas(h, "A", "B", day(10), flat)!;
    expect(l.lambdaHome).toBeCloseTo(2.53125, 6);
    expect(l.lambdaAway).toBeCloseTo(1, 6);
    expect(l.homeMatches).toBe(1);
    expect(l.awayMatches).toBe(1);
  });

  it("unknown teams fall back to the league averages (2 and 1)", () => {
    const h: PastMatch[] = [
      { home: "X", away: "Y", homeGoals: 2, awayGoals: 1, date: day(1) },
      { home: "Y", away: "X", homeGoals: 2, awayGoals: 1, date: day(2) },
    ];
    const l = computeLambdas(h, "P", "Q", day(10), flat)!;
    expect(l.lambdaHome).toBeCloseTo(2, 6);
    expect(l.lambdaAway).toBeCloseTo(1, 6);
    expect(l.homeMatches).toBe(0);
  });

  it("ignores matches on or after asOf (no leakage)", () => {
    const base: PastMatch[] = [{ home: "A", away: "B", homeGoals: 1, awayGoals: 1, date: day(1) }];
    const withFuture = [...base, { home: "A", away: "B", homeGoals: 9, awayGoals: 0, date: day(20) }];
    const a = computeLambdas(base, "A", "B", day(10), flat)!;
    const b = computeLambdas(withFuture, "A", "B", day(10), flat)!;
    expect(b.lambdaHome).toBeCloseTo(a.lambdaHome, 12);
    expect(computeLambdas([], "A", "B", day(10))).toBeNull();
  });
});

describe("Dixon-Coles score matrix", () => {
  it("rho = 0 is plain Poisson", () => {
    expect(scoreMatrix(1.4, 1.1, 10, 0)).toEqual(scoreMatrix(1.4, 1.1));
  });
  it("still sums to 1 and raises 0-0 and 1-1 when rho < 0", () => {
    const plain = scoreMatrix(1.4, 1.1);
    const dc = scoreMatrix(1.4, 1.1, 10, -0.1);
    expect(dc.flat().reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(dc[0]![0]!).toBeGreaterThan(plain[0]![0]!);
    expect(dc[1]![1]!).toBeGreaterThan(plain[1]![1]!);
    expect(dc[1]![0]!).toBeLessThan(plain[1]![0]!);
  });
});
