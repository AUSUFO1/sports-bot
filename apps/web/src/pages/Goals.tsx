import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Game } from "../api";
import { dayKey, dayLabel, pct, time } from "../format";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

/** A game qualifies when both chances are at least this, in the final numbers AND in our own model. */
const MIN = 0.5;

interface GoalGame extends Game {
  over: number;
  btts: number;
  score: number;
}

/** Keeps only games where Over 2.5 AND both teams to score are likely, and our model agrees. */
export function goalGames(games: Game[]): GoalGame[] {
  const out: GoalGame[] = [];
  for (const g of games) {
    if (g.pOver25 === null || g.pBtts === null) continue;
    if (g.pOver25 < MIN || g.pBtts < MIN) continue;
    // Our own model must agree too (older reports have no separate model numbers: the final numbers ARE the model).
    const ourOver = g.rawOver25 ?? g.pOver25;
    const ourBtts = g.rawBtts ?? g.pBtts;
    if (ourOver < MIN || ourBtts < MIN) continue;
    out.push({ ...g, over: g.pOver25, btts: g.pBtts, score: (g.pOver25 + g.pBtts) / 2 });
  }
  return out;
}

export function Goals({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Game[]>("/api/games")
      .then(setGames)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Day order first (today, tomorrow, ...), then the highest average chance first inside each day.
  const days = useMemo(() => {
    const byDay = new Map<string, { label: string; list: GoalGame[] }>();
    for (const g of goalGames(games ?? []).sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc))) {
      const k = dayKey(g.kickoffUtc);
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(g.kickoffUtc), list: [] });
      byDay.get(k)!.list.push(g);
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [, d] of sorted) d.list.sort((a, b) => b.score - a.score);
    return sorted;
  }, [games]);

  return (
    <main className="page">
      <h1>Goals</h1>
      <p className="muted small">
        Games where <b>Over 2.5 goals</b> and <b>both teams to score</b> are each {pct(MIN).replace(".0", "")} or more, and our
        own model agrees. Today first, then highest chance first. Estimates, never certain.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {!games && !error && <p className="muted">Loading…</p>}
      {games && days.length === 0 && (
        <div className="empty">
          <p><strong>No high-scoring games right now.</strong> None of the upcoming games pass both checks.</p>
        </div>
      )}

      {days.map(([key, day]) => (
        <section key={key}>
          <h2 className="day">{day.label} · {day.list.length}</h2>
          <ul className="games">
            {day.list.map((g) => (
              <li key={g.id}>
                <a href={`#/game/${encodeURIComponent(g.id)}`} className="game">
                  <div className="gtop">
                    <span>
                      {g.leagueName.replace(/\s*\(.*\)$/, "")} · {time(g.kickoffUtc)}
                      {(g.status === "live" || Date.parse(g.kickoffUtc) <= Date.now()) && <span className="badge started">STARTED</span>}
                    </span>
                  </div>
                  <div className="gmain">
                    <span className="teams">
                      <span className="teamline"><Crest src={g.homeCrest} name={g.home} /><span>{g.home}</span></span>
                      <span className="teamline"><Crest src={g.awayCrest} name={g.away} /><span>{g.away}</span></span>
                    </span>
                    <span className="goalpct" aria-label={`Average chance ${pct(g.score)}`}>{Math.round(g.score * 100)}%</span>
                  </div>
                  <div className="goalpills">
                    <span className="gpill">Over 2.5 <b>{pct(g.over)}</b></span>
                    <span className="gpill">BTTS <b>{pct(g.btts)}</b></span>
                  </div>
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
