import type { Fixture, LeagueInfo } from "../types";

export async function upsertLeagues(db: D1Database, leagues: LeagueInfo[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO leagues (id, name, provider_ids, active) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider_ids = excluded.provider_ids`,
  );
  for (let i = 0; i < leagues.length; i += 50) {
    await db.batch(
      leagues.slice(i, i + 50).map((l) =>
        stmt.bind(
          `af-${l.providerId}`,
          `${l.name}${l.country ? ` (${l.country})` : ""}`,
          JSON.stringify({ apiFootball: l.providerId, season: l.season }),
        ),
      ),
    );
  }
}

export async function upsertFixtures(db: D1Database, leagueId: string, fixtures: Fixture[], fetchedAt: string) {
  if (fixtures.length === 0) return;
  const team = db.prepare(`INSERT OR IGNORE INTO teams (id, league_id, name, aliases) VALUES (?1, ?2, ?3, '[]')`);
  const match = db.prepare(
    `INSERT INTO matches (id, league_id, season, kickoff_utc, home_team_id, away_team_id, status, home_goals, away_goals, source, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'api-football', ?10)
     ON CONFLICT(id) DO UPDATE SET kickoff_utc = excluded.kickoff_utc, status = excluded.status,
       home_goals = excluded.home_goals, away_goals = excluded.away_goals, fetched_at = excluded.fetched_at`,
  );
  const stmts: D1PreparedStatement[] = [];
  for (const f of fixtures) {
    const h = `af-${f.home.providerId}`;
    const a = `af-${f.away.providerId}`;
    stmts.push(team.bind(h, leagueId, f.home.name), team.bind(a, leagueId, f.away.name));
    stmts.push(
      match.bind(`af-${f.providerId}`, leagueId, String(f.season), f.kickoffUtc, h, a, f.status, f.homeGoals, f.awayGoals, fetchedAt),
    );
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
}
