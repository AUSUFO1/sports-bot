import { describe, it, expect } from "vitest";
import { parseCompetitions, parseMatches } from "../providers/footballData";

describe("football-data parsing", () => {
  it("keeps only free-plan competitions and reads the current season year", () => {
    const out = parseCompetitions({
      competitions: [
        { code: "PL", name: "Premier League", plan: "TIER_ONE", area: { name: "England" }, currentSeason: { startDate: "2026-08-15" } },
        { code: "XX", name: "Paid League", plan: "TIER_FOUR", area: { name: "Nowhere" } },
        { code: "CL", name: "Champions League", plan: "TIER_ONE", area: { name: "Europe" }, currentSeason: null },
      ],
    });
    expect(out).toEqual([
      { providerId: "PL", name: "Premier League", country: "England", season: 2026 },
      { providerId: "CL", name: "Champions League", country: "Europe", season: null },
    ]);
  });

  it("maps finished and scheduled matches and skips broken rows", () => {
    const m = (id: number, status: string, h: number | null) => ({
      id,
      utcDate: "2026-11-28T17:30:00Z",
      status,
      season: { startDate: "2026-08-15" },
      homeTeam: { id: 57, name: "Arsenal FC" },
      awayTeam: { id: 61, name: "Chelsea FC" },
      score: { fullTime: { home: h, away: h === null ? null : 1 } },
    });
    const out = parseMatches({ matches: [m(1, "FINISHED", 2), m(2, "TIMED", null), { id: 3 }] }, "PL");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ status: "finished", homeGoals: 2, awayGoals: 1, season: 2026, leagueProviderId: "PL" });
    expect(out[1]).toMatchObject({ status: "scheduled", homeGoals: null, awayGoals: null });
  });
});
