import { useEffect, useState } from "react";
import { api, ApiError, type History as H } from "../api";
import { dayLabel, GROUP_NAMES, pct, pickGroup, pickLabel } from "../format";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

const rate = (w: number, l: number) => (w + l === 0 ? "—" : pct(w / (w + l)));

export function History({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [h, setH] = useState<H | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<H>("/api/history")
      .then(setH)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const wins = h?.byMarket.reduce((s, r) => s + r.wins, 0) ?? 0;
  const losses = h?.byMarket.reduce((s, r) => s + r.losses, 0) ?? 0;

  return (
    <main className="page">
      <h1>History</h1>
      <p className="lead">Every pick is saved before kickoff and settled after the 90 minutes. Losses stay in.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!h && !error && <p className="muted">Loading history…</p>}

      {h && (
        <>
          <div className="stats">
            <div className="stat"><strong>{rate(wins, losses)}</strong><span>hit rate</span></div>
            <div className="stat"><strong>{wins}–{losses}</strong><span>won–lost</span></div>
            <div className="stat"><strong>{h.open}</strong><span>waiting</span></div>
          </div>

          {h.byMarket.length > 0 && (
            <>
              <h2>By pick type</h2>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Pick</th><th>Won</th><th>Lost</th><th>Rate</th></tr></thead>
                  <tbody>
                    {h.byMarket.map((r) => (
                      <tr key={r.market + r.selection}>
                        <td>{pickLabel(r.market, r.selection)}</td>
                        <td>{r.wins}</td><td>{r.losses}</td><td>{rate(r.wins, r.losses)}</td>
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
                    {h.byBucket.map((r) => (
                      <tr key={r.bucket}>
                        <td>{r.bucket}–{r.bucket + 10}%</td>
                        <td>{r.wins}</td><td>{r.losses}</td><td>{rate(r.wins, r.losses)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">If the model is honest, "Actual" should sit near what it said. Small samples mean little.</p>
            </>
          )}

          <h2>All picks</h2>
          {h.picks.length === 0 && <div className="empty"><p><strong>Nothing logged yet.</strong> Picks are saved when reports are built.</p></div>}
          <ul className="games">
            {h.picks.map((p) => (
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
