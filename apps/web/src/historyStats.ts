import { pickGroup } from "./format";

/** The few fields the history maths needs. */
export interface PickLike {
  matchId: string;
  kickoffUtc: string;
  market: string;
  selection: string;
  modelProb: number;
  result: "win" | "loss" | "void" | null;
}

export interface Filters {
  range: "all" | "today" | "yesterday" | "7d" | "day";
  /** YYYY-MM-DD, used when range is "day" */
  day?: string;
  /** kickoff hour window: from (0-23) up to but not including to (1-24) */
  fromHour?: number;
  toHour?: number;
  group?: "result" | "draw" | "goals" | "btts";
  result?: "win" | "loss" | "open";
}

/** Local calendar day (YYYY-MM-DD) of an instant. tz is for tests; the app uses the device's own zone. */
export function dayOf(iso: string | Date, tz?: string): string {
  return new Date(iso).toLocaleDateString("en-CA", tz ? { timeZone: tz } : undefined);
}

export function hourOf(iso: string, tz?: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
  return Number(parts) % 24; // some engines print midnight as 24
}

export function applyFilters(picks: PickLike[], f: Filters, now = new Date(), tz?: string): PickLike[] {
  const today = dayOf(now, tz);
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000), tz);
  const weekStart = dayOf(new Date(now.getTime() - 6 * 86_400_000), tz);
  return picks.filter((p) => {
    const d = dayOf(p.kickoffUtc, tz);
    if (f.range === "today" && d !== today) return false;
    if (f.range === "yesterday" && d !== yesterday) return false;
    if (f.range === "7d" && (d < weekStart || d > today)) return false;
    if (f.range === "day" && f.day && d !== f.day) return false;
    if (f.fromHour !== undefined || f.toHour !== undefined) {
      const h = hourOf(p.kickoffUtc, tz);
      if (h < (f.fromHour ?? 0) || h >= (f.toHour ?? 24)) return false;
    }
    if (f.group && pickGroup(p.market, p.selection) !== f.group) return false;
    if (f.result === "win" && p.result !== "win") return false;
    if (f.result === "loss" && p.result !== "loss") return false;
    if (f.result === "open" && p.result !== null) return false;
    return true;
  });
}

export interface Summary {
  picks: number;
  games: number;
  won: number;
  lost: number;
  voided: number;
  waiting: number;
  /** won / (won + lost), or null when nothing is settled yet */
  hitRate: number | null;
}

export function summarize(picks: PickLike[]): Summary {
  const won = picks.filter((p) => p.result === "win").length;
  const lost = picks.filter((p) => p.result === "loss").length;
  return {
    picks: picks.length,
    games: new Set(picks.map((p) => p.matchId)).size,
    won,
    lost,
    voided: picks.filter((p) => p.result === "void").length,
    waiting: picks.filter((p) => p.result === null).length,
    hitRate: won + lost === 0 ? null : won / (won + lost),
  };
}

export interface DayRow extends Summary {
  day: string;
}

/** One row per local day, newest first. */
export function byDay(picks: PickLike[], tz?: string): DayRow[] {
  const groups = new Map<string, PickLike[]>();
  for (const p of picks) {
    const d = dayOf(p.kickoffUtc, tz);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(p);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => ({ day, ...summarize(list) }));
}

/** Win rate by how confident the model was, in 10-point buckets (60 means 60-70%). */
export function byConfidence(picks: PickLike[]): { bucket: number; won: number; lost: number }[] {
  const m = new Map<number, { won: number; lost: number }>();
  for (const p of picks) {
    if (p.result !== "win" && p.result !== "loss") continue;
    const b = Math.floor(p.modelProb * 10) * 10;
    const cur = m.get(b) ?? { won: 0, lost: 0 };
    if (p.result === "win") cur.won++;
    else cur.lost++;
    m.set(b, cur);
  }
  return [...m.entries()].sort(([a], [b]) => a - b).map(([bucket, v]) => ({ bucket, ...v }));
}

export function byType(picks: PickLike[]): { market: string; selection: string; won: number; lost: number }[] {
  const m = new Map<string, { market: string; selection: string; won: number; lost: number }>();
  for (const p of picks) {
    if (p.result !== "win" && p.result !== "loss") continue;
    const k = `${p.market}|${p.selection}`;
    const cur = m.get(k) ?? { market: p.market, selection: p.selection, won: 0, lost: 0 };
    if (p.result === "win") cur.won++;
    else cur.lost++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => (a.market + a.selection).localeCompare(b.market + b.selection));
}
