import { useEffect, useState } from "react";
import { api, ApiError, type DailyData, type DailyPick } from "../api";
import { pct, pickLabel, time } from "../format";
import { Crest } from "./Crest";
import backtest from "../backtest.json";

/** Won / lost / waiting and the return at the best price, for a list of daily picks. */
export function dailyRecord(picks: DailyPick[]) {
  let won = 0, lost = 0, voided = 0, open = 0, profit = 0;
  for (const p of picks) {
    if (p.result === "win") { won++; profit += p.bestOdds - 1; }
    else if (p.result === "loss") { lost++; profit -= 1; }
    else if (p.result === "void") voided++;
    else open++;
  }
  const settled = won + lost;
  return { won, lost, voided, open, settled, hit: settled ? won / settled : null, roi: settled ? profit / settled : null };
}

export function ResultBadge({ r }: { r: DailyPick["result"] }) {
  if (r === "win") return <span className="badge candidate">WON</span>;
  if (r === "loss") return <span className="badge loss">LOST</span>;
  if (r === "void") return <span className="badge nobet">VOID</span>;
  return <span className="badge pending">WAITING</span>;
}

export function DailyCard({ p }: { p: DailyPick }) {
  return (
    <li>
      <a className="game" href={`#/game/${encodeURIComponent(p.matchId)}`}>
        <div className="gtop">
          <span>
            <b className="rank">#{p.rank}</b> {p.leagueName.replace(/\s*\(.*\)$/, "")} · {time(p.kickoffUtc)}
          </span>
          <ResultBadge r={p.result} />
        </div>
        <div className="gmain">
          <span className="teams">
            <span className="teamline"><Crest src={p.homeCrest} name={p.home} /><span>{p.home}</span></span>
            <span className="teamline"><Crest src={p.awayCrest} name={p.away} /><span>{p.away}</span></span>
          </span>
          <span className="goalpct">{Math.round(p.prob * 100)}%</span>
        </div>
        <div className="goalpills">
          <span className="gpill"><b>{pickLabel(p.market, p.selection)}</b></span>
          <span className="gpill">Best odds <b>{p.bestOdds.toFixed(2)}</b></span>
          {p.finalScore && <span className="gpill">Score <b>{p.finalScore}</b></span>}
        </div>
      </a>
    </li>
  );
}

/** Malin's picks of the day: chosen once each morning from every game today, locked, tracked on their own. */
export function DailyPicks({ onUnauthorized }: { onUnauthorized: () => void }) {
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

  const today = d ? d.picks.filter((p) => p.day === d.today) : [];
  const rec = d ? dailyRecord(d.picks) : null;
  const bt = backtest.dailyPicks;

  return (
    <section className="daily">
      <h2>Malin's picks today</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && !d.chosenToday && (
        <p className="muted">Malin chooses today's picks at about 10:00, after the morning odds are in. Check back then.</p>
      )}
      {d && d.chosenToday && today.length === 0 && (
        <p className="muted">
          No game cleared the bar today ({d.chosenToday.games} games checked). Malin sits this day out rather than force
          a pick.
        </p>
      )}
      {today.length > 0 && (
        <ul className="games">{today.map((p) => <DailyCard key={p.id} p={p} />)}</ul>
      )}
      <p className="muted small">
        Each game's strongest pick that reaches {Math.round(65)}% or more, at odds of 1.40 or better, with our model leaning
        the same way. Up to 6 a day; the count depends on the day.
        {bt && ` On ${bt.picks} past games this rule won ${pct(bt.won)} at average odds ${bt.avgOdds.toFixed(2)}.`}
        {rec && rec.settled > 0 && ` Live so far: ${rec.won} of ${rec.settled} won.`}{" "}
        <a href="#/history">Full record in History</a>.
      </p>
    </section>
  );
}
