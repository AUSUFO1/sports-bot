import { DAILY_MARKETS, DAILY_RULES, MODEL_VERSION, selectDaily, type DailyCandidate } from "@sports/stats";
import type { Env } from "../types";

/** The owner is in Nigeria (WAT, UTC+1, no daylight saving): "today" is his calendar day. */
const TZ_OFFSET_H = 1;
/** Choose after the morning odds (GitHub job at 07:00 UTC) and the report rebuilds that follow. */
const SELECT_FROM_LOCAL_HOUR = 10;
/** Reports must carry odds this fresh, so every pick rests on this morning's prices. */
const MAX_ODDS_AGE_H = 6;

export const localDay = (d: Date) => new Date(d.getTime() + TZ_OFFSET_H * 3600_000).toISOString().slice(0, 10);
const localHour = (d: Date) => new Date(d.getTime() + TZ_OFFSET_H * 3600_000).getUTCHours();
/** UTC instant when a local day ends. */
const endOfLocalDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + (24 - TZ_OFFSET_H) * 3600_000);

interface ReportBits {
  dataFreshness: { odds: string | null };
  model: {
    probabilities: Record<string, Record<string, number>>;
    rawProbabilities?: Record<string, Record<string, number>>;
    tuning?: { blendedMarkets: string[] };
  } | null;
  market: { byBook: Record<string, Record<string, Record<string, number>>> };
}

/**
 * Once per day: look at every game still to kick off today, take the strongest selection of each, keep those that
 * clear the backtested bar (DAILY_RULES), and lock the result. A day where nothing clears the bar is recorded too.
 * Never re-picks a day. `force` is for a manual test run only.
 */
export async function selectDailyPicks(env: Env, now = new Date(), force = false) {
  const day = localDay(now);
  const doneKey = `daily:selected:${day}`;
  if (!force && (await env.KV.get(doneKey)) !== null) return { day, skipped: "already chosen today" };
  if (!force && localHour(now) < SELECT_FROM_LOCAL_HOUR) return { day, skipped: `waits until ${SELECT_FROM_LOCAL_HOUR}:00` };

  const rows = await env.DB.prepare(
    `SELECT m.id, m.kickoff_utc, r.report_json
     FROM matches m JOIN reports r ON r.match_id = m.id
     WHERE m.status = 'scheduled' AND m.kickoff_utc > ?1 AND m.kickoff_utc < ?2`,
  )
    .bind(now.toISOString(), endOfLocalDay(day).toISOString())
    .all<{ id: string; kickoff_utc: string; report_json: string }>();

  const cands: DailyCandidate[] = [];
  let stale = 0;
  for (const row of rows.results) {
    const r = JSON.parse(row.report_json) as ReportBits;
    const oddsAt = r.dataFreshness.odds ? Date.parse(r.dataFreshness.odds) : NaN;
    if (!r.model || !Number.isFinite(oddsAt) || (now.getTime() - oddsAt) / 3600_000 > MAX_ODDS_AGE_H) {
      stale++;
      continue;
    }
    const blended = new Set(r.model.tuning?.blendedMarkets ?? []);
    for (const [market, sels] of Object.entries(DAILY_MARKETS)) {
      if (!blended.has(market)) continue; // only markets Pinnacle priced (what the backtest tested)
      for (const selection of sels) {
        const prob = r.model.probabilities[market]?.[selection];
        if (prob === undefined) continue;
        let bestOdds: number | null = null;
        for (const book of Object.values(r.market.byBook)) {
          const o = book[market]?.[selection];
          if (o !== undefined && (bestOdds === null || o > bestOdds)) bestOdds = o;
        }
        cands.push({ matchId: row.id, kickoffUtc: row.kickoff_utc, market, selection, prob, ourProb: r.model.rawProbabilities?.[market]?.[selection] ?? null, bestOdds });
      }
    }
  }

  // Not enough fresh reports yet (the odds have not been processed): try again next hour, choose and lock NOTHING.
  // Never lock a day on stale prices; the afternoon odds update (15:00 UTC) also counts.
  if (!force && rows.results.length > 0 && stale > rows.results.length / 2) {
    return { day, skipped: `waiting for fresh odds (${stale} of ${rows.results.length} reports not updated yet)` };
  }

  const chosen = selectDaily(cands, DAILY_RULES);
  if (chosen.length > 0) {
    const ins = env.DB.prepare(
      `INSERT OR IGNORE INTO daily_picks (day, rank, match_id, market, selection, prob, our_prob, best_odds, kickoff_utc, model_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    );
    await env.DB.batch(
      chosen.map((c, i) => ins.bind(day, i + 1, c.matchId, c.market, c.selection, c.prob, c.ourProb, c.bestOdds, c.kickoffUtc, MODEL_VERSION, now.toISOString())),
    );
  }
  const summary = { day, at: now.toISOString(), games: rows.results.length, staleReports: stale, picks: chosen.length };
  await env.KV.put(doneKey, JSON.stringify(summary), { expirationTtl: 90 * 86400 });
  await env.KV.put("lastRun:dailyPicks", JSON.stringify(summary));
  return summary;
}
