import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type DailyData, type DailyPick } from "../api";
import { pct } from "../format";
import { DailyCard, dailyRecord } from "./DailyPicks";

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

  const days = useMemo(() => {
    const m = new Map<string, DailyPick[]>();
    for (const p of d?.picks ?? []) (m.get(p.day) ?? m.set(p.day, []).get(p.day)!).push(p);
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [d]);
  const all = dailyRecord(d?.picks ?? []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="stats">
        <div className="stat"><strong>{all.settled ? `${all.won}/${all.settled}` : "—"}</strong><span>won</span></div>
        <div className="stat"><strong>{all.hit === null ? "—" : pct(all.hit)}</strong><span>win rate</span></div>
        <div className="stat"><strong>{all.roi === null ? "—" : `${all.roi >= 0 ? "+" : ""}${(all.roi * 100).toFixed(1)}%`}</strong><span>return</span></div>
      </div>
      <p className="muted small">
        Only Malin's picks of the day, locked each morning. Return is at the best odds shown when chosen (1 unit each);
        your bookmaker may pay a little less. {all.open > 0 ? `${all.open} still waiting.` : ""}
      </p>
      {days.length === 0 && <div className="empty"><p><strong>No picks of the day yet.</strong> The first are chosen tomorrow morning.</p></div>}
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
