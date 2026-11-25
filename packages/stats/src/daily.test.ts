import { describe, it, expect } from "vitest";
import { selectDaily, type DailyCandidate, type DailyRules } from "./daily";

const R: DailyRules = { minProb: 0.65, minAgree: 0.55, minOdds: 1.3, max: 3 };
const c = (matchId: string, market: string, selection: string, prob: number, bestOdds: number | null, ourProb: number | null = prob): DailyCandidate => ({
  matchId,
  kickoffUtc: "2026-11-25T19:00:00Z",
  market,
  selection,
  prob,
  ourProb,
  bestOdds,
});

describe("selectDaily", () => {
  it("keeps one pick per game: its strongest", () => {
    const out = selectDaily([c("a", "ou_2_5", "over", 0.7, 1.4), c("a", "btts", "yes", 0.72, 1.35)], R);
    expect(out).toHaveLength(1);
    expect(out[0]!.market).toBe("btts");
  });

  it("drops picks below the bar, too short, unpriced, or where our model disagrees", () => {
    const out = selectDaily(
      [
        c("low", "1x2", "home", 0.6, 1.6),
        c("short", "1x2", "home", 0.85, 1.15),
        c("noprice", "1x2", "home", 0.8, null),
        c("disagree", "1x2", "home", 0.75, 1.4, 0.5),
        c("ok", "1x2", "away", 0.7, 1.45),
      ],
      R,
    );
    expect(out.map((x) => x.matchId)).toEqual(["ok"]);
  });

  it("never picks draws or markets it does not cover", () => {
    expect(selectDaily([c("a", "1x2", "draw", 0.9, 2), c("b", "ou_3_5", "over", 0.9, 2)], R)).toEqual([]);
  });

  it("sorts strongest first and stops at the daily maximum; a weak day gives none", () => {
    const many = [0.7, 0.9, 0.8, 0.75, 0.66].map((p, i) => c(`m${i}`, "1x2", "home", p, 1.4));
    expect(selectDaily(many, R).map((x) => x.prob)).toEqual([0.9, 0.8, 0.75]);
    expect(selectDaily([c("x", "1x2", "home", 0.6, 1.5)], R)).toEqual([]);
  });

  it("accepts a pick when our model's number is unknown", () => {
    expect(selectDaily([c("a", "1x2", "home", 0.7, 1.4, null)], R)).toHaveLength(1);
  });
});
