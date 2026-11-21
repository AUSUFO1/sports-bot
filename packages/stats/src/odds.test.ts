import { describe, it, expect } from "vitest";
import { impliedProb, removeMargin, edge, expectedValue } from "./odds";

describe("odds math", () => {
  it("implied probability of 2.00 is 0.5", () => expect(impliedProb(2)).toBeCloseTo(0.5, 10));
  it("removes margin proportionally", () => {
    // 1.90 / 1.90 -> implied 0.5263 each, total 1.0526, margin 0.0526, fair 0.5 each
    const r = removeMargin([1.9, 1.9]);
    expect(r.margin).toBeCloseTo(0.052632, 5);
    expect(r.fair[0]).toBeCloseTo(0.5, 10);
  });
  it("edge and EV", () => {
    expect(edge(0.54, 0.5)).toBeCloseTo(0.04, 10);
    expect(expectedValue(0.54, 1.95)).toBeCloseTo(0.053, 10);
  });
});
