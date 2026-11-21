import { useEffect, useState } from "react";
import { api, ApiError, type LeagueRow } from "../api";
import { ageText } from "../format";
import { Footer } from "../components/Footer";

export function Leagues({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [rows, setRows] = useState<LeagueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LeagueRow[]>("/api/leagues")
      .then(setRows)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = (rows ?? []).filter((r) => r.dataStatus === "ready");
  const empty = (rows ?? []).filter((r) => r.dataStatus !== "ready");

  return (
    <main className="page">
      <h1>Leagues</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted">Loading leagues…</p>}
      {rows && (
        <>
          <h2 className="day">Data ready ({ready.length})</h2>
          {ready.length === 0 && <p className="muted">No league has data yet.</p>}
          <ul className="plain">
            {ready.map((r) => (
              <li key={r.id} className="leaguerow">
                <span>{r.name}</span>
                <span className="muted">{r.matches} matches · updated {ageText(r.fetchedAt)}</span>
              </li>
            ))}
          </ul>
          <h2 className="day">Data not filled ({empty.length})</h2>
          <ul className="plain">
            {empty.map((r) => (
              <li key={r.id} className="leaguerow">
                <span>{r.name}</span>
                <span className="badge pending">DATA NOT FILLED</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Footer />
    </main>
  );
}
