import { buildReport, MODEL_VERSION, type OddsInput, type PastMatch } from "@sports/stats";
import type { Env } from "../types";

const WINDOW_DAYS = 7; // "next several days"
const STALE_HOURS = 12; // regenerate a report after this long
const DEFAULT_CAP = 12;
const HISTORY_DAYS = 450; // results older than this weigh almost nothing in the model
const LOG_WITHIN_H = 36; // picks are logged only for games kicking off within this many hours
const LOG_MAX_ODDS_AGE_H = 14; // ...and only when the odds are this fresh (the odds job runs twice a day) // statistics are CPU work; Free Workers allow 10 ms per run, so keep batches small

interface Upcoming {
  id: string;
  league_id: string;
  kickoff_utc: string;
  fetched_at: string;
  home_name: string;
  away_name: string;
}

/** Writes a section 8 report for upcoming matches that have none yet or an old one. Never calls the AI. */
export async function buildReports(env: Env, now = new Date(), cap = DEFAULT_CAP) {
  const staleBefore = new Date(now.getTime() - STALE_HOURS * 3600_000).toISOString();
  const end = new Date(now.getTime() + WINDOW_DAYS * 86400_000).toISOString();

  const todo = await env.DB.prepare(
    `SELECT m.id, m.league_id, m.kickoff_utc, m.fetched_at, ht.name AS home_name, at2.name AS away_name
     FROM matches m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at2 ON at2.id = m.away_team_id
     LEFT JOIN reports r ON r.match_id = m.id
     WHERE m.status = 'scheduled' AND m.kickoff_utc >= ?1 AND m.kickoff_utc <= ?2
       AND (r.match_id IS NULL OR r.created_at < ?3 OR json_extract(r.report_json, '$.picks') IS NULL OR r.model_version != ?5)
     ORDER BY m.kickoff_utc LIMIT ?4`,
  )
    .bind(now.toISOString(), end, staleBefore, cap, MODEL_VERSION)
    .all<Upcoming>();

  const histories = new Map<string, PastMatch[]>(); // one history query per league per run
  const results = { built: 0, bet_candidates: 0, no_bet: 0, failed: 0, picks_logged: 0 };

  for (const m of todo.results) {
    try {
      let history = histories.get(m.league_id);
      if (!history) {
        const rows = await env.DB.prepare(
          `SELECT ht.name AS home, at2.name AS away, m.home_goals, m.away_goals, m.kickoff_utc
           FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at2 ON at2.id = m.away_team_id
           WHERE m.league_id = ?1 AND m.status = 'finished' AND m.kickoff_utc >= ?2
             AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL`,
        )
          // Older than ~15 months weighs almost nothing (weight halves every 60 days), so it is not read at all.
          .bind(m.league_id, new Date(now.getTime() - HISTORY_DAYS * 86400_000).toISOString())
          .all<{ home: string; away: string; home_goals: number; away_goals: number; kickoff_utc: string }>();
        history = rows.results.map((r) => ({
          home: r.home,
          away: r.away,
          homeGoals: r.home_goals,
          awayGoals: r.away_goals,
          date: r.kickoff_utc,
        }));
        histories.set(m.league_id, history);
      }

      // All prices for this one match (index on match_id), newest first; keep the latest per bookmaker, market and
      // selection here in code. The old correlated subquery re-scanned the table for every row.
      const allOdds = await env.DB.prepare(
        `SELECT bookmaker, market, selection, decimal_odds AS decimalOdds, captured_at AS capturedAt
         FROM odds_snapshots WHERE match_id = ?1 ORDER BY captured_at DESC`,
      )
        .bind(m.id)
        .all<OddsInput>();
      const seen = new Set<string>();
      const odds = {
        results: allOdds.results.filter((o) => {
          const k = `${o.bookmaker}|${o.market}|${o.selection}`;
          return seen.has(k) ? false : (seen.add(k), true);
        }),
      };

      const report = buildReport({
        matchId: m.id,
        league: m.league_id,
        kickoffUtc: m.kickoff_utc,
        home: m.home_name,
        away: m.away_name,
        history,
        odds: odds.results,
        fixturesFetchedAt: m.fetched_at,
        now: now.toISOString(),
      });

      await env.DB.prepare(
        `INSERT INTO reports (match_id, report_json, model_version, data_freshness, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(match_id) DO UPDATE SET report_json = excluded.report_json, model_version = excluded.model_version,
           data_freshness = excluded.data_freshness, created_at = excluded.created_at`,
      )
        .bind(m.id, JSON.stringify(report), MODEL_VERSION, JSON.stringify(report.dataFreshness), now.toISOString())
        .run();

      // Log picks ONCE per match, and only when they rest on fresh Pinnacle prices close to kickoff, so every row in
      // History is the same kind of pick. Earlier builds (no odds yet, days ahead) are not logged; the first
      // qualifying build is kept forever (no hindsight edits) and later builds never add a second, different set.
      const blended = new Set(report.model?.tuning?.blendedMarkets ?? []);
      const oddsAt = report.dataFreshness.odds ? Date.parse(report.dataFreshness.odds) : NaN;
      const toKickoffH = (Date.parse(m.kickoff_utc) - now.getTime()) / 3600_000;
      const fresh = Number.isFinite(oddsAt) && (now.getTime() - oddsAt) / 3600_000 <= LOG_MAX_ODDS_AGE_H;
      const loggable = report.picks.filter((p) => blended.has(p.market));
      if (fresh && toKickoffH <= LOG_WITHIN_H && loggable.length > 0) {
        const already = await env.DB.prepare(`SELECT 1 FROM picks_log WHERE match_id = ?1 LIMIT 1`).bind(m.id).first();
        if (!already) {
          const ins = env.DB.prepare(
            `INSERT OR IGNORE INTO picks_log
               (match_id, market, selection, model_prob, odds_taken, result, created_at,
                league_id, kickoff_utc, kind, confidence, ev, pred_score, model_version)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
          );
          await env.DB.batch(
            loggable.map((p) =>
              ins.bind(
                m.id, p.market, p.selection, p.modelProb, p.odds ?? 0, now.toISOString(),
                m.league_id, m.kickoff_utc, p.kind, report.confidence, p.ev, report.predictedScore, MODEL_VERSION,
              ),
            ),
          );
          results.picks_logged += loggable.length;
        }
      }

      results.built++;
      if (report.verdict === "BET_CANDIDATE") results.bet_candidates++;
      else results.no_bet++;
    } catch {
      results.failed++; // one bad match must not stop the rest
    }
  }

  const summary = { at: now.toISOString(), waiting: todo.results.length, ...results };
  await env.KV.put("lastRun:buildReports", JSON.stringify(summary));
  return summary;
}
