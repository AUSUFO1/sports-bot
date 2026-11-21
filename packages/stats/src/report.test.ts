import { describe, it, expect } from "vitest";
import { buildReport, type OddsInput, type ReportInput } from "./report";
import type { PastMatch } from "./poisson";

const KICKOFF = "2026-12-05T15:00:00Z";
const NOW = "2026-12-05T10:00:00Z";
// 20 results between A and B, all 1-1, alternating who is at home: every strength is exactly 1.
const history: PastMatch[] = Array.from({ length: 20 }, (_, i) => ({
  home: i % 2 ? "B" : "A",
  away: i % 2 ? "A" : "B",
  homeGoals: 1,
  awayGoals: 1,
  date: new Date(Date.UTC(2026, 7, 1 + i * 3)).toISOString(),
}));
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  matchId: "epl-2026-12-05-A-B",
  league: "epl",
  kickoffUtc: KICKOFF,
  home: "A",
  away: "B",
  history,
  odds: [],
  fixturesFetchedAt: "2026-12-05T08:00:00Z",
  now: NOW,
  ...over,
});
const odd = (selection: string, decimalOdds: number, capturedAt = "2026-12-05T09:30:00Z", market = "1x2", bookmaker = "bk1"): OddsInput => ({
  bookmaker,
  market,
  selection,
  decimalOdds,
  capturedAt,
});

describe("report without odds (the honest default)", () => {
  const r = buildReport(input());
  it("has the section 8 shape and the hand-checked model numbers", () => {
    expect(r.model!.version).toBe("poisson-v1");
    expect(r.model!.expectedGoals.home).toBeCloseTo(1, 9);
    expect(r.model!.expectedGoals.away).toBeCloseTo(1, 9);
    expect(r.model!.probabilities["1x2"]!.draw).toBeCloseTo(0.308509, 5);
    expect(r.model!.probabilities.ou_2_5!.over).toBeCloseTo(0.323324, 5);
    expect(r.model!.probabilities.ou_1_5!.over).toBeCloseTo(0.593994, 5);
    expect(r.model!.probabilities.ou_3_5!.over).toBeCloseTo(0.142877, 5);
    expect(r.model!.probabilities.btts!.yes).toBeCloseTo(0.399576, 5);
    expect(r.model!.topScorelines).toHaveLength(5);
    expect(r.sample).toEqual({ homeMatches: 20, awayMatches: 20 });
    expect(typeof r.model!.eloCheck.agrees).toBe("boolean");
  });
  it("says there are no odds and returns NO_BET", () => {
    expect(r.verdict).toBe("NO_BET");
    expect(r.shortlist).toEqual([]);
    expect(r.value).toEqual([]);
    expect(r.dataFreshness.odds).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/No bookmaker odds/);
  });
});

describe("report with odds", () => {
  // odds 3.4 / 2.6 / 2.6: implied 0.294118 + 0.384615 + 0.384615 = 1.063348, margin 0.063348
  // fair home = 0.294118 / 1.063348 = 0.276596; model home 0.345746
  // edge = 0.345746 - 0.276596 = 0.069150; EV = 0.345746 * 3.4 - 1 = 0.175536
  const r = buildReport(input({ odds: [odd("home", 3.4), odd("draw", 2.6), odd("away", 2.6)] }));
  it("removes the margin and computes edge and EV by hand", () => {
    expect(r.market.marginByMarket["1x2"]).toBeCloseTo(0.063348, 5);
    expect(r.market.fairProbabilities["1x2"]!.home).toBeCloseTo(0.276596, 5);
    const home = r.value.find((v) => v.selection === "home")!;
    expect(home.edge).toBeCloseTo(0.06915, 4);
    expect(home.ev).toBeCloseTo(0.175536, 4);
  });
  it("shortlists only the home selection and flags a candidate", () => {
    expect(r.shortlist.map((s) => s.selection)).toEqual(["home"]);
    expect(r.verdict).toBe("BET_CANDIDATE");
    expect(r.confidence).toBe("HIGH");
    expect(r.warnings.join(" ")).toMatch(/Only 1 bookmaker priced 1x2/);
    expect(r.dataFreshness.odds).toBe("2026-12-05T09:30:00.000Z");
  });
  it("shortlist is always a subset of the value rows that meet the thresholds", () => {
    for (const s of r.shortlist) {
      const v = r.value.find((x) => x.market === s.market && x.selection === s.selection)!;
      expect(v.ev).toBeGreaterThanOrEqual(0.05);
      expect(v.edge).toBeGreaterThanOrEqual(0.04);
    }
  });
  it("uses the best price across bookmakers", () => {
    const two = buildReport(
      input({ odds: [odd("home", 3.0), odd("draw", 2.6), odd("away", 2.6), odd("home", 3.4, undefined, "1x2", "bk2")] }),
    );
    expect(two.market.bestOdds["1x2"]!.home).toBe(3.4);
    expect(two.warnings.join(" ")).not.toMatch(/Only 1 bookmaker/);
  });
});

describe("safety rules", () => {
  it("stale odds (10 hours) force NO_BET and say so", () => {
    const r = buildReport(
      input({ odds: [odd("home", 3.4, "2026-12-05T00:00:00Z"), odd("draw", 2.6, "2026-12-05T00:00:00Z"), odd("away", 2.6, "2026-12-05T00:00:00Z")] }),
    );
    expect(r.verdict).toBe("NO_BET");
    expect(r.warnings.join(" ")).toMatch(/Odds are 10 hours old/);
  });
  it("a market missing a selection is skipped with a warning, not guessed", () => {
    const r = buildReport(input({ odds: [odd("home", 3.4)] }));
    expect(r.value).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/missing a selection/);
  });
  it("fewer than 8 matches gives NO_BET and a low-sample warning", () => {
    const r = buildReport(
      input({ history: history.slice(0, 6), odds: [odd("home", 3.4), odd("draw", 2.6), odd("away", 2.6)] }),
    );
    expect(r.verdict).toBe("NO_BET");
    expect(r.warnings.join(" ")).toMatch(/Low sample/);
  });
  it("no history at all: model is null, NO_BET, and it says why", () => {
    const r = buildReport(input({ history: [] }));
    expect(r.model).toBeNull();
    expect(r.verdict).toBe("NO_BET");
    expect(r.warnings.join(" ")).toMatch(/No past results/);
  });
  it("results at or after kickoff never influence the report (no leakage)", () => {
    const leaked = [...history, { home: "A", away: "B", homeGoals: 9, awayGoals: 0, date: "2026-12-05T15:00:00Z" } as PastMatch];
    expect(buildReport(input({ history: leaked })).model!.expectedGoals.home).toBeCloseTo(1, 9);
  });
  it("old fixture data adds a freshness warning", () => {
    const r = buildReport(input({ fixturesFetchedAt: "2026-12-03T00:00:00Z" }));
    expect(r.warnings.join(" ")).toMatch(/Fixture data is .* hours old/);
  });
  it("is deterministic: same input, same output", () => {
    expect(JSON.stringify(buildReport(input()))).toBe(JSON.stringify(buildReport(input())));
  });
});
