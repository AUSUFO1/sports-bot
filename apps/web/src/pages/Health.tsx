import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { ageText } from "../format";

interface ServiceEvent {
  at: string;
  ok: boolean;
  detail: string;
  attempts?: string[];
}
interface HealthData {
  checkedAt: string;
  database: boolean;
  jobs: { label: string; ok: boolean; problem: string | null; at: string | null }[];
  services: { label: string; last: ServiceEvent | null; lastFail: ServiceEvent | null }[];
  keys: { name: string; set: boolean }[];
  usage: {
    aiToday: number;
    aiDailyLimit: number;
    researchToday: number;
    researchDailyLimit: number;
    oddsCallsThisMonth: number;
    oddsMonthlyLimit: number;
  };
}

function Dot({ state }: { state: "ok" | "bad" | "idle" }) {
  return <span className={"hdot " + state} aria-label={state === "ok" ? "working" : state === "bad" ? "problem" : "no data"} />;
}

/** One screen that says what works, what failed last and why. */
export function Health({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<HealthData>("/api/health/details")
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(e instanceof Error ? e.message : "The server did not answer.");
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = data
    ? data.jobs.filter((j) => !j.ok).length +
      data.services.filter((s) => s.last && !s.last.ok).length +
      data.keys.filter((k) => !k.set && k.name !== "GROQ_API_KEY").length +
      (data.database ? 0 : 1)
    : 0;

  return (
    <main className="page">
      <p><a href="#/leagues">← More</a></p>
      <h1>Health</h1>
      {error && <p className="error" role="alert">Server: {error}</p>}
      {!data && !error && <p className="muted">Checking…</p>}
      {data && (
        <>
          <p className={problems === 0 ? "agreebadge" : "error"}>
            {problems === 0 ? "✓ Everything is working" : `${problems} thing${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention`}
          </p>
          <p className="muted small">Checked {ageText(data.checkedAt)}. <button className="linkbtn" onClick={load}>Check again</button></p>

          <h2>Scheduled jobs</h2>
          <ul className="plain">
            <li className="hrow">
              <Dot state={data.database ? "ok" : "bad"} />
              <span className="hname">Database</span>
              <span className="muted small">{data.database ? "Connected" : "Not connected"}</span>
            </li>
            {data.jobs.map((j) => (
              <li key={j.label} className="hrow">
                <Dot state={j.ok ? "ok" : "bad"} />
                <span className="hname">{j.label}</span>
                <span className="muted small">{j.at ? `Last ran ${ageText(j.at)}` : "Never ran"}{j.problem ? ` · ${j.problem}` : ""}</span>
              </li>
            ))}
          </ul>

          <h2>AI and web search</h2>
          <ul className="plain">
            {data.services.map((s) => (
              <li key={s.label} className="hrow">
                <Dot state={!s.last ? "idle" : s.last.ok ? "ok" : "bad"} />
                <span className="hname">{s.label}</span>
                <span className="muted small">
                  {!s.last ? "Not used yet" : `${s.last.ok ? "Worked" : "Failed"} ${ageText(s.last.at)} · ${s.last.detail}`}
                </span>
                {s.lastFail && (
                  <details className="hfail">
                    <summary>Last failure {ageText(s.lastFail.at)}</summary>
                    <p className="small">{s.lastFail.detail}</p>
                    {s.lastFail.attempts && (
                      <ul className="small">{s.lastFail.attempts.map((a) => <li key={a}>{a}</li>)}</ul>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">"rate_limit" or "server" means that free model was busy; the next one is tried. A few busy models is normal.</p>

          <h2>Keys on the server</h2>
          <ul className="plain">
            {data.keys.map((k) => (
              <li key={k.name} className="hrow">
                <Dot state={k.set ? "ok" : k.name === "GROQ_API_KEY" ? "idle" : "bad"} />
                <code className="hname">{k.name}</code>
                <span className="muted small">{k.set ? "Set" : k.name === "GROQ_API_KEY" ? "Not set (optional)" : "Missing"}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Only shows whether each key is set. Values are never shown.</p>

          <h2>Free limits used</h2>
          <ul className="plain">
            <li className="hrow"><span className="hname">AI calls today</span><span className="muted small">{data.usage.aiToday} of {data.usage.aiDailyLimit}</span></li>
            <li className="hrow"><span className="hname">Research runs today</span><span className="muted small">{data.usage.researchToday} of {data.usage.researchDailyLimit}</span></li>
            <li className="hrow"><span className="hname">Odds calls this month</span><span className="muted small">{data.usage.oddsCallsThisMonth} of {data.usage.oddsMonthlyLimit}</span></li>
          </ul>
        </>
      )}
    </main>
  );
}
