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
