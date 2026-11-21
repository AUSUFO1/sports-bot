import type { Fixture, LeagueInfo } from "../types";

/** prefix = short provider tag in ids ("af", "fd"); idKey = key inside leagues.provider_ids. */
export interface Source {
  prefix: string;
  idKey: string;
  name: string;
}
export const API_FOOTBALL: Source = { prefix: "af", idKey: "apiFootball", name: "api-football" };
export const FOOTBALL_DATA: Source = { prefix: "fd", idKey: "footballData", name: "football-data" };

export async function upsertLeagues(db: D1Database, leagues: LeagueInfo[], src: Source): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO leagues (id, name, provider_ids, active) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider_ids = excluded.provider_ids`,
  );
  for (let i = 0; i < leagues.length; i += 50) {
    await db.batch(
      leagues.slice(i, i + 50).map((l) =>
        stmt.bind(
          `${src.prefix}-${l.providerId}`,
          `${l.name}${l.country ? ` (${l.country})` : ""}`,
          JSON.stringify({ [src.idKey]: l.providerId, season: l.season }),
        ),
      ),
    );
  }
}

export async function upsertFixtures(
  db: D1Database,
  leagueId: string,
  fixtures: Fixture[],
  fetchedAt: string,
  src: Source,
) {
  if (fixtures.length === 0) return;
  const team = db.prepare(`INSERT OR IGNORE INTO teams (id, league_id, name, aliases) VALUES (?1, ?2, ?3, '[]')`);
  const match = db.prepare(
    `INSERT INTO matches (id, league_id, season, kickoff_utc, home_team_id, away_team_id, status, home_goals, away_goals, source, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(id) DO UPDATE SET kickoff_utc = excluded.kickoff_utc, status = excluded.status,
       home_goals = excluded.home_goals, away_goals = excluded.away_goals, fetched_at = excluded.fetched_at`,
  );
  const teams = new Map<string, string>();
  for (const f of fixtures) {
    teams.set(`${src.prefix}-${f.home.providerId}`, f.home.name);
    teams.set(`${src.prefix}-${f.away.providerId}`, f.away.name);
  }
  const stmts: D1PreparedStatement[] = [...teams].map(([id, name]) => team.bind(id, leagueId, name));
  for (const f of fixtures) {
    stmts.push(
      match.bind(
        `${src.prefix}-${f.providerId}`,
        leagueId,
        String(f.season),
        f.kickoffUtc,
        `${src.prefix}-${f.home.providerId}`,
        `${src.prefix}-${f.away.providerId}`,
        f.status,
        f.homeGoals,
        f.awayGoals,
        src.name,
        fetchedAt,
      ),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
}
