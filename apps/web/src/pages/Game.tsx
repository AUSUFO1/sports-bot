import { useEffect, useState } from "react";
import { api, ApiError, type Report } from "../api";
import { ageText, dayLabel, freshness, LABELS, MARKET_NAMES, pct, signedPct, time } from "../format";
import { Footer } from "../components/Footer";

export function Game({ id, onUnauthorized }: { id: string; onUnauthorized: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setR(null);
    setError(null);
    api<Report>(`/api/games/${encodeURIComponent(id)}`)
      .then(setR)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        if (e instanceof ApiError && e.status === 404) return setError("No report for this game yet. It is built after the data job runs.");
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <a href="#/" className="back">← All games</a>
      {error && <p className="error" role="alert">{error}</p>}
      {!r && !error && <p className="muted">Loading report…</p>}
      {r && <Detail r={r} />}
      <Footer modelVersion={r?.model?.version} />
    </main>
  );
}

function Detail({ r }: { r: Report }) {
  const fx = freshness(r.dataFreshness.fixtures);
  const markets = r.model ? Object.keys(r.model.probabilities) : [];
  return (
    <>
      <header className="gamehead">
        <p className="muted">{dayLabel(r.kickoffUtc)} · {time(r.kickoffUtc)}</p>
        <h1>{r.home} <span className="vs">vs</span> {r.away}</h1>
        <p className="muted">
          <span className={`dot ${fx}`} aria-hidden /> Fixtures {ageText(r.dataFreshness.fixtures)} · Odds{" "}
          {r.dataFreshness.odds ? ageText(r.dataFreshness.odds) : "none"}
        </p>
      </header>

      <section className={`verdict ${r.verdict === "BET_CANDIDATE" ? "candidate" : "nobet"}`}>
        <div>
          <strong>{r.verdict === "BET_CANDIDATE" ? "CANDIDATE" : "NO BET"}</strong>
          <span> · confidence {r.confidence}</span>
        </div>
        <p>
          {r.verdict === "BET_CANDIDATE"
            ? "The data shows value on the selections below. It is an estimate, not a promise."
            : "The data shows no edge here."}
        </p>
        {r.shortlist.length > 0 && (
          <ul className="plain">
            {r.shortlist.map((s) => (
              <li key={s.market + s.selection}>
                {MARKET_NAMES[s.market] ?? s.market}: <strong>{LABELS[s.selection] ?? s.selection}</strong> at {s.odds.toFixed(2)} (EV {pct(s.ev)})
              </li>
            ))}
          </ul>
        )}
      </section>

      {r.warnings.length > 0 && (
        <section className="warnings" aria-label="Warnings">
          <h2>Warnings</h2>
          <ul>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      {!r.model && <p className="empty">The model could not run for this game, so there are no probabilities.</p>}

      {r.model && (
        <>
          <section>
            <h2>Model vs bookmaker</h2>
            <p className="muted">
              Expected goals {r.model.expectedGoals.home.toFixed(2)} – {r.model.expectedGoals.away.toFixed(2)} · based on{" "}
              {r.sample.homeMatches} and {r.sample.awayMatches} recent matches
            </p>
            {markets.map((m) => (
              <div key={m} className="market">
                <h3>{MARKET_NAMES[m] ?? m}</h3>
                {Object.entries(r.model!.probabilities[m]!).map(([sel, p]) => {
                  const fair = r.market.fairProbabilities[m]?.[sel];
                  return (
                    <div key={sel} className="bars">
                      <span className="sel">{LABELS[sel] ?? sel}</span>
                      <div className="barcol">
                        <Bar label="Model" value={p} kind="model" />
                        {fair !== undefined ? <Bar label="Market" value={fair} kind="market" /> : <span className="muted small">No market price</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          <section>
            <h2>Value</h2>
            {r.value.length === 0 ? (
              <p className="muted">No value table: there are no bookmaker odds for this game yet.</p>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>Market</th><th>Pick</th><th>Odds</th><th>Edge</th><th>EV</th></tr>
                  </thead>
                  <tbody>
                    {r.value.map((v) => {
                      const on = r.shortlist.some((s) => s.market === v.market && s.selection === v.selection);
                      return (
                        <tr key={v.market + v.selection} className={on ? "hit" : ""}>
                          <td>{MARKET_NAMES[v.market] ?? v.market}</td>
                          <td>{LABELS[v.selection] ?? v.selection}</td>
                          <td>{v.odds.toFixed(2)}</td>
                          <td>{signedPct(v.edge)}</td>
                          <td>{signedPct(v.ev)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2>Most likely scores</h2>
            <ul className="scores">
              {r.model.topScorelines.map((s) => (
                <li key={s.score}><strong>{s.score}</strong> <span className="muted">{pct(s.prob)}</span></li>
              ))}
            </ul>
            <p className="muted">
              Elo cross-check (home / draw / away): {pct(r.model.eloCheck.home)} / {pct(r.model.eloCheck.draw)} / {pct(r.model.eloCheck.away)} —{" "}
              {r.model.eloCheck.agrees ? "agrees with the main model" : "disagrees with the main model"}.
            </p>
          </section>
        </>
      )}

      <section>
        <h2>AI analysis</h2>
        <p className="muted">Not available yet. It arrives in a later phase and will only explain the numbers above.</p>
      </section>
    </>
  );
}

function Bar({ label, value, kind }: { label: string; value: number; kind: "model" | "market" }) {
  return (
    <div className="bar" role="img" aria-label={`${label} ${pct(value)}`}>
      <span className="barlabel">{label}</span>
      <span className="track"><span className={`fill ${kind}`} style={{ width: `${Math.min(100, value * 100)}%` }} /></span>
      <span className="barvalue">{pct(value)}</span>
    </div>
  );
}
