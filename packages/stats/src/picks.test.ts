import { describe, it, expect } from "vitest";
import { confidenceOf, shortlist, valueRows, verdictOf, DEFAULT_PICK_CONFIG } from "./picks";

// The worked example from PROJECT.md section 8: model 0.54, fair 0.50, odds 1.95.
const row = (over: Partial<{ modelProb: number; fairProb: number; odds: number }> = {}) =>
  valueRows([{ market: "1x2", selection: "home", modelProb: 0.54, fairProb: 0.5, odds: 1.95, ...over }]);
const good = { homeMatches: 20, awayMatches: 20, oddsAgeHours: 1, modelGap: 0.05 };

describe("value rows", () => {
  it("edge = 0.54 - 0.50 = 0.04 and EV = 0.54 * 1.95 - 1 = 0.053", () => {
    const [r] = row();
    expect(r!.edge).toBeCloseTo(0.04, 12);
    expect(r!.ev).toBeCloseTo(0.053, 12);
  });
});

describe("shortlist rules (all must hold)", () => {
  it("passes the PROJECT.md example, with HIGH confidence", () => {
    const s = shortlist(row(), good);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ market: "1x2", selection: "home", odds: 1.95, confidence: "HIGH" });
    expect(verdictOf(s)).toBe("BET_CANDIDATE");
  });
  it("fails when EV is below 0.05 (model 0.5, odds 2.0 gives EV 0)", () => {
    expect(shortlist(row({ modelProb: 0.5, fairProb: 0.4, odds: 2 }), good)).toHaveLength(0);
  });
  it("fails when EV passes but edge is under 0.04 (model 0.54, fair 0.51, odds 1.95: edge 0.03)", () => {
    expect(shortlist(row({ fairProb: 0.51 }), good)).toHaveLength(0);
  });
  it("fails when a side has fewer than 8 matches", () => {
    expect(shortlist(row(), { ...good, homeMatches: 7 })).toHaveLength(0);
    expect(shortlist(row(), { ...good, awayMatches: 7 })).toHaveLength(0);
    expect(shortlist(row(), { ...good, homeMatches: 8, awayMatches: 8 })).toHaveLength(1);
  });
  it("fails when odds are older than 6 hours", () => {
    expect(shortlist(row(), { ...good, oddsAgeHours: 6.5 })).toHaveLength(0);
    expect(shortlist(row(), { ...good, oddsAgeHours: 6 })).toHaveLength(1);
  });
  it("fails when Poisson and Elo disagree by more than 0.15", () => {
    expect(shortlist(row(), { ...good, modelGap: 0.2 })).toHaveLength(0);
  });
  it("fails when the edge is suspiciously big: model 0.62 vs fair 0.50 is 12 points (EV 0.24)", () => {
    // Beating the sharp market by 12 points is far more likely a model error than value.
    expect(shortlist(row({ modelProb: 0.62, fairProb: 0.5, odds: 2.0 }), good)).toHaveLength(0);
  });
  it("an edge of exactly 10 points is still allowed (model 0.60, fair 0.50, odds 1.95: edge 0.10, EV 0.17)", () => {
    expect(shortlist(row({ modelProb: 0.6, fairProb: 0.5, odds: 1.95 }), good)).toHaveLength(1);
  });
  it("an empty shortlist means NO_BET", () => expect(verdictOf([])).toBe("NO_BET"));
});

describe("confidence (sample 0-2 + agreement 0-1 + fresh odds 0-1)", () => {
  it("20+ matches, models agree, odds under 2h: 4 points = HIGH", () => expect(confidenceOf(good)).toBe("HIGH"));
  it("10 matches (1) + agree (1) + odds 5h (0) = 2 points = MEDIUM", () =>
    expect(confidenceOf({ homeMatches: 10, awayMatches: 10, oddsAgeHours: 5, modelGap: 0.05 })).toBe("MEDIUM"));
  it("10 matches (1) + disagree (0) + stale (0) = 1 point = LOW", () =>
    expect(confidenceOf({ homeMatches: 10, awayMatches: 10, oddsAgeHours: 5, modelGap: 0.3 })).toBe("LOW"));
  it("config defaults match PROJECT.md", () =>
    expect(DEFAULT_PICK_CONFIG).toMatchObject({ minEv: 0.05, minEdge: 0.04, minMatches: 8 }));
});
