export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export const LABELS: Record<string, string> = {
  home: "Home win",
  draw: "Draw",
  away: "Away win",
  over: "Over",
  under: "Under",
  yes: "Yes",
  no: "No",
};
export const MARKET_NAMES: Record<string, string> = {
  "1x2": "Match result",
  ou_1_5: "Goals over/under 1.5",
  ou_2_5: "Goals over/under 2.5",
  ou_3_5: "Goals over/under 3.5",
  btts: "Both teams to score",
};

/** Plain-words name for a pick, e.g. "Over 2.5 goals", "Both teams score: Yes". */
export function pickLabel(market: string, selection: string): string {
  const m = /^ou_(\d)_(\d)$/.exec(market);
  if (m) return `${selection === "over" ? "Over" : "Under"} ${m[1]}.${m[2]} goals`;
  if (market === "btts") return `Both teams score: ${selection === "yes" ? "Yes" : "No"}`;
  if (market === "1x2") return selection === "draw" ? "Draw" : selection === "home" ? "Home win" : "Away win";
  return `${market} ${selection}`;
}

/** Colour group for a pick: result, draw, goals or btts. Drives the colour coding in the CSS. */
export function pickGroup(market: string, selection: string): "result" | "draw" | "goals" | "btts" {
  if (market === "btts") return "btts";
  if (market.startsWith("ou_")) return "goals";
  return selection === "draw" ? "draw" : "result";
}
export const GROUP_NAMES = { result: "Result", draw: "Draw", goals: "Goals", btts: "BTTS" } as const;

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA"); // local YYYY-MM-DD

export function ageHours(iso: string | null): number | null {
  return iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : null;
}
export function ageText(iso: string | null): string {
  const h = ageHours(iso);
  if (h === null) return "never";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
/** green = under 12 h, amber = under 48 h, red = older or missing */
export function freshness(iso: string | null): "fresh" | "aging" | "stale" {
  const h = ageHours(iso);
  return h === null || h > 48 ? "stale" : h > 12 ? "aging" : "fresh";
}

/** Low / average / high scoring, from the model's chance of over 2.5 goals: high at 60%+, low at 40% or less. */
export type Scoring = "low" | "average" | "high";
export function scoringOf(pOver25: number | null | undefined): Scoring | null {
  if (pOver25 === null || pOver25 === undefined) return null;
  if (pOver25 >= 0.6) return "high";
  if (pOver25 <= 0.4) return "low";
  return "average";
}
export const SCORING_NAMES: Record<Scoring, string> = { low: "Low-scoring", average: "Average goals", high: "High-scoring" };

/** The value label that replaces "NO BET": value found, no value at these odds, or odds not in yet. */
export type ValueState = "value" | "novalue" | "pending" | "noreport";
export function valueStateOf(g: { hasReport: boolean; verdict: string | null; oddsFetchedAt: string | null }): ValueState {
  if (!g.hasReport) return "noreport";
  if (g.verdict === "BET_CANDIDATE") return "value";
  return g.oddsFetchedAt ? "novalue" : "pending";
}
export const VALUE_NAMES: Record<ValueState, string> = {
  value: "VALUE ✓",
  novalue: "NO VALUE",
  pending: "ODDS PENDING",
  noreport: "NO REPORT YET",
};

/** The model's most likely result, e.g. { label: "Home win", prob: 0.6 }. */
export function modelLean(pHome: number | null, pDraw: number | null, pAway: number | null): { label: string; prob: number } | null {
  if (pHome === null || pDraw === null || pAway === null) return null;
  const opts = [
    { label: "Home win", prob: pHome },
    { label: "Draw", prob: pDraw },
    { label: "Away win", prob: pAway },
  ];
  return opts.sort((a, b) => b.prob - a.prob)[0]!;
}

/** The "of the day" categories for the pills on the Picks page. */
export type Category = "under" | "over" | "btts" | "draw" | "win";
export function categoryOf(market: string, selection: string): Category {
  if (market.startsWith("ou_")) return selection === "under" ? "under" : "over";
  if (market === "btts") return "btts";
  return selection === "draw" ? "draw" : "win";
}
export const CATEGORY_NAMES: Record<Category, string> = {
  under: "Unders",
  over: "Overs",
  btts: "BTTS",
  draw: "Draws",
  win: "Wins",
};
