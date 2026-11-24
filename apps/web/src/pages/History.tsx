import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type History as H } from "../api";
import { dayLabel, GROUP_NAMES, pct, pickGroup, pickLabel } from "../format";
import { applyFilters, byConfidence, byDay, byType, summarize, type Filters } from "../historyStats";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

const rate = (w: number, l: number) => (w + l === 0 ? "—" : pct(w / (w + l)));
const RANGES: { id: Filters["range"]; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "day", label: "Pick a day" },
];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function History({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [h, setH] = useState<H | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>({ range: "all" });

  useEffect(() => {
    api<H>("/api/history")
      .then(setH)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (h ? applyFilters(h.picks, f) : []), [h, f]);
  const sum = useMemo(() => summarize(shown), [shown]);
  const days = useMemo(() => byDay(h ? applyFilters(h.picks, { ...f, range: f.range === "day" ? "all" : f.range }) : []), [h, f]);
  const types = useMemo(() => byType(shown), [shown]);
  const buckets = useMemo(() => byConfidence(shown), [shown]);
  const settled = sum.won + sum.lost;
  const filtered = f.range !== "all" || f.fromHour !== undefined || f.toHour !== undefined || f.group || f.result;
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));

  return (
    <main className="page">
      <h1>History</h1>
      <p className="lead">Every pick is saved before kickoff and settled after the 90 minutes. Losses stay in.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!h && !error && <p className="muted">Loading history…</p>}

      {h && (
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
            <div className="fieldrow">
              <label className="field">Kickoff from
                <select value={f.fromHour ?? ""} onChange={(e) => set({ fromHour: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">Any</option>
                  {HOURS.slice(0, 24).map((x) => <option key={x} value={x}>{hh(x)}</option>)}
                </select>
              </label>
              <label className="field">to
                <select value={f.toHour ?? ""} onChange={(e) => set({ toHour: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">Any</option>
                  {HOURS.slice(1).map((x) => <option key={x} value={x}>{hh(x)}</option>)}
                </select>
              </label>
            </div>
            <div className="chips" role="group" aria-label="Pick type">
              <button className="chip" aria-pressed={!f.group} onClick={() => set({ group: undefined })}>All types</button>
              {(["result", "draw", "goals", "btts"] as const).map((g) => (
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

          <section className="summary" aria-live="polite">
            <div className="sumline">
              {settled === 0 ? (
                <strong>Nothing settled in this view yet</strong>
              ) : (
                <>
                  <strong>{sum.won} of {settled} won</strong>
                  <span className={sum.lost === 0 ? "good" : "muted"}>{sum.lost === 0 ? " · no losses" : ` · ${sum.lost} lost`}</span>
                </>
              )}
            </div>
            <p className="muted small">
              {sum.picks} pick{sum.picks === 1 ? "" : "s"} across {sum.games} game{sum.games === 1 ? "" : "s"}
              {sum.waiting > 0 ? ` · ${sum.waiting} waiting` : ""}{sum.voided > 0 ? ` · ${sum.voided} void` : ""}
            </p>
            <div className="stats">
              <div className="stat"><strong>{sum.hitRate === null ? "—" : pct(sum.hitRate)}</strong><span>hit rate</span></div>
              <div className="stat"><strong>{sum.won}–{sum.lost}</strong><span>won–lost</span></div>
              <div className="stat"><strong>{sum.waiting}</strong><span>waiting</span></div>
            </div>
          </section>

          {days.length > 0 && (
            <>
              <h2>Day by day</h2>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Day</th><th>Won</th><th>Lost</th><th>Wait</th><th>Rate</th></tr></thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.day} className="tap" onClick={() => set({ range: "day", day: d.day })}>
                        <td>{dayLabel(`${d.day}T12:00:00`).replace(/^\w+, /, "")}</td>
                        <td>{d.won}</td><td>{d.lost}</td><td>{d.waiting}</td><td>{rate(d.won, d.lost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Tap a day to open it.</p>
            </>
          )}

          {types.length > 0 && (
            <>
              <h2>By pick type</h2>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Pick</th><th>Won</th><th>Lost</th><th>Rate</th></tr></thead>
                  <tbody>
                    {types.map((r) => (
                      <tr key={r.market + r.selection}>
                        <td>{pickLabel(r.market, r.selection)}</td>
                        <td>{r.won}</td><td>{r.lost}</td><td>{rate(r.won, r.lost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>By model confidence</h2>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Model said</th><th>Won</th><th>Lost</th><th>Actual</th></tr></thead>
                  <tbody>
                    {buckets.map((r) => (
                      <tr key={r.bucket}>
                        <td>{r.bucket}–{r.bucket + 10}%</td>
                        <td>{r.won}</td><td>{r.lost}</td><td>{rate(r.won, r.lost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">If the model is honest, "Actual" sits near what it said. Small samples mean little.</p>
            </>
          )}

          <h2>Picks ({shown.length})</h2>
          {shown.length === 0 && (
            <div className="empty"><p><strong>{h.picks.length === 0 ? "Nothing logged yet." : "No picks match these filters."}</strong></p></div>
          )}
          <ul className="games">
            {/* Finished picks (won, lost, void) first, newest first; then picks still waiting, soonest kickoff first. */}
            {h.picks
              .filter((p) => shown.includes(p))
              .sort((a, b) =>
                Number(a.result === null) - Number(b.result === null) ||
                (a.result === null ? a.kickoffUtc.localeCompare(b.kickoffUtc) : b.kickoffUtc.localeCompare(a.kickoffUtc)),
              )
              .map((p) => (
              <li key={p.id}>
                <a className="game" href={`#/game/${encodeURIComponent(p.matchId)}`}>
                  <div className="gtop">
                    <span>{dayLabel(p.kickoffUtc)} · {p.leagueName.replace(/\s*\(.*\)$/, "")}</span>
                    <ResultBadge r={p.result} />
                  </div>
                  <div className="gmain">
                    <span className="teams">
                      <span className="teamline"><Crest src={p.homeCrest} name={p.home} /><span>{p.home}</span></span>
                      <span className="teamline"><Crest src={p.awayCrest} name={p.away} /><span>{p.away}</span></span>
                    </span>
                    <span className={`meta g-${pickGroup(p.market, p.selection)}`}>
                      <span className="tag">{GROUP_NAMES[pickGroup(p.market, p.selection)]}</span>
                      <strong>{pickLabel(p.market, p.selection)}</strong>
                      <span className="muted small">{pct(p.modelProb)}{p.odds ? ` · @ ${p.odds.toFixed(2)}` : ""}</span>
                    </span>
                  </div>
                  <div className="probtext">
                    <span>Model score {p.predictedScore ?? "—"}</span>
                    <span>Final {p.finalScore ?? "—"}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <Footer />
    </main>
  );
}

function ResultBadge({ r }: { r: "win" | "loss" | "void" | null }) {
  if (r === "win") return <span className="badge candidate">WON</span>;
  if (r === "loss") return <span className="badge loss">LOST</span>;
  if (r === "void") return <span className="badge nobet">VOID</span>;
  return <span className="badge pending">WAITING</span>;
}
