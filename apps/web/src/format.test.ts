import { describe, it, expect } from "vitest";
import { categoryOf, modelLean, scoringOf, valueStateOf } from "./format";

describe("scoring label (from the model's over 2.5 chance)", () => {
  it("60% or more is high-scoring, 40% or less is low-scoring, in between is average", () => {
    expect(scoringOf(0.732)).toBe("high");
    expect(scoringOf(0.6)).toBe("high");
    expect(scoringOf(0.59)).toBe("average");
    expect(scoringOf(0.41)).toBe("average");
    expect(scoringOf(0.4)).toBe("low");
    expect(scoringOf(0.25)).toBe("low");
  });
  it("no model number gives no label instead of a guess", () => {
    expect(scoringOf(null)).toBeNull();
    expect(scoringOf(undefined)).toBeNull();
  });
});

describe("value label (replaces NO BET)", () => {
  it("value found, no value at these odds, odds pending, or no report", () => {
    expect(valueStateOf({ hasReport: true, verdict: "BET_CANDIDATE", oddsFetchedAt: "x" })).toBe("value");
    expect(valueStateOf({ hasReport: true, verdict: "NO_BET", oddsFetchedAt: "2026-11-23T06:00:00Z" })).toBe("novalue");
    expect(valueStateOf({ hasReport: true, verdict: "NO_BET", oddsFetchedAt: null })).toBe("pending");
    expect(valueStateOf({ hasReport: false, verdict: null, oddsFetchedAt: null })).toBe("noreport");
  });
});

describe("model lean", () => {
  it("picks the most likely result: 0.60 / 0.24 / 0.16 is Home win 60%", () => {
    expect(modelLean(0.6, 0.24, 0.16)).toEqual({ label: "Home win", prob: 0.6 });
    expect(modelLean(0.2, 0.31, 0.49)).toEqual({ label: "Away win", prob: 0.49 });
  });
  it("missing numbers give no lean", () => expect(modelLean(null, 0.3, 0.3)).toBeNull());
});

describe("pick categories for the pills", () => {
  it("under/over lines, BTTS yes and no, draws and wins", () => {
    expect(categoryOf("ou_3_5", "under")).toBe("under");
    expect(categoryOf("ou_2_5", "over")).toBe("over");
    expect(categoryOf("btts", "yes")).toBe("btts");
    expect(categoryOf("btts", "no")).toBe("btts");
    expect(categoryOf("1x2", "draw")).toBe("draw");
    expect(categoryOf("1x2", "home")).toBe("win");
    expect(categoryOf("1x2", "away")).toBe("win");
  });
});
