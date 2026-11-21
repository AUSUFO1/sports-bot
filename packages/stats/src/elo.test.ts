import { describe, it, expect } from "vitest";
import { buildEloRatings, eloExpected, eloOneXTwo, eloUpdate } from "./elo";

describe("elo", () => {
  it("equal ratings, no home advantage: expected score 0.5", () => expect(eloExpected(1500, 1500, 0)).toBeCloseTo(0.5, 12));
  it("400 points ahead: 1 / (1 + 10^-1) = 0.909091", () => expect(eloExpected(1900, 1500, 0)).toBeCloseTo(0.909091, 6));
  it("equal ratings with 65 home advantage: 1 / (1 + 10^-0.1625) = 0.5925", () =>
    expect(eloExpected(1500, 1500, 65)).toBeCloseTo(0.5925, 3));

  it("1-0 home win from equal ratings, no advantage: delta = 20 * (ln2 + 1) * 0.5 = 16.9315", () => {
    const r = eloUpdate(1500, 1500, 1, 0, 20, 0);
    expect(r.home).toBeCloseTo(1516.9315, 3);
    expect(r.away).toBeCloseTo(1483.0685, 3);
  });
  it("a draw between equal ratings with no advantage changes nothing", () => {
    const r = eloUpdate(1500, 1500, 2, 2, 20, 0);
    expect(r.home).toBeCloseTo(1500, 12);
    expect(r.away).toBeCloseTo(1500, 12);
  });

  it("1X2 from expected score 0.5: draw 0.30, home 0.35, away 0.35", () => {
    const r = eloOneXTwo(0.5);
    expect(r.draw).toBeCloseTo(0.3, 9);
    expect(r.home).toBeCloseTo(0.35, 9);
    expect(r.away).toBeCloseTo(0.35, 9);
  });
  it("1X2 from expected score 0.75: draw 0.20, home 0.65, away 0.15", () => {
    const r = eloOneXTwo(0.75);
    expect(r.draw).toBeCloseTo(0.2, 9);
    expect(r.home).toBeCloseTo(0.65, 9);
    expect(r.away).toBeCloseTo(0.15, 9);
  });

  it("replaying results moves ratings zero-sum and ignores the future", () => {
    const m = [
      { home: "A", away: "B", homeGoals: 3, awayGoals: 0, date: "2026-01-01T00:00:00Z" },
      { home: "B", away: "A", homeGoals: 9, awayGoals: 0, date: "2026-03-01T00:00:00Z" }, // after asOf
    ];
    const r = buildEloRatings(m, "2026-02-01T00:00:00Z");
    expect(r.A!).toBeGreaterThan(1500);
    expect(r.B!).toBeLessThan(1500);
    expect(r.A! + r.B!).toBeCloseTo(3000, 9);
  });
});
