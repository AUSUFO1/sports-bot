import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type DailyData, type DailyPick } from "../api";
import { GROUP_NAMES, pct, pickGroup } from "../format";
import { usePersisted } from "../nav";
import { DailyCard, dailyRecord } from "./DailyPicks";

export interface TopFilters {
  range: "all" | "today" | "yesterday" | "7d" | "30d" | "day";
  day?: string; // YYYY-MM-DD when range is "day"
  group?: "result" | "goals" | "btts";
  result?: "win" | "loss" | "open";
}

const RANGES: { id: TopFilters["range"]; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "day", label: "Pick a day" },
];

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Filters on the pick's own day (Malin's day, WAT), so "today" matches the day the pick was chosen for. */
export function filterTop(picks: DailyPick[], f: TopFilters, today: string): DailyPick[] {
  return picks.filter((p) => {
    if (f.range === "today" && p.day !== today) return false;
    if (f.range === "yesterday" && p.day !== shiftDay(today, -1)) return false;
    if (f.range === "7d" && p.day < shiftDay(today, -6)) return false;
    if (f.range === "30d" && p.day < shiftDay(today, -29)) return false;
    if (f.range === "day" && f.day && p.day !== f.day) return false;
    if (f.group && pickGroup(p.market, p.selection) !== f.group) return false;
    if (f.result === "open" && p.result !== null) return false;
    if ((f.result === "win" || f.result === "loss") && p.result !== f.result) return false;
    return true;
  });
}

const dayTitle = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

/** The separate record of Malin's picks of the day: overall, then day by day (newest first). */
export function TopRecord({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [d, setD] = useState<DailyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<DailyData>("/api/daily")
      .then(setD)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [f, setF] = usePersisted<TopFilters>("history:top:filters", { range: "all" });
  const set = (patch: Partial<TopFilters>) => setF((cur) => ({ ...cur, ...patch }));
  const shown = useMemo(() => (d ? filterTop(d.picks, f, d.today) : []), [d, f]);

  const days = useMemo(() => {
    const m = new Map<string, DailyPick[]>();
    for (const p of shown) (m.get(p.day) ?? m.set(p.day, []).get(p.day)!).push(p);
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [shown]);
  const all = dailyRecord(shown);
  const filtered = f.range !== "all" || !!f.result || !!f.group;

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <section className="filters" aria-label="Filters">
        <div className="chips" role="group" aria-label="Day">
          {RANGES.map((r) => (
            <button key={r.id} className="chip" aria-pressed={f.range === r.id} onClick={() => set({ range: r.id, day: r.id === "day" ? f.day : undefined })}>
              {r.label}
            </button>
          ))}
        </div>
        {f.range === "day" && (
          <label className="field">Day
            <input type="date" value={f.day ?? ""} onChange={(e) => set({ day: e.target.value || undefined })} />
          </label>
        )}
        <div className="chips" role="group" aria-label="Pick type">
          <button className="chip" aria-pressed={!f.group} onClick={() => set({ group: undefined })}>All types</button>
          {(["result", "goals", "btts"] as const).map((g) => (
            <button key={g} className="chip" aria-pressed={f.group === g} onClick={() => set({ group: g })}>{GROUP_NAMES[g]}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Result">
          {([[undefined, "Any result"], ["win", "Won"], ["loss", "Lost"], ["open", "Waiting"]] as const).map(([id, label]) => (
            <button key={label} className="chip" aria-pressed={f.result === id} onClick={() => set({ result: id })}>{label}</button>
          ))}
        </div>
        {filtered && <button className="secondary" onClick={() => setF({ range: "all" })}>Clear filters</button>}
      </section>
      <div className="stats">
        <div className="stat"><strong>{all.settled ? `${all.won}/${all.settled}` : "—"}</strong><span>won</span></div>
        <div className="stat"><strong>{all.hit === null ? "—" : pct(all.hit)}</strong><span>win rate</span></div>
        <div className="stat"><strong>{all.roi === null ? "—" : `${all.roi >= 0 ? "+" : ""}${(all.roi * 100).toFixed(1)}%`}</strong><span>return</span></div>
      </div>
      <p className="muted small">
        Only Malin's picks of the day, locked each morning. Return is at the best odds shown when chosen (1 unit each);
        your bookmaker may pay a little less. {all.open > 0 ? `${all.open} still waiting.` : ""}
      </p>
      {days.length === 0 && (
        <div className="empty">
          <p>
            <strong>{d.picks.length === 0 ? "No picks of the day yet." : "No picks match these filters."}</strong>
            {d.picks.length === 0 ? " The first are chosen at about 10:00 on the next morning with fresh odds." : ""}
          </p>
        </div>
      )}
      {days.map(([day, list]) => {
        const r = dailyRecord(list);
        const summary =
          r.settled === 0
            ? `${list.length} pick${list.length === 1 ? "" : "s"}, waiting`
            : `${r.won} of ${r.settled} won${r.lost === 0 ? ", no losses" : ""}${r.open ? `, ${r.open} waiting` : ""}`;
        return (
          <section key={day}>
            <h2 className="day">{dayTitle(day)} · {summary}</h2>
            <ul className="games">{list.map((p) => <DailyCard key={p.id} p={p} />)}</ul>
          </section>
        );
      })}
    </>
  );
}
