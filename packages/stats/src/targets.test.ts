import { describe, it, expect } from "vitest";
import { topPicks, type TopPickInput } from "./targets";
import { settlePick } from "./settle";
import { buildTicket, type TicketCandidate } from "./ticket";

const base = (over: Partial<TopPickInput> = {}): TopPickInput => ({
  probabilities: {
    "1x2": { home: 0.68, draw: 0.18, away: 0.14 },
    ou_2_5: { over: 0.67, under: 0.33 },
    ou_3_5: { over: 0.45, under: 0.55 },
    btts: { yes: 0.59, no: 0.41 },
  },
  expectedGoals: { home: 2.4, away: 1.05 },
  homeMatches: 20,
  awayMatches: 20,
  modelsAgree: true,
  value: [],
  shortlisted: [],
  ...over,
});

describe("top picks", () => {
  it("picks home (0.68 >= 0.60) and over 2.5 (0.67 >= 0.62), strongest first, at most 2", () => {
    const p = topPicks(base());
    expect(p.map((x) => `${x.market}:${x.selection}`)).toEqual(["1x2:home", "ou_2_5:over"]);
    expect(p[0]!.strength).toBeCloseTo(0.08, 9); // 0.68 - 0.60
    expect(p[1]!.strength).toBeCloseTo(0.05, 9); // 0.67 - 0.62
    expect(p[0]!.kind).toBe("model");
    expect(p[0]!.flags).toContain("No odds yet");
  });
  it("btts yes at 0.59 stays out (needs 0.60); under 3.5 at 0.55 stays out (needs 0.80)", () => {
    const keys = topPicks(base({ probabilities: { ...base().probabilities, "1x2": { home: 0.4, draw: 0.3, away: 0.3 } } })).map((x) => x.selection);
    expect(keys).not.toContain("yes");
    expect(keys).not.toContain("under");
  });
  it("under 3.5 is picked at 0.82 on a low-scoring game", () => {
    const p = topPicks(base({ probabilities: { ou_3_5: { over: 0.18, under: 0.82 } } }));
    expect(p[0]).toMatchObject({ market: "ou_3_5", selection: "under" });
  });
  it("keeps only the stronger goals pick when under 2.5 and under 3.5 both qualify", () => {
    const p = topPicks(
      base({
        probabilities: { ou_2_5: { over: 0.3, under: 0.7 }, ou_3_5: { over: 0.1, under: 0.9 } },
        expectedGoals: { home: 1.0, away: 0.9 },
      }),
    );
    expect(p.map((x) => `${x.market}:${x.selection}`)).toEqual(["ou_3_5:under"]); // 0.9 - 0.8 = 0.10 beats 0.7 - 0.62 = 0.08
  });
  it("a draw needs 0.30+ AND low expected goals (<= 2.4 total)", () => {
    const probs = { "1x2": { home: 0.35, draw: 0.31, away: 0.34 } };
    expect(topPicks(base({ probabilities: probs, expectedGoals: { home: 1.1, away: 1.0 } })).map((x) => x.selection)).toEqual(["draw"]);
    expect(topPicks(base({ probabilities: probs, expectedGoals: { home: 1.8, away: 1.5 } }))).toEqual([]);
  });
  it("result picks are dropped when Poisson and Elo disagree; goal picks stay", () => {
    const p = topPicks(base({ modelsAgree: false }));
    expect(p.map((x) => x.market)).toEqual(["ou_2_5"]);
  });
  it("no picks at all with fewer than 8 matches on a side", () => {
    expect(topPicks(base({ homeMatches: 7 }))).toEqual([]);
  });
  it("with odds: a value pick is ticket-ok, a pick with negative EV is not", () => {
    const withOdds = topPicks(
      base({
        value: [
          { market: "1x2", selection: "home", odds: 1.8, ev: 0.224, edge: 0.1 }, // 0.68 * 1.8 - 1
          { market: "ou_2_5", selection: "over", odds: 1.4, ev: -0.062, edge: -0.04 }, // 0.67 * 1.4 - 1
        ],
        shortlisted: [{ market: "1x2", selection: "home" }],
      }),
    );
    expect(withOdds[0]).toMatchObject({ kind: "value", ticketOk: true });
    expect(withOdds[1]).toMatchObject({ kind: "model", ticketOk: false });
    expect(withOdds[1]!.flags).toContain("Odds too low: no value");
  });
});

describe("settle (hand-checked scores)", () => {
  it("1x2: 2-1 is a home win, not a draw or away", () => {
    expect(settlePick("1x2", "home", 2, 1)).toBe("win");
    expect(settlePick("1x2", "draw", 2, 1)).toBe("loss");
    expect(settlePick("1x2", "away", 2, 1)).toBe("loss");
    expect(settlePick("1x2", "draw", 1, 1)).toBe("win");
  });
  it("totals: 2-1 is 3 goals, so over 2.5 wins and under 3.5 wins, under 2.5 loses", () => {
    expect(settlePick("ou_2_5", "over", 2, 1)).toBe("win");
    expect(settlePick("ou_2_5", "under", 2, 1)).toBe("loss");
    expect(settlePick("ou_3_5", "under", 2, 1)).toBe("win");
    expect(settlePick("ou_3_5", "under", 3, 1)).toBe("loss"); // 4 goals
    expect(settlePick("ou_1_5", "over", 1, 0)).toBe("loss"); // 1 goal
  });
  it("btts: 1-0 is no, 1-1 is yes, 0-0 is no", () => {
    expect(settlePick("btts", "no", 1, 0)).toBe("win");
    expect(settlePick("btts", "yes", 1, 1)).toBe("win");
    expect(settlePick("btts", "yes", 0, 0)).toBe("loss");
  });
  it("unknown market or selection returns null instead of guessing", () => {
    expect(settlePick("corners", "over", 1, 1)).toBeNull();
    expect(settlePick("1x2", "banana", 1, 1)).toBeNull();
  });
});

describe("ticket", () => {
  const future = "2999-01-01T00:00:00Z";
  const c = (matchId: string, modelProb: number, odds: number | null, over: Partial<TicketCandidate> = {}): TicketCandidate => ({
    matchId, home: "H" + matchId, away: "A" + matchId, kickoffUtc: future, market: "1x2", selection: "home",
    modelProb, odds, kind: "model", ticketOk: true, ...over,
  });
  it("takes the safest leg per match, best first, capped at maxLegs", () => {
    const t = buildTicket([c("1", 0.7, 1.5), c("1", 0.8, 1.3), c("2", 0.75, 1.4), c("3", 0.65, 1.6)], 2)!;
    expect(t.legs.map((l) => l.modelProb)).toEqual([0.8, 0.75]); // match 1 keeps its 0.8, then match 2
  });
  it("combined probability and odds are products; EV = prob * odds - 1", () => {
    const t = buildTicket([c("1", 0.8, 1.25), c("2", 0.75, 1.4)])!;
    expect(t.combinedProb).toBeCloseTo(0.6, 12); // 0.8 * 0.75
    expect(t.combinedOdds).toBeCloseTo(1.75, 12); // 1.25 * 1.4
    expect(t.ev).toBeCloseTo(0.05, 12); // 0.6 * 1.75 - 1
  });
  it("no odds on a leg means no combined odds and no EV", () => {
    const t = buildTicket([c("1", 0.8, 1.25), c("2", 0.75, null)])!;
    expect(t.combinedOdds).toBeNull();
    expect(t.ev).toBeNull();
  });
  it("skips picks that are not ticket-ok or already kicked off; empty gives null", () => {
    expect(buildTicket([c("1", 0.9, 1.1, { ticketOk: false }), c("2", 0.9, 1.1, { kickoffUtc: "2000-01-01T00:00:00Z" })])).toBeNull();
  });
});
