import { describe, it, expect } from "vitest";
import { collectNumbers, findNumberMismatches, numberIsKnown, parseModelJson, validateAnalysis, VERDICT_LINES, type HistorySummary, type ReportLike } from "./aiGuard";

const history: HistorySummary = {
  overall: { won: 14, lost: 10, waiting: 37 },
  byType: [{ market: "ou_2_5", selection: "over", won: 7, lost: 5 }],
};
const reportData = {
  kickoffUtc: "2026-11-27T19:30:00Z",
  home: "SV Werder Bremen",
  away: "Borussia Mönchengladbach",
  sample: { homeMatches: 9, awayMatches: 10 },
  model: {
    expectedGoals: { home: 2.4243, away: 1.051 },
    probabilities: { "1x2": { home: 0.676, draw: 0.169, away: 0.155 }, ou_2_5: { over: 0.732, under: 0.268 } },
    topScorelines: [{ score: "2-1", prob: 0.0956 }],
  },
  market: { byBook: { pinnacle: { "1x2": { home: 1.763 } } } },
};
const noBet: ReportLike = { verdict: "NO_BET", shortlist: [], picks: [{ market: "1x2", selection: "home" }, { market: "ou_2_5", selection: "over" }] };
const candidate: ReportLike = { verdict: "BET_CANDIDATE", shortlist: [{ market: "ou_2_5", selection: "over" }], picks: noBet.picks };
const data = { report: reportData, history };
const good = {
  summary: "Bremen are expected to score 2.42 goals and Gladbach 1.05. The model gives Bremen a 67.6% chance.",
  keyFactors: ["Built on 9 and 10 recent matches", "Most likely score is 2-1"],
  risks: ["Small sample of matches"],
  recommendation: null,
  skip: [],
  reasoning: "The numbers lean to Bremen but the sample is small.",
};

describe("parseModelJson", () => {
  it("reads plain JSON and JSON inside code fences or chatter", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Sure! Here it is: {"a": {"b": 2}} hope that helps')).toEqual({ a: { b: 2 } });
  });
  it("returns null for text with no JSON, broken JSON, or empty text", () => {
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson('{"a": ')).toBeNull();
    expect(parseModelJson("")).toBeNull();
  });
});

describe("numbers (hand-checked)", () => {
  const allowed = collectNumbers(reportData);
  it("collects numbers from values and from digits inside text like dates and club names", () => {
    expect(allowed.has(2.4243)).toBe(true);
    expect(allowed.has(27)).toBe(true); // from the kickoff date
    expect(allowed.has(2026)).toBe(true);
  });
  it("accepts a probability as a percentage: 0.676 is 67.6 or 68", () => {
    expect(numberIsKnown("67.6", allowed)).toBe(true);
    expect(numberIsKnown("68", allowed)).toBe(true);
  });
  it("rejects a percentage the data does not explain: 67 and 83 are not 0.676 or anything else", () => {
    expect(numberIsKnown("67", allowed)).toBe(false);
    expect(numberIsKnown("83", allowed)).toBe(false);
  });
  it("accepts rounded goals: 2.4243 is 2.42 or 2.4, but 2.6 is not", () => {
    expect(numberIsKnown("2.42", allowed)).toBe(true);
    expect(numberIsKnown("2.4", allowed)).toBe(true);
    expect(numberIsKnown("2.6", allowed)).toBe(false);
  });
  it("knows market lines from names: ou_2_5 in the data makes 2.5 a real figure, 3.5 stays unknown", () => {
    expect(numberIsKnown("2.5", allowed)).toBe(true);
    expect(numberIsKnown("3.5", allowed)).toBe(false);
    expect(collectNumbers({ probabilities: { ou_3_5: { over: 0.4 } } }).has(3.5)).toBe(true);
  });
  it("accepts small counts and score digits freely (0 to 10)", () => {
    expect(numberIsKnown("3", allowed)).toBe(true);
    expect(numberIsKnown("10", allowed)).toBe(true);
    expect(numberIsKnown("12", allowed)).toBe(false); // above 10 and not in the data ("11" is known: it is in the kickoff date)
  });
  it("findNumberMismatches lists only the unexplained numbers, once each", () => {
    expect(findNumberMismatches(["a 67.6% chance, 83% sure", "and 83 again, 2-1"], allowed)).toEqual(["83"]);
  });
});

describe("validateAnalysis", () => {
  it("accepts a clean answer and quotes no wrong numbers", () => {
    const r = validateAnalysis(good, noBet, data);
    expect(r.ok).toBe(true);
    expect(r.numberMismatches).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.analysis!.recommendation).toBeNull();
  });
  it("flags (does not discard) a number that is not in the data", () => {
    const r = validateAnalysis({ ...good, summary: "Bremen have an 83% chance." }, noBet, data);
    expect(r.ok).toBe(true);
    expect(r.numberMismatches).toEqual(["83"]);
    expect(r.issues.join(" ")).toMatch(/not in the data: 83/);
  });
  it("rejects an answer that promises a result", () => {
    for (const bad of ["This is a guaranteed win.", "A sure thing for Bremen.", "It is risk-free."]) {
      const r = validateAnalysis({ ...good, summary: bad }, noBet, data);
      expect(r.ok).toBe(false);
      expect(r.issues[0]).toMatch(/certain result/);
    }
  });
  it("NO_BET: any recommendation is removed by code and the answer is still accepted", () => {
    const r = validateAnalysis({ ...good, recommendation: { market: "1x2", selection: "home" } }, noBet, data);
    expect(r.ok).toBe(true);
    expect(r.analysis!.recommendation).toBeNull();
    expect(r.issues.join(" ")).toMatch(/NO BET, so the recommendation was removed/);
  });
  it("candidate: a recommendation outside the shortlist rejects the whole answer", () => {
    const r = validateAnalysis({ ...good, recommendation: { market: "1x2", selection: "home" } }, candidate, data);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/not in the shortlist/);
  });
  it("candidate: a recommendation inside the shortlist is kept", () => {
    const r = validateAnalysis({ ...good, recommendation: { market: "ou_2_5", selection: "over" } }, candidate, data);
    expect(r.ok).toBe(true);
    expect(r.analysis!.recommendation).toEqual({ market: "ou_2_5", selection: "over" });
  });
  it("skip advice is kept only for picks that exist", () => {
    const r = validateAnalysis(
      { ...good, skip: [{ market: "1x2", selection: "home", reason: "Small sample" }, { market: "btts", selection: "yes", reason: "invented" }] },
      noBet,
      data,
    );
    expect(r.analysis!.skip).toEqual([{ market: "1x2", selection: "home", reason: "Small sample" }]);
    expect(r.issues.join(" ")).toMatch(/btts yes was dropped/);
  });
  it("the AI cannot add a pick: skip never creates picks and recommendation cannot grow the shortlist", () => {
    const r = validateAnalysis({ ...good, skip: [{ market: "ou_3_5", selection: "under", reason: "x" }] }, noBet, data);
    expect(r.analysis!.skip).toEqual([]);
  });
  it("rejects answers with the wrong shape", () => {
    expect(validateAnalysis(null, noBet, data).ok).toBe(false);
    expect(validateAnalysis({ ...good, summary: "" }, noBet, data).ok).toBe(false);
    expect(validateAnalysis({ ...good, keyFactors: "text" }, noBet, data).ok).toBe(false);
    expect(validateAnalysis({ ...good, risks: [1, 2] }, noBet, data).ok).toBe(false);
    expect(validateAnalysis({ ...good, reasoning: undefined }, noBet, data).ok).toBe(false);
    expect(validateAnalysis({ ...good, recommendation: { market: 5 } }, noBet, data).ok).toBe(false);
  });
  it("the verdict line is written by code and matches the verdict", () => {
    expect(validateAnalysis(good, noBet, data).verdictLine).toBe(VERDICT_LINES.NO_BET);
    expect(validateAnalysis(good, candidate, data).verdictLine).toBe(VERDICT_LINES.BET_CANDIDATE);
    expect(validateAnalysis(null, candidate, data).verdictLine).toBe(VERDICT_LINES.BET_CANDIDATE);
  });
  it("trims very long text and long lists", () => {
    const r = validateAnalysis({ ...good, summary: "x".repeat(5000), keyFactors: Array.from({ length: 20 }, () => "y".repeat(900)) }, noBet, data);
    expect(r.analysis!.summary.length).toBe(1500);
    expect(r.analysis!.keyFactors).toHaveLength(8);
    expect(r.analysis!.keyFactors[0]!.length).toBe(400);
  });
  it("uses history numbers too: 14 won and 10 lost are known, 58.3% is not stated so it is flagged", () => {
    const ok = validateAnalysis({ ...good, risks: ["Past record is 14 won and 10 lost."] }, noBet, data);
    expect(ok.numberMismatches).toEqual([]);
    const bad = validateAnalysis({ ...good, risks: ["Past hit rate is 58.3%."] }, noBet, data);
    expect(bad.numberMismatches).toEqual(["58.3"]);
  });
});
