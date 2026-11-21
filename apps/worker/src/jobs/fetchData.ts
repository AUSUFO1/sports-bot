import { ApiFootball } from "../providers/apiFootball";
import { canSpend, recordCall } from "../lib/quota";
import { upsertFixtures, upsertLeagues } from "../lib/db";
import { ProviderError, type Env } from "../types";

const LEAGUES_EVERY_MS = 7 * 24 * 3600_000;
const LEAGUE_REFRESH_MS = 5 * 3600_000;
const LEAGUES_PER_RUN = 10; // keeps one run under 50 subrequests
const PAST_DAYS = 14;
const FUTURE_DAYS = 7;

const day = (d: Date) => d.toISOString().slice(0, 10);

/** One cron run: refresh the league list weekly, then a few leagues in turn (cursor in KV). */
export async function fetchData(env: Env, now = new Date()): Promise<Record<string, unknown>> {
  if (!env.API_FOOTBALL_KEY) return { skipped: "API_FOOTBALL_KEY not set" };
  const provider = new ApiFootball(env.API_FOOTBALL_KEY, () => recordCall(env.KV, "api-football", now));
  const log: Record<string, unknown> = {};

  try {
    const lastSync = Number((await env.KV.get("leagues:synced")) ?? 0);
    if (now.getTime() - lastSync > LEAGUES_EVERY_MS && (await canSpend(env.KV, "api-football", 1, now))) {
      const leagues = await provider.getLeagues();
      await upsertLeagues(env.DB, leagues);
      await env.KV.put("leagues:synced", String(now.getTime()));
      log.leaguesSynced = leagues.length;
    }

    const rows = await env.DB.prepare(`SELECT id, provider_ids FROM leagues WHERE active = 1 ORDER BY id`).all<{
      id: string;
      provider_ids: string;
    }>();
    const todo = rows.results.filter((r) => JSON.parse(r.provider_ids).season != null);
    if (todo.length === 0) {
      log.note = "no leagues with a current season yet";
    } else {
      let cursor = Number((await env.KV.get("cursor:fetch")) ?? 0) % todo.length;
      let done = 0;
      for (let n = 0; n < todo.length && done < LEAGUES_PER_RUN; n++) {
        const league = todo[cursor]!;
        cursor = (cursor + 1) % todo.length;
        const last = Number((await env.KV.get(`fetched:${league.id}`)) ?? 0);
        if (now.getTime() - last < LEAGUE_REFRESH_MS) continue; // cached, nothing to refetch
        if (!(await canSpend(env.KV, "api-football", 1, now))) {
          log.stopped = "daily quota near limit";
          break;
        }
        const ids = JSON.parse(league.provider_ids);
        const from = day(new Date(now.getTime() - PAST_DAYS * 86400_000));
        const to = day(new Date(now.getTime() + FUTURE_DAYS * 86400_000));
        try {
          const fixtures = await provider.getFixtures(String(ids.apiFootball), Number(ids.season), from, to);
          await upsertFixtures(env.DB, league.id, fixtures, now.toISOString());
          await env.KV.put(`fetched:${league.id}`, String(now.getTime()));
          done++;
        } catch (e) {
          if (e instanceof ProviderError && e.kind === "plan") {
            // The plan does not cover this league or season: note why, retry tomorrow, keep going.
            await env.KV.put(`fetched:${league.id}`, String(now.getTime() + 19 * 3600_000));
            log[league.id] = e.message;
            continue;
          }
          throw e;
        }
      }
      await env.KV.put("cursor:fetch", String(cursor));
      log.leaguesFetched = done;
    }
  } catch (e) {
    log.error = e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e);
  }
  await env.KV.put("lastRun:fetchData", JSON.stringify({ at: now.toISOString(), ...log }));
  return log;
}
