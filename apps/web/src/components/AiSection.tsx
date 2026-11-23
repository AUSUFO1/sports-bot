import { useEffect, useState } from "react";
import { api, ApiError, type AiAnalysis } from "../api";
import { ageText, pickLabel } from "../format";

/** The AI explains the saved report in plain words. Code has already checked the answer before it gets here. */
export function AiSection({ matchId, onUnauthorized }: { matchId: string; onUnauthorized: () => void }) {
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [state, setState] = useState<"checking" | "idle" | "working" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  const path = `/api/games/${encodeURIComponent(matchId)}`;

  useEffect(() => {
    setAi(null);
    setError(null);
    setState("checking");
    api<AiAnalysis>(`${path}/analysis`)
      .then((a) => {
        setAi(a);
        setState("idle");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setState("idle"); // 404 simply means there is no saved analysis yet
      });
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    setState("working");
    setError(null);
    api<AiAnalysis>(`${path}/analyse`, "POST")
      .then((a) => {
        setAi(a);
        setState("idle");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setState("error");
      });
  };

  return (
    <section>
      <h2>AI analysis</h2>

      {state === "checking" && <p className="muted">Checking for a saved analysis…</p>}

      {!ai && (state === "idle" || state === "error" || state === "working") && (
        <>
          <p className="muted small">
            The AI reads the numbers above and explains them in plain words. It can warn you off a pick, but it can never add one.
          </p>
          <button onClick={run} disabled={state === "working"}>
            {state === "working" ? "Analysing… this takes about 10 seconds" : "Analyse this game"}
          </button>
        </>
      )}
      {state === "error" && error && <p className="error" role="alert">{error}</p>}

      {ai && (
        <div className="ai">
          <p className="aiverdict">{ai.verdictLine}</p>
          <p>{ai.analysis.summary}</p>

          {ai.analysis.recommendation && (
            <p className="airec">
              The AI points to: <strong>{pickLabel(ai.analysis.recommendation.market, ai.analysis.recommendation.selection)}</strong>
              <span className="muted small"> (it is on the shortlist the numbers produced)</span>
            </p>
          )}

          {ai.analysis.keyFactors.length > 0 && (
            <>
              <h3>Key points</h3>
              <ul>{ai.analysis.keyFactors.map((f) => <li key={f}>{f}</li>)}</ul>
            </>
          )}
          {ai.analysis.risks.length > 0 && (
            <>
              <h3>Risks</h3>
              <ul>{ai.analysis.risks.map((f) => <li key={f}>{f}</li>)}</ul>
            </>
          )}
          {ai.analysis.skip.length > 0 && (
            <>
              <h3>The AI advises skipping</h3>
              <ul className="plain skiplist">
                {ai.analysis.skip.map((s) => (
                  <li key={s.market + s.selection}>
                    <strong>{pickLabel(s.market, s.selection)}</strong>
                    {s.reason && <span className="muted small"> — {s.reason}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {ai.analysis.reasoning && <p className="muted small">{ai.analysis.reasoning}</p>}

          {ai.numberMismatches.length > 0 && (
            <p className="warnline">
              Check before trusting: the AI quoted {ai.numberMismatches.join(", ")}, which is not in the report. Rely on the numbers above.
            </p>
          )}
          {ai.issues.filter((i) => !i.startsWith("The AI quoted")).map((i) => <p key={i} className="muted small">{i}</p>)}

          <p className="muted small">
            Written by {ai.provider} ({ai.model}) {ageText(ai.createdAt)}
            {ai.cached ? " · saved copy" : ""}. The verdict above is set by code, not by the AI.
          </p>
        </div>
      )}
    </section>
  );
}
