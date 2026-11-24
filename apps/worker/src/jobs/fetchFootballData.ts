import { FootballData } from "../providers/footballData";
import { FOOTBALL_DATA, upsertFixtures, upsertLeagues } from "../lib/db";
import { ProviderError, type Env } from "../types";

const LEAGUES_EVERY_MS = 7 * 24 * 3600_000;
const LEAGUE_REFRESH_MS = 5 * 3600_000;
const CREST_RETRY_MS = 24 * 3600_000;
const LEAGUES_PER_RUN = 3; // free Workers allow 50 queries per run; each league uses about a dozen
const GAP_MS = 7000; // free plan allows 10 calls per minute
const PAST_DAYS = 2;
const FUTURE_DAYS = 7; // the free plan allows at most 10 days per request

const day = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One cron run. A league with no matches stored yet loads its whole season in one call;
 * after that it only refreshes a small window around today. `maxLeagues` lets a manual test
 * run stay tiny.
 */
export async function fetchFootballData(env: Env, now = new Date(), maxLeagues = LEAGUES_PER_RUN) {
  if (!env.FOOTBALL_DATA_KEY) return { skipped: "FOOTBALL_DATA_KEY not set" };
  let calls = 0;
  const provider = new FootballData(env.FOOTBALL_DATA_KEY, async () => {
    if (calls++ > 0) await sleep(GAP_MS);
  });
  const log: Record<string, unknown> = {};

  try {
    const lastSync = Number((await env.KV.get("fd:leagues:synced")) ?? 0);
    if (now.getTime() - lastSync > LEAGUES_EVERY_MS) {
      const leagues = await provider.getLeagues();
      await upsertLeagues(env.DB, leagues, FOOTBALL_DATA);
      await env.KV.put("fd:leagues:synced", String(now.getTime()));
      log.leaguesSynced = leagues.length;
    }

    const rows = await env.DB.prepare(
      `SELECT l.id, l.provider_ids, (SELECT COUNT(*) FROM matches m WHERE m.league_id = l.id) AS n,
              (SELECT COUNT(*) FROM teams t WHERE t.league_id = l.id AND t.crest IS NULL) AS no_crest
       FROM leagues l WHERE l.active = 1 AND l.id LIKE 'fd-%' ORDER BY l.id`,
    ).all<{ id: string; provider_ids: string; n: number; no_crest: number }>();
    const todo = rows.results.filter((r) => JSON.parse(r.provider_ids).season != null);

    if (todo.length > 0) {
      let cursor = Number((await env.KV.get("fd:cursor")) ?? 0) % todo.length;
      let done = 0;
      for (let i = 0; i < todo.length && done < maxLeagues; i++) {
        const league = todo[cursor]!;
        cursor = (cursor + 1) % todo.length;
        // A league with teams that have no crest yet reloads its WHOLE season once (one call), because the small
        // refresh window only reaches the teams playing soon. Tried at most once a day, in case a provider has no crest for a team.
        const crestFullAt = Number((await env.KV.get(`fd:crestfull:${league.id}`)) ?? 0);
        const needCrests = league.no_crest > 0 && now.getTime() - crestFullAt > CREST_RETRY_MS;
        const last = Number((await env.KV.get(`fd:fetched:${league.id}`)) ?? 0);
        if (!needCrests && now.getTime() - last < LEAGUE_REFRESH_MS) continue; // cached, nothing to refetch
        const ids = JSON.parse(league.provider_ids);
        // Last season, once per league (one call). Older games count less in the model on their own (weight halves
        // every 60 days), so this steadies early-season numbers and gives the backtest finished games to score.
        if (league.n > 0 && !(await env.KV.get(`fd:prev:${league.id}`))) {
          try {
            const prev = await provider.getFixtures(String(ids.footballData), Number(ids.season) - 1, "", "");
            await upsertFixtures(env.DB, league.id, prev.filter((f) => f.status === "finished"), now.toISOString(), FOOTBALL_DATA);
            await env.KV.put(`fd:prev:${league.id}`, String(prev.length));
            log[`${league.id}:lastSeason`] = `${prev.length} matches`;
          } catch (e) {
            // Last season is optional. Never let it stop the run (that froze fixtures and results on 2026-11-24):
            // note why, skip it for this league, and carry on with the normal refresh below.
            const why = e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e);
            await env.KV.put(`fd:prev:${league.id}`, `skipped (${why})`);
            log[`${league.id}:lastSeason`] = `skipped (${why})`;
          }
        }
        const full = league.n === 0 || needCrests;
        if (needCrests) await env.KV.put(`fd:crestfull:${league.id}`, String(now.getTime()));
        const from = full ? "" : day(new Date(now.getTime() - PAST_DAYS * 86400_000));
        const to = full ? "" : day(new Date(now.getTime() + FUTURE_DAYS * 86400_000));
        done++;
        try {
          const fixtures = await provider.getFixtures(String(ids.footballData), Number(ids.season), from, to);
          await upsertFixtures(env.DB, league.id, fixtures, now.toISOString(), FOOTBALL_DATA);
          await env.KV.put(`fd:fetched:${league.id}`, String(now.getTime()));
          log[league.id] = `${fixtures.length} matches (${full ? "full season" : "window"})`;
        } catch (e) {
          // One league failing must not block the others: note it and move on. Rate limits stop the run (next run retries).
          if (e instanceof ProviderError && e.kind === "quota") throw e;
          log.error = `${league.id}: ${e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e)}`;
        } finally {
          await env.KV.put("fd:cursor", String(cursor)); // saved each time, so a failing league is never retried first forever
        }
      }
    }
  } catch (e) {
    // Any provider error stops this run; the next run starts again from the cursor.
    log.error = e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e);
  }
  await env.KV.put("lastRun:fetchFootballData", JSON.stringify({ at: now.toISOString(), calls, ...log }));
  return { calls, ...log };
}
