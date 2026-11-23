import { useEffect, useState } from "react";
import { api, ApiError, type LeagueRow } from "../api";
import { ageText } from "../format";
import { Footer } from "../components/Footer";
import { getTheme, setTheme, type Theme } from "../theme";

export function Leagues({ onUnauthorized, onSignOut }: { onUnauthorized: () => void; onSignOut: () => void }) {
  const [rows, setRows] = useState<LeagueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme());

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
      <h1>More</h1>
      <h2>System</h2>
      <p><a href="#/health">Health: what works and what failed →</a></p>
      <h2>Appearance</h2>
      <div className="seg" role="group" aria-label="Colour mode">
        {(["system", "light", "dark"] as const).map((t) => (
          <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); setThemeState(t); }}>
            {t === "system" ? "Device" : t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <h2>Leagues</h2>
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
      <button className="secondary" style={{ marginTop: 24 }} onClick={onSignOut}>Sign out</button>
      <Footer />
    </main>
  );
}
