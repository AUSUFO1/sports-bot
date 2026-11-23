import { describe, it, expect } from "vitest";
import { applyFilters, byConfidence, byDay, byType, dayOf, hourOf, summarize, type PickLike } from "./historyStats";

const TZ = "UTC";
const p = (id: string, kickoffUtc: string, result: PickLike["result"], over: Partial<PickLike> = {}): PickLike => ({
  matchId: id, kickoffUtc, market: "ou_2_5", selection: "over", modelProb: 0.7, result, ...over,
});

// Nov 21 (Sat): 3 picks, 2 won 1 lost. Nov 22 (Sun): 2 picks, both won. Nov 23 (Mon): 1 waiting.
const data: PickLike[] = [
  p("a", "2026-11-21T12:30:00Z", "win"),
  p("b", "2026-11-21T15:30:00Z", "win", { market: "btts", selection: "yes", modelProb: 0.62 }),
  p("c", "2026-11-21T19:30:00Z", "loss", { market: "1x2", selection: "home", modelProb: 0.66 }),
  p("d", "2026-11-22T14:30:00Z", "win"),
  p("d", "2026-11-22T14:30:00Z", "win", { market: "ou_3_5", selection: "under", modelProb: 0.83 }),
  p("e", "2026-11-23T16:00:00Z", null),
];
const NOW = new Date("2026-11-23T10:00:00Z");

describe("history summary (hand-counted)", () => {
  it("all: 6 picks over 5 games, 4 won, 1 lost, 1 waiting, hit rate 4/5 = 80%", () => {
    const s = summarize(data);
    expect(s).toMatchObject({ picks: 6, games: 5, won: 4, lost: 1, waiting: 1, voided: 0 });
    expect(s.hitRate).toBeCloseTo(0.8, 12);
  });
  it("a day with no losses: Nov 22 is 2 won, 0 lost, rate 100%", () => {
    const s = summarize(applyFilters(data, { range: "day", day: "2026-11-22" }, NOW, TZ));
    expect(s).toMatchObject({ picks: 2, games: 1, won: 2, lost: 0 });
    expect(s.hitRate).toBe(1);
  });
  it("nothing settled gives a null hit rate, not 0%", () => {
    expect(summarize([p("x", "2026-11-23T16:00:00Z", null)]).hitRate).toBeNull();
    expect(summarize([]).hitRate).toBeNull();
  });
  it("void picks count as neither won nor lost", () => {
    const s = summarize([p("x", "2026-11-21T12:00:00Z", "void"), p("y", "2026-11-21T12:00:00Z", "win")]);
    expect(s).toMatchObject({ won: 1, lost: 0, voided: 1 });
    expect(s.hitRate).toBe(1);
  });
});

describe("filters", () => {
  it("today = Nov 23 (1 pick); yesterday = Nov 22 (2 picks); last 7 days = all 6", () => {
    expect(applyFilters(data, { range: "today" }, NOW, TZ)).toHaveLength(1);
    expect(applyFilters(data, { range: "yesterday" }, NOW, TZ)).toHaveLength(2);
    expect(applyFilters(data, { range: "7d" }, NOW, TZ)).toHaveLength(6);
  });
  it("7 days excludes a pick from 8 days ago", () => {
    const old = [...data, p("z", "2026-11-14T12:00:00Z", "win")];
    expect(applyFilters(old, { range: "7d" }, NOW, TZ)).toHaveLength(6);
  });
  it("hour window 12:00 to 16:00 keeps 12:30 and 15:30 and 14:30 x2, not 19:30 or 16:00", () => {
    const r = applyFilters(data, { range: "all", fromHour: 12, toHour: 16 }, NOW, TZ);
    expect(r.map((x) => x.matchId).sort()).toEqual(["a", "b", "d", "d"]); // 16:00 is excluded (end is exclusive)
  });
  it("day + hours together: Nov 21 from 15:00 to 24:00 is b (win) and c (loss)", () => {
    const s = summarize(applyFilters(data, { range: "day", day: "2026-11-21", fromHour: 15, toHour: 24 }, NOW, TZ));
    expect(s).toMatchObject({ picks: 2, won: 1, lost: 1 });
  });
  it("type filter: goals picks are the ou_ markets (a, d, d), btts is b, result is c", () => {
    expect(applyFilters(data, { range: "all", group: "goals" }, NOW, TZ)).toHaveLength(4); // a, d, d (over 2.5, under 3.5) + e
    expect(applyFilters(data, { range: "all", group: "btts" }, NOW, TZ).map((x) => x.matchId)).toEqual(["b"]);
    expect(applyFilters(data, { range: "all", group: "result" }, NOW, TZ).map((x) => x.matchId)).toEqual(["c"]);
  });
  it("result filter: won 4, lost 1, waiting 1", () => {
    expect(applyFilters(data, { range: "all", result: "win" }, NOW, TZ)).toHaveLength(4);
    expect(applyFilters(data, { range: "all", result: "loss" }, NOW, TZ)).toHaveLength(1);
    expect(applyFilters(data, { range: "all", result: "open" }, NOW, TZ)).toHaveLength(1);
  });
  it("a late-night UTC kickoff falls on the next local day in Lagos time (UTC+1)", () => {
    expect(dayOf("2026-11-21T23:30:00Z", "UTC")).toBe("2026-11-21");
    expect(dayOf("2026-11-21T23:30:00Z", "Africa/Lagos")).toBe("2026-11-22");
    expect(hourOf("2026-11-21T23:30:00Z", "Africa/Lagos")).toBe(0);
  });
});

describe("breakdowns", () => {
  it("by day, newest first: Nov 23 waiting, Nov 22 2-0, Nov 21 2-1", () => {
    const rows = byDay(data, TZ);
    expect(rows.map((r) => r.day)).toEqual(["2026-11-23", "2026-11-22", "2026-11-21"]);
    expect(rows[1]).toMatchObject({ won: 2, lost: 0 });
    expect(rows[2]).toMatchObject({ won: 2, lost: 1 });
  });
  it("by confidence: 60s bucket has b (win) and c (loss); 70s has a and d (wins); 80s has the 0.83 win", () => {
    expect(byConfidence(data)).toEqual([
      { bucket: 60, won: 1, lost: 1 },
      { bucket: 70, won: 2, lost: 0 },
      { bucket: 80, won: 1, lost: 0 },
    ]);
  });
  it("by type counts settled picks only", () => {
    const t = byType(data);
    expect(t.find((x) => x.market === "ou_2_5")).toMatchObject({ won: 2, lost: 0 }); // a, d; e is waiting
    expect(t.find((x) => x.market === "1x2")).toMatchObject({ won: 0, lost: 1 });
  });
});
