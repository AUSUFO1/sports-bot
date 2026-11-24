import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Game } from "../api";
import { dayKey, dayLabel, pct, time } from "../format";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

/** A game qualifies when both chances are at least this, in the final numbers AND in our own model. */
const MIN = 0.5;

type Mode = "high" | "low";

interface GoalGame extends Game {
  a: number;
  b: number;
  score: number;
}

const MODES: Record<Mode, { title: string; labelA: string; labelB: string; rule: string }> = {
  high: { title: "High-scoring", labelA: "Over 2.5", labelB: "BTTS", rule: "Over 2.5 goals and both teams to score" },
  low: { title: "Low-scoring", labelA: "Under 3.5", labelB: "BTTS No", rule: "Under 3.5 goals and not both teams to score" },
};

/** The two chances for a mode: final numbers, and our own model's (older reports: the final numbers ARE the model). */
function chances(g: Game, mode: Mode) {
  if (mode === "high") {
    return { a: g.pOver25, b: g.pBtts, ourA: g.rawOver25 ?? g.pOver25, ourB: g.rawBtts ?? g.pBtts };
  }
  const no = (p: number | null) => (p === null ? null : 1 - p);
  return { a: g.pUnder35, b: no(g.pBtts), ourA: g.rawUnder35 ?? g.pUnder35, ourB: no(g.rawBtts ?? g.pBtts) };
}

/** Keeps only games where both chances are likely in the final numbers AND our model agrees. */
export function goalGames(games: Game[], mode: Mode): GoalGame[] {
  const out: GoalGame[] = [];
  for (const g of games) {
    const { a, b, ourA, ourB } = chances(g, mode);
    if (a === null || b === null || ourA === null || ourB === null) continue;
    if (a < MIN || b < MIN || ourA < MIN || ourB < MIN) continue;
    out.push({ ...g, a, b, score: (a + b) / 2 });
  }
  return out;
}

const readMode = (): Mode => {
  try {
    return localStorage.getItem("goals:mode") === "low" ? "low" : "high";
  } catch {
    return "high";
  }
};

export function Goals({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("goals:mode", m);
    } catch {
      // remembering the tab is only a convenience
    }
  };

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
    for (const g of goalGames(games ?? [], mode)) {
      const k = dayKey(g.kickoffUtc);
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(g.kickoffUtc), list: [] });
      byDay.get(k)!.list.push(g);
    }
    const sorted = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y));
    for (const [, d] of sorted) d.list.sort((x, y) => y.score - x.score);
    return sorted;
  }, [games, mode]);

  const m = MODES[mode];
  return (
    <main className="page">
      <h1>Goals</h1>
      <div className="seg" role="group" aria-label="Scoring type">
        {(["high", "low"] as const).map((k) => (
          <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{MODES[k].title}</button>
        ))}
      </div>
      <p className="muted small">
        Games where <b>{m.rule}</b> are each {Math.round(MIN * 100)}% or more, and our own model agrees. Today first, then
        highest chance first. Estimates, never certain.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {!games && !error && <p className="muted">Loading…</p>}
      {games && days.length === 0 && (
        <div className="empty">
          <p><strong>No {m.title.toLowerCase()} games right now.</strong> None of the upcoming games pass both checks.</p>
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
                    <span className={`goalpct ${mode}`} aria-label={`Average chance ${pct(g.score)}`}>{Math.round(g.score * 100)}%</span>
                  </div>
                  <div className="goalpills">
                    <span className="gpill">{m.labelA} <b>{pct(g.a)}</b></span>
                    <span className="gpill">{m.labelB} <b>{pct(g.b)}</b></span>
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
