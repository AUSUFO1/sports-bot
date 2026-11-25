import { usePersisted, useScrollMemory } from "../nav";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type PickRow, type Ticket } from "../api";
import { CATEGORY_NAMES, categoryOf, dayKey, dayLabel, GROUP_NAMES, pct, pickGroup, pickLabel, SCORING_NAMES, scoringOf, time, type Category } from "../format";
import { Footer } from "../components/Footer";
import { Crest } from "../components/Crest";

export function Picks({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [picks, setPicks] = useState<PickRow[] | null>(null);
  useScrollMemory("picks", picks !== null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [legs, setLegs] = usePersisted("picks:legs", 4);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cat, setCat] = usePersisted<Category | "all">("picks:cat", "all");

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return onUnauthorized();
    setError(e instanceof Error ? e.message : "Something went wrong.");
  };
  useEffect(() => {
    api<PickRow[]>("/api/picks").then(setPicks).catch(fail);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api<Ticket>(`/api/ticket?legs=${legs}`).then(setTicket).catch(fail);
  }, [legs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Category pills: Unders / Overs / BTTS / Draws / Wins of the day.
  const counts = useMemo(() => {
    const c: Record<Category, number> = { under: 0, over: 0, btts: 0, draw: 0, win: 0 };
    for (const p of picks ?? []) c[categoryOf(p.market, p.selection)]++;
    return c;
  }, [picks]);

  const grouped = useMemo(() => {
    const byMatch = new Map<string, PickRow[]>();
    const shown = (picks ?? []).filter((p) => cat === "all" || categoryOf(p.market, p.selection) === cat);
    for (const p of shown) {
      if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
      byMatch.get(p.matchId)!.push(p);
    }
    const byDay = new Map<string, { label: string; matches: PickRow[][] }>();
    for (const rows of byMatch.values()) {
      const k = dayKey(rows[0]!.kickoffUtc);
      if (!byDay.has(k)) byDay.set(k, { label: dayLabel(rows[0]!.kickoffUtc), matches: [] });
      byDay.get(k)!.matches.push(rows);
    }
    // Inside a category, show the model's most confident games first.
    if (cat !== "all") {
      for (const d of byDay.values()) {
        d.matches.sort((a, b) => Math.max(...b.map((p) => p.modelProb)) - Math.max(...a.map((p) => p.modelProb)));
      }
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [picks, cat]);

  const copy = async () => {
    if (!ticket || ticket.legs.length === 0) return;
    const text = [
      `Ticket (${ticket.legs.length} legs)`,
      ...ticket.legs.map((l) => `${l.home} vs ${l.away}: ${pickLabel(l.market, l.selection)}${l.odds ? ` @ ${l.odds.toFixed(2)}` : ""}`),
      `Model chance all win: ${pct(ticket.combinedProb)}`,
      ticket.combinedOdds ? `Reference combined odds: ${ticket.combinedOdds.toFixed(2)}` : "Reference odds not available yet",
      `Take it on SportyBet only if combined odds are at least ${(ticket.minCombinedOdds ?? ticket.breakEvenOdds).toFixed(2)}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the ticket text and copy it by hand.");
    }
  };

  return (
    <main className="page">
      <h1>Top picks</h1>
      <p className="lead">Where the model is most confident. These are estimates from past results, not promises.</p>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="ticket">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Ticket</h2>
          <div className="chips" role="group" aria-label="Number of legs" style={{ margin: 0, padding: 0 }}>
            {[2, 3, 4, 5].map((n) => (
              <button key={n} className="chip" aria-pressed={legs === n} onClick={() => setLegs(n)}>{n}</button>
            ))}
          </div>
        </div>
        {!ticket && <p className="muted">Building…</p>}
        {ticket && ticket.legs.length === 0 && <p className="muted">No safe legs right now.</p>}
        {ticket && ticket.legs.length > 0 && (
          <>
            <ul className="plain legs">
              {ticket.legs.map((l) => (
                <li key={l.matchId}>
                  <span>
                    <strong>{pickLabel(l.market, l.selection)}</strong>
                    <span className="muted small"> · {l.home} vs {l.away}</span>
                  </span>
                  <span className="muted">{pct(l.modelProb)}</span>
                </li>
              ))}
            </ul>
            <div className="combo">
              <div><strong>{pct(ticket.combinedProb)}</strong><span>chance every leg wins</span></div>
              <div><strong>{ticket.combinedOdds ? ticket.combinedOdds.toFixed(2) : "—"}</strong><span>{ticket.combinedOdds ? "reference odds" : "no reference odds yet"}</span></div>
            </div>
            <p className="takeline">
              Take the ticket on SportyBet only if its combined odds are at least{" "}
              <strong>{(ticket.minCombinedOdds ?? ticket.breakEvenOdds).toFixed(2)}</strong>
              <span className="muted small"> (break-even {ticket.breakEvenOdds.toFixed(2)})</span>
            </p>
            <p className="muted small">More legs means a lower chance. Load these on your betting site by hand.</p>
            <button onClick={copy}>{copied ? "Copied" : "Copy ticket"}</button>
          </>
        )}
      </section>

      {picks && picks.length > 0 && (
        <div className="chips catpills" role="group" aria-label="Pick type of the day">
          <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>All ({picks.length})</button>
          {(Object.keys(CATEGORY_NAMES) as Category[]).map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)} disabled={counts[c] === 0}>
              {CATEGORY_NAMES[c]} ({counts[c]})
            </button>
          ))}
        </div>
      )}

      {!picks && !error && <p className="muted">Loading picks…</p>}
      {picks && picks.length === 0 && (
        <div className="empty"><p><strong>No top picks yet.</strong> Picks appear when the model is confident and has enough data.</p></div>
      )}
      {picks && picks.length > 0 && grouped.length === 0 && (
        <div className="empty"><p><strong>No {cat !== "all" ? CATEGORY_NAMES[cat].toLowerCase() : "picks"} right now.</strong> The model is not confident enough on any game for this type.</p></div>
      )}

      {grouped.map(([key, day]) => (
        <section key={key}>
          <h2 className="day">{day.label}</h2>
          <ul className="games">
            {day.matches.map((rows) => {
              const m = rows[0]!;
              return (
                <li key={m.matchId}>
                  <a className="game" href={`#/game/${encodeURIComponent(m.matchId)}`}>
                    <div className="gtop">
                      <span>{m.leagueName.replace(/\s*\(.*\)$/, "")} · {time(m.kickoffUtc)}</span>
                      {m.predictedScore && <span>Model score {m.predictedScore}</span>}
                    </div>
                    <div className="gmain">
                      <span className="teams">
                        <span className="teamline"><Crest src={m.homeCrest} name={m.home} /><span>{m.home}</span></span>
                        <span className="teamline"><Crest src={m.awayCrest} name={m.away} /><span>{m.away}</span></span>
                      </span>
                      {scoringOf(m.pOver25) && (
                        <span className={"scoring s-" + scoringOf(m.pOver25)}>{SCORING_NAMES[scoringOf(m.pOver25)!]}</span>
                      )}
                    </div>
                    {rows.map((p) => (
                      <div key={p.market + p.selection} className={`pickrow g-${pickGroup(p.market, p.selection)}`}>
                        <span className="pickname">
                          <span className="tag">{GROUP_NAMES[pickGroup(p.market, p.selection)]}</span>
                          <span>{pickLabel(p.market, p.selection)}</span>
                        </span>
                        <span className="pickright">
                          {p.kind === "value" ? <span className="badge candidate">VALUE</span> : <span className="badge nobet">MODEL</span>}
                          <strong>{pct(p.modelProb)}</strong>
                        </span>
                        <span className="track wide"><span className="fill model" style={{ width: `${p.modelProb * 100}%` }} /></span>
                        {(p.refPinnacle || p.ref1xbet) && (
                          <span className="refline">
                            {p.refPinnacle ? `Pinnacle ${p.refPinnacle.toFixed(2)}` : ""}
                            {p.refPinnacle && p.ref1xbet ? " · " : ""}
                            {p.ref1xbet ? `1xBet ${p.ref1xbet.toFixed(2)}` : ""}
                          </span>
                        )}
                        {p.minOdds && (
                          <span className="takeline">
                            On SportyBet, take it only at <strong>{p.minOdds.toFixed(2)}</strong> or higher
                            <span className="muted small"> (break-even {p.breakEven?.toFixed(2)})</span>
                          </span>
                        )}
                        {p.flags.length > 0 && <span className={p.flags.some((f) => f.startsWith("Far above")) ? "warnline" : "muted small"}>{p.flags.join(" · ")}</span>}
                      </div>
                    ))}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <Footer />
    </main>
  );
}
