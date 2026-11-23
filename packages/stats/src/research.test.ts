import { describe, it, expect } from "vitest";
import { compareWithModel, modelLeans, validateResearch, type ResearchView } from "./research";

const good = {
  result: "home",
  goals: "over",
  btts: "yes",
  confidence: "medium",
  summary: "Bremen are at home and in better form; both sides concede often.",
  keyNews: ["Gladbach miss two defenders", "Bremen scored in each of their last five home games"],
  sources: [1, 3],
};

describe("validateResearch", () => {
  it("accepts a clean answer and keeps valid source numbers", () => {
    const r = validateResearch(good, 5);
    expect(r.ok).toBe(true);
    expect(r.view).toMatchObject({ result: "home", goals: "over", btts: "yes", confidence: "medium", sources: [1, 3] });
    expect(r.issues).toEqual([]);
  });
  it("drops source numbers that do not exist (0, 9 with only 5 results) and says so", () => {
    const r = validateResearch({ ...good, sources: [0, 2, 9, 2] }, 5);
    expect(r.view!.sources).toEqual([2]);
    expect(r.issues.join(" ")).toMatch(/did not match a search result/);
  });
  it("no real sources: kept, but confidence is forced down to low by code", () => {
    const r = validateResearch({ ...good, confidence: "high", sources: [] }, 5);
    expect(r.ok).toBe(true);
    expect(r.view!.confidence).toBe("low");
    expect(r.issues.join(" ")).toMatch(/lowered to low/);
  });
  it("rejects values outside the allowed lists", () => {
    expect(validateResearch({ ...good, result: "win" }, 5).ok).toBe(false);
    expect(validateResearch({ ...good, goals: "lots" }, 5).ok).toBe(false);
    expect(validateResearch({ ...good, btts: true }, 5).ok).toBe(false);
    expect(validateResearch({ ...good, confidence: "very high" }, 5).ok).toBe(false);
  });
  it("rejects a missing summary, bad news list, non-objects, and certainty words", () => {
    expect(validateResearch({ ...good, summary: " " }, 5).ok).toBe(false);
    expect(validateResearch({ ...good, keyNews: "text" }, 5).ok).toBe(false);
    expect(validateResearch(null, 5).ok).toBe(false);
    expect(validateResearch({ ...good, summary: "A guaranteed win for Bremen." }, 5).ok).toBe(false);
  });
  it("trims long text and caps the news list at 8", () => {
    const r = validateResearch({ ...good, summary: "x".repeat(3000), keyNews: Array.from({ length: 12 }, () => "y".repeat(500)) }, 5);
    expect(r.view!.summary.length).toBe(1200);
    expect(r.view!.keyNews).toHaveLength(8);
    expect(r.view!.keyNews[0]!.length).toBe(300);
  });
});

const model = { p1x2: { home: 0.676, draw: 0.169, away: 0.155 }, pOver25: 0.732, pBttsYes: 0.647 };

describe("model leans (hand-checked)", () => {
  it("home 67.6% is the most likely result; over 2.5 at 73.2% means over; BTTS 64.7% means yes", () => {
    expect(modelLeans(model)).toEqual({ result: "home", goals: "over", btts: "yes" });
  });
  it("exactly 50% counts as over / yes; below 50% is under / no", () => {
    expect(modelLeans({ ...model, pOver25: 0.5, pBttsYes: 0.49 })).toMatchObject({ goals: "over", btts: "no" });
  });
  it("away and draw leans", () => {
    expect(modelLeans({ ...model, p1x2: { home: 0.2, draw: 0.3, away: 0.5 } }).result).toBe("away");
    expect(modelLeans({ ...model, p1x2: { home: 0.3, draw: 0.4, away: 0.3 } }).result).toBe("draw");
  });
});

describe("compareWithModel", () => {
  const view = (over: Partial<ResearchView>): ResearchView => ({ ...(good as unknown as ResearchView), ...over });
  it("all three agree: the 'Model + AI agree' badge is earned", () => {
    const c = compareWithModel(view({}), model);
    expect(c.allAgree).toBe(true);
    expect(c.agreeCount).toBe(3);
    expect(c.disagreeCount).toBe(0);
  });
  it("one disagreement (AI says under) removes the badge and is counted", () => {
    const c = compareWithModel(view({ goals: "under" }), model);
    expect(c.goals).toEqual({ model: "over", ai: "under", verdict: "disagree" });
    expect(c.allAgree).toBe(false);
    expect(c.disagreeCount).toBe(1);
  });
  it("'unclear' is neither agree nor disagree, and blocks the badge", () => {
    const c = compareWithModel(view({ btts: "unclear" }), model);
    expect(c.btts.verdict).toBe("unclear");
    expect(c.agreeCount).toBe(2);
    expect(c.disagreeCount).toBe(0);
    expect(c.allAgree).toBe(false);
  });
});
