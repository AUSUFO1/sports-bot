import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { ageText } from "../format";

type Agreement = "agree" | "disagree" | "unclear";
interface Research {
  provider: string;
  model: string;
  cached: boolean;
  createdAt: string;
  view: {
    result: "home" | "draw" | "away" | "unclear";
    goals: "over" | "under" | "unclear";
    btts: "yes" | "no" | "unclear";
    confidence: "low" | "medium" | "high";
    summary: string;
    keyNews: string[];
  };
  sources: { n: number; title: string; url: string }[];
  comparison: {
    result: { model: string; ai: string; verdict: Agreement };
    goals: { model: string; ai: string; verdict: Agreement };
    btts: { model: string; ai: string; verdict: Agreement };
    agreeCount: number;
    disagreeCount: number;
    allAgree: boolean;
  };
  issues: string[];
}

const WORDS: Record<string, string> = {
  home: "Home win",
  draw: "Draw",
  away: "Away win",
  over: "Over 2.5 goals",
  under: "Under 2.5 goals",
  yes: "Both teams score",
  no: "Not both teams score",
  unclear: "Unclear",
};
const MARK: Record<Agreement, string> = { agree: "✓ Agrees", disagree: "✗ Disagrees", unclear: "– No view" };

/** The AI's own web research, compared with the model. It never changes the model's numbers. */
export function ResearchSection({ matchId, onUnauthorized }: { matchId: string; onUnauthorized: () => void }) {
  const [res, setRes] = useState<Research | null>(null);
  const [state, setState] = useState<"checking" | "idle" | "working" | "error">("checking");
  const [error, setError] = useState<string | null>(null);
  const path = `/api/games/${encodeURIComponent(matchId)}/research`;

  useEffect(() => {
    setRes(null);
    setError(null);
    setState("checking");
    api<Research>(path)
      .then((r) => {
        setRes(r);
        setState("idle");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setState("idle");
      });
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    setState("working");
    setError(null);
    api<Research>(path, "POST")
      .then((r) => {
        setRes(r);
        setState("idle");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setState("error");
      });
  };

  const rows: { label: string; key: "result" | "goals" | "btts" }[] = [
    { label: "Result", key: "result" },
    { label: "Goals", key: "goals" },
    { label: "BTTS", key: "btts" },
  ];

  return (
    <section>
      <h2>AI's own research</h2>
      {state === "checking" && <p className="muted">Checking for today's research…</p>}

      {!res && state !== "checking" && (
        <>
          <p className="muted small">
            The AI searches the web for team news, injuries and form, forms its own view, and the app checks whether it agrees with the model.
            Web news can be wrong or old.
          </p>
          <button onClick={run} disabled={state === "working"}>
            {state === "working" ? "Researching… this can take up to a minute" : "Research this game"}
          </button>
        </>
      )}
      {state === "error" && error && <p className="error" role="alert">{error}</p>}

      {res && (
        <div className="ai research">
          <p className="unverified">From the web, not verified. It never changes the model's numbers.</p>
          {res.comparison.allAgree ? (
            <p className="agreebadge">✓ Model + AI agree on all three</p>
          ) : (
            <p className="muted small">
              Agrees on {res.comparison.agreeCount} of 3{res.comparison.disagreeCount > 0 ? `, disagrees on ${res.comparison.disagreeCount}` : ""}.
            </p>
          )}

          <table className="compare">
            <thead>
              <tr><th></th><th>Model</th><th>AI research</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = res.comparison[r.key];
                return (
                  <tr key={r.key} className={"cmp-" + c.verdict}>
                    <td>{r.label}</td>
                    <td>{WORDS[c.model] ?? c.model}</td>
                    <td>{WORDS[c.ai] ?? c.ai}</td>
                    <td className="cmpmark">{MARK[c.verdict]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p>{res.view.summary}</p>
          {res.view.keyNews.length > 0 && (
            <>
              <h3>What it found</h3>
              <ul>{res.view.keyNews.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          )}
          {res.sources.length > 0 && (
            <>
              <h3>Sources</h3>
              <ul className="plain sources">
                {res.sources.map((s) => (
                  <li key={s.n}>
                    <span className="muted">[{s.n}]</span>{" "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {res.issues.map((i) => <p key={i} className="muted small">{i}</p>)}
          <p className="muted small">
            Research confidence: {res.view.confidence}. Written by {res.provider} ({res.model}) {ageText(res.createdAt)}
            {res.cached ? " · saved copy" : ""}. Refreshes once a day.
          </p>
        </div>
      )}
    </section>
  );
}
