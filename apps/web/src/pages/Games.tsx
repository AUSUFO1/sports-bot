import { usePersisted, useScrollMemory } from "../nav";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Game } from "../api";
import { dayKey, dayLabel, freshness, ageText, modelLean, pct, SCORING_NAMES, scoringOf, time, VALUE_NAMES, valueStateOf } from "../format";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

export function Games({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [league, setLeague] = usePersisted("games:league", "");
  useScrollMemory("games", games !== null);

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
  const visible = useMemo(() => (games ?? []).filter((g) => !league || g.leagueName === league), [games, league]);
  const grouped = useMemo(() => {
    const byDay = new Map<string, { label: string; list: Game[] }>();
    for (const g of visible) {
      const k = dayKey(g.kickoffUtc);
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(g.kickoffUtc), list: [] });
      byDay.get(k)!.list.push(g);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const withReport = visible.filter((g) => g.hasReport).length;
  const candidates = visible.filter((g) => g.verdict === "BET_CANDIDATE").length;

  return (
    <main className="page">
      <div className="row between">
        <h1>Upcoming games</h1>
        <button className="secondary" onClick={load}>Reload</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!games && !error && <p className="muted">Loading games…</p>}

      {games && games.length > 0 && (
        <>
          <div className="stats">
            <div className="stat"><strong>{visible.length}</strong><span>games</span></div>
            <div className="stat"><strong>{withReport}</strong><span>analysed</span></div>
            <div className="stat"><strong>{candidates}</strong><span>value found</span></div>
          </div>
          {leagues.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by league">
              <button className="chip" aria-pressed={league === ""} onClick={() => setLeague("")}>All</button>
              {leagues.map((l) => (
                <button key={l} className="chip" aria-pressed={league === l} onClick={() => setLeague(l)}>
                  {l.replace(/\s*\(.*\)$/, "")}
                </button>
              ))}
            </div>
          )}
        </>
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
          <ul className="games">
            {day.list.map((g) => (
              <li key={g.id}>
                <a href={`#/game/${encodeURIComponent(g.id)}`} className="game">
                  <div className="gtop">
                    <span>
                      {g.leagueName.replace(/\s*\(.*\)$/, "")} · {time(g.kickoffUtc)}
                      {(g.status === "live" || Date.parse(g.kickoffUtc) <= Date.now()) && <span className="badge started">STARTED</span>}
                    </span>
                    <span
                      className={`dot ${freshness(g.fixturesFetchedAt)}`}
                      title={`Fixture data fetched ${ageText(g.fixturesFetchedAt)}`}
                      aria-label={`Data ${freshness(g.fixturesFetchedAt)}`}
                    />
                  </div>
                  <div className="gmain">
                    <span className="teams">
                      <span className="teamline"><Crest src={g.homeCrest} name={g.home} /><span>{g.home}</span></span>
                      <span className="teamline"><Crest src={g.awayCrest} name={g.away} /><span>{g.away}</span></span>
                    </span>
                    <span className="meta">
                      <Badge game={g} />
                      {g.bestEv !== null && <span className="ev">EV {pct(g.bestEv)}</span>}
                    </span>
                  </div>
                  <ModelLine game={g} />
                  {g.pHome !== null && g.pDraw !== null && g.pAway !== null && (
                    <>
                      <div className="prob" role="img" aria-label={`Home ${pct(g.pHome)}, draw ${pct(g.pDraw)}, away ${pct(g.pAway)}`}>
                        <i className="h" style={{ width: `${g.pHome * 100}%` }} />
                        <i className="d" style={{ width: `${g.pDraw * 100}%` }} />
                        <i className="a" style={{ width: `${g.pAway * 100}%` }} />
                      </div>
                      <div className="probtext">
                        <span>{pct(g.pHome)}</span>
                        <span>{pct(g.pDraw)}</span>
                        <span>{pct(g.pAway)}</span>
                      </div>
                    </>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Footer />
    </main>
  );
}

function Badge({ game }: { game: Game }) {
  const v = valueStateOf(game);
  return <span className={"badge v-" + v}>{VALUE_NAMES[v]}</span>;
}

/** What the model thinks, before any odds: its most likely result and whether it expects goals. */
function ModelLine({ game }: { game: Game }) {
  const lean = modelLean(game.pHome, game.pDraw, game.pAway);
  const s = scoringOf(game.pOver25);
  if (!lean && !s) return null;
  return (
    <div className="modelline">
      {lean && <span>Model: <strong>{lean.label}</strong> {pct(lean.prob)}</span>}
      {s && <span className={"scoring s-" + s}>{SCORING_NAMES[s]}</span>}
    </div>
  );
}
