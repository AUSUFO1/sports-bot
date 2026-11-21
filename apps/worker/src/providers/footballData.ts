import { ProviderError, type DataProvider, type Fixture, type LeagueInfo } from "../types";

const BASE = "https://api.football-data.org/v4";

type Json = Record<string, any>; // provider JSON is untyped; every field is read defensively below

function mapStatus(s: string): Fixture["status"] {
  if (["FINISHED", "AWARDED"].includes(s)) return "finished";
  if (["IN_PLAY", "PAUSED", "LIVE"].includes(s)) return "live";
  if (["POSTPONED", "SUSPENDED", "CANCELLED"].includes(s)) return "postponed";
  return "scheduled";
}

/** Leagues the free plan can read (plan TIER_ONE). providerId is the competition code, e.g. "PL". */
export function parseCompetitions(body: Json): LeagueInfo[] {
  return ((body.competitions ?? []) as Json[])
    .filter((c) => c.plan === "TIER_ONE" && c.code)
    .map((c) => ({
      providerId: String(c.code),
      name: String(c.name),
      country: String(c.area?.name ?? ""),
      season: c.currentSeason?.startDate ? Number(String(c.currentSeason.startDate).slice(0, 4)) : null,
    }));
}

export function parseMatches(body: Json, leagueCode: string): Fixture[] {
  const out: Fixture[] = [];
  for (const m of (body.matches ?? []) as Json[]) {
    if (!m?.id || !m?.homeTeam?.id || !m?.awayTeam?.id || !m?.utcDate) continue;
    out.push({
      providerId: String(m.id),
      leagueProviderId: leagueCode,
      season: Number(String(m.season?.startDate ?? "").slice(0, 4)) || 0,
      kickoffUtc: new Date(m.utcDate).toISOString(),
      status: mapStatus(String(m.status ?? "SCHEDULED")),
      home: { providerId: String(m.homeTeam.id), name: String(m.homeTeam.name ?? m.homeTeam.shortName) },
      away: { providerId: String(m.awayTeam.id), name: String(m.awayTeam.name ?? m.awayTeam.shortName) },
      homeGoals: m.score?.fullTime?.home ?? null,
      awayGoals: m.score?.fullTime?.away ?? null,
    });
  }
  return out;
}

export class FootballData implements DataProvider {
  name = "football-data";
  constructor(private token: string, private onCall: () => Promise<void>) {}

  private async get(path: string): Promise<Json> {
    await this.onCall();
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { headers: { "X-Auth-Token": this.token } });
    } catch (e) {
      throw new ProviderError("network", String(e));
    }
    if (res.status === 429) throw new ProviderError("quota", "rate limited (10 calls per minute)");
    if (res.status === 403) throw new ProviderError("plan", "not allowed on the free plan");
    if (!res.ok) throw new ProviderError("http", `HTTP ${res.status}`);
    return (await res.json()) as Json;
  }

  async getLeagues() {
    return parseCompetitions(await this.get("/competitions"));
  }

  /** from/to are YYYY-MM-DD (the free plan allows at most 10 days). from/to empty = the whole season. */
  async getFixtures(league: string, season: number, from: string, to: string) {
    const q = from && to ? `dateFrom=${from}&dateTo=${to}` : `season=${season}`;
    return parseMatches(await this.get(`/competitions/${league}/matches?${q}`), league);
  }
}
