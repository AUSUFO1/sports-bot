import { describe, it, expect } from "vitest";
import { matchTeam, normalizeName } from "./names";
import { canSpend, recordCall, callsToday } from "./quota";
import { parseFixtures } from "../providers/apiFootball";

class FakeKV {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
}
const kv = new FakeKV() as unknown as KVNamespace;

describe("names", () => {
  it("normalises accents, FC and case", () => {
    expect(normalizeName("Atlético Madrid")).toBe("atletico madrid");
    expect(normalizeName("Arsenal FC")).toBe("arsenal");
  });
  it("matches by alias", () => {
    const teams = [{ id: "t1", name: "Manchester United", aliases: ["Man Utd"] }];
    expect(matchTeam("man utd", teams)).toBe("t1");
    expect(matchTeam("Chelsea", teams)).toBeNull();
  });
});

describe("quota", () => {
  it("stops 10 calls before the 100 limit", async () => {
    const now = new Date("2026-11-21T10:00:00Z");
    for (let i = 0; i < 89; i++) await recordCall(kv, "api-football", now);
    expect(await callsToday(kv, "api-football", now)).toBe(89);
    expect(await canSpend(kv, "api-football", 1, now)).toBe(true); // 90 <= 90
    await recordCall(kv, "api-football", now);
    expect(await canSpend(kv, "api-football", 1, now)).toBe(false); // 91 > 90
  });
  it("resets on a new UTC day", async () => {
    expect(await canSpend(kv, "api-football", 1, new Date("2026-11-22T00:00:01Z"))).toBe(true);
  });
});

describe("parseFixtures", () => {
  it("maps a finished and a scheduled match, skips broken rows", () => {
    const row = (id: number, short: string, gh: number | null) => ({
      fixture: { id, date: "2026-11-28T17:30:00+00:00", status: { short } },
      league: { id: 39, season: 2026 },
      teams: { home: { id: 42, name: "Arsenal" }, away: { id: 49, name: "Chelsea" } },
      goals: { home: gh, away: gh === null ? null : 1 },
    });
    const out = parseFixtures({ response: [row(1, "FT", 2), row(2, "NS", null), { fixture: {} }] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ status: "finished", homeGoals: 2, awayGoals: 1, kickoffUtc: "2026-11-28T17:30:00.000Z" });
    expect(out[1]).toMatchObject({ status: "scheduled", homeGoals: null });
  });
});
