import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs helper, no type declarations needed
import { chunk, extractRows, matchFixture, nameScore, tokens } from "./oddsLib.mjs";

describe("name matching (hand-checked)", () => {
  it("drops filler words and accents: 'SV Werder Bremen' = 'Werder Bremen'", () => {
    expect(tokens("SV Werder Bremen")).toEqual(["werder", "bremen"]);
    expect(nameScore("Werder Bremen", "SV Werder Bremen")).toBe(1);
    expect(nameScore("Borussia Monchengladbach", "Borussia Mönchengladbach")).toBe(1);
    expect(nameScore("Union Berlin", "1. FC Union Berlin")).toBe(1);
  });
  it("different spellings do not match: Cologne vs Köln is 0 (the other side must carry it)", () => {
    expect(nameScore("1. FC Cologne", "1. FC Köln")).toBe(0);
  });
  it("half a match is 0.5: 'Bayern Munich' vs 'FC Bayern München'", () => {
    expect(nameScore("Bayern Munich", "FC Bayern München")).toBe(0.5);
  });
  it("empty names score 0", () => {
    expect(nameScore("", "Arsenal")).toBe(0);
  });
});

const games = [
  { matchId: "fd-1", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "1. FSV Mainz 05", away: "1. FC Union Berlin" },
  { matchId: "fd-2", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "Hamburger SV", away: "FC Bayern München" },
  { matchId: "fd-3", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "1. FC Köln", away: "SV 07 Elversberg" },
  { matchId: "fd-4", kickoffUtc: "2026-11-28T17:30:00.000Z", home: "VfB Stuttgart", away: "Eintracht Frankfurt" },
];
const fx = (homeName: string, awayName: string, startTime = "2026-11-28T14:30:00.000Z") => ({ homeName, awayName, startTime });

describe("matching OddsPapi fixtures to our games", () => {
  it("matches on kickoff plus names", () => {
    expect(matchFixture(fx("FSV Mainz", "Union Berlin"), games)?.matchId).toBe("fd-1");
    expect(matchFixture(fx("Hamburger SV", "Bayern Munich"), games)?.matchId).toBe("fd-2");
  });
  it("Cologne vs Köln: the home name fails but the away side and kickoff still match", () => {
    expect(matchFixture(fx("1. FC Cologne", "SV 07 Elversberg"), games)?.matchId).toBe("fd-3");
  });
  it("rejects a kickoff more than 45 minutes away", () => {
    expect(matchFixture(fx("FSV Mainz", "Union Berlin", "2026-11-28T15:30:00.000Z"), games)).toBeNull();
  });
  it("accepts a kickoff 30 minutes away", () => {
    expect(matchFixture(fx("FSV Mainz", "Union Berlin", "2026-11-28T15:00:00.000Z"), games)?.matchId).toBe("fd-1");
  });
  it("returns null for a team we do not have", () => {
    expect(matchFixture(fx("Real Madrid", "Barcelona"), games)).toBeNull();
  });
  it("does not guess when two games look the same", () => {
    const twins = [
      { matchId: "a", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "Real Sociedad", away: "Getafe" },
      { matchId: "b", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "Real Sociedad", away: "Getafe B" },
    ];
    // Both games score 2 for this fixture (Real Sociedad = 1, Getafe = 1), so there is no safe winner: it must return null.
    expect(matchFixture(fx("Real Sociedad", "Getafe"), twins)).toBeNull();
  });
  it("still picks the clear winner when one game scores higher", () => {
    const clear = [
      { matchId: "a", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "Real Sociedad", away: "Getafe" },
      { matchId: "b", kickoffUtc: "2026-11-28T14:30:00.000Z", home: "Real Betis", away: "Sevilla" },
    ];
    expect(matchFixture(fx("Real Sociedad", "Getafe"), clear)?.matchId).toBe("a");
  });
});

describe("pulling markets out of a bookmaker block", () => {
  const price = (p: number, active = true) => ({ players: { "0": { active, price: p } } });
  const block = {
    markets: {
      101: { marketActive: true, outcomes: { 101: price(1.76), 102: price(4.44), 103: price(4.15) } },
      104: { marketActive: true, outcomes: { 104: price(1.6), 105: price(2.3) } },
      1010: { marketActive: true, outcomes: { 1010: price(1.5), 1011: price(2.6) } },
      1012: { marketActive: false, outcomes: { 1012: price(1.2), 1013: price(4.5) } },
      999: { marketActive: true, outcomes: { 1: price(2) } },
    },
  };
  it("keeps 1x2, btts and over/under 2.5 and names the selections", () => {
    const rows = extractRows(block);
    expect(rows).toContainEqual({ market: "1x2", selection: "home", odds: 1.76 });
    expect(rows).toContainEqual({ market: "1x2", selection: "draw", odds: 4.44 });
    expect(rows).toContainEqual({ market: "btts", selection: "yes", odds: 1.6 });
    expect(rows).toContainEqual({ market: "ou_2_5", selection: "under", odds: 2.6 });
    expect(rows).toHaveLength(7); // 3 + 2 + 2
  });
  it("skips inactive markets and markets we do not use", () => {
    const rows = extractRows(block);
    expect(rows.some((r: { market: string }) => r.market === "ou_3_5")).toBe(false);
  });
  it("skips inactive prices and prices of 1.0 or less", () => {
    const rows = extractRows({ markets: { 101: { marketActive: true, outcomes: { 101: price(1.0), 102: price(3, false), 103: price(2.5) } } } });
    expect(rows).toEqual([{ market: "1x2", selection: "away", odds: 2.5 }]);
  });
  it("an empty or missing block gives no rows", () => {
    expect(extractRows(undefined)).toEqual([]);
    expect(extractRows({})).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits 9 leagues into groups of 5 and 4 (OddsPapi allows 5 per call)", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9]]);
    expect(chunk([], 5)).toEqual([]);
  });
});
