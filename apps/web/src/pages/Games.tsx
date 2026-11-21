import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Game } from "../api";
import { dayKey, dayLabel, freshness, ageText, pct, time } from "../format";
import { Footer } from "../components/Footer";

export function Games({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [league, setLeague] = useState("");

  const load = () => {
    setError(null);
    api<Game[]>("/api/games")
      .then(setGames)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leagues = useMemo(() => [...new Set((games ?? []).map((g) => g.leagueName))].sort(), [games]);
  const grouped = useMemo(() => {
    const byDay = new Map<string, { label: string; byLeague: Map<string, Game[]> }>();
    for (const g of games ?? []) {
      if (league && g.leagueName !== league) continue;
      const k = dayKey(g.kickoffUtc);
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(g.kickoffUtc), byLeague: new Map() });
      const d = byDay.get(k)!;
      if (!d.byLeague.has(g.leagueName)) d.byLeague.set(g.leagueName, []);
      d.byLeague.get(g.leagueName)!.push(g);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [games, league]);

  return (
    <main className="page">
      <div className="row between">
        <h1>Upcoming games</h1>
        <button className="secondary" onClick={load}>Reload</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!games && !error && <p className="muted">Loading games…</p>}

      {games && leagues.length > 1 && (
        <select aria-label="Filter by league" value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="">All leagues</option>
          {leagues.map((l) => <option key={l}>{l}</option>)}
        </select>
      )}

      {games && grouped.length === 0 && (
        <div className="empty">
          <p><strong>Data not filled yet.</strong> No upcoming games are stored for this view.</p>
          <p className="muted">Games appear after the hourly data job has run. <a href="#/leagues">See which leagues have data</a>.</p>
        </div>
      )}

      {grouped.map(([key, day]) => (
        <section key={key}>
          <h2 className="day">{day.label}</h2>
          {[...day.byLeague.entries()].map(([name, list]) => (
            <div key={name} className="league">
              <h3>{name}</h3>
              <ul className="games">
                {list.map((g) => (
                  <li key={g.id}>
                    <a href={`#/game/${encodeURIComponent(g.id)}`} className="game">
                      <span className="time">{time(g.kickoffUtc)}</span>
                      <span className="teams">
                        <span>{g.home}</span>
                        <span>{g.away}</span>
                      </span>
                      <span className="meta">
                        <Badge game={g} />
                        {g.bestEv !== null && <span className="ev">EV {pct(g.bestEv)}</span>}
                        <span
                          className={`dot ${freshness(g.fixturesFetchedAt)}`}
                          title={`Fixture data fetched ${ageText(g.fixturesFetchedAt)}`}
                          aria-label={`Data ${freshness(g.fixturesFetchedAt)}`}
                        />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <Footer />
    </main>
  );
}

function Badge({ game }: { game: Game }) {
  if (!game.hasReport) return <span className="badge pending">NO REPORT YET</span>;
  return game.verdict === "BET_CANDIDATE" ? (
    <span className="badge candidate">CANDIDATE</span>
  ) : (
    <span className="badge nobet">NO BET</span>
  );
}
