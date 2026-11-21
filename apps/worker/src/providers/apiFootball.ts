import { ProviderError, type DataProvider, type Fixture, type LeagueInfo } from "../types";

const BASE = "https://v3.football.api-sports.io";

type Json = Record<string, any>; // provider JSON is untyped; every field is read defensively below

function mapStatus(short: string): Fixture["status"] {
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live";
  if (["PST", "CANC", "ABD", "AWD", "WO", "SUSP"].includes(short)) return "postponed";
  return "scheduled";
}

export function parseFixtures(body: Json): Fixture[] {
  const out: Fixture[] = [];
  for (const r of (body.response ?? []) as Json[]) {
    if (!r?.fixture?.id || !r?.teams?.home?.id || !r?.teams?.away?.id) continue;
    out.push({
      providerId: String(r.fixture.id),
      leagueProviderId: String(r.league.id),
      season: Number(r.league.season),
      kickoffUtc: new Date(r.fixture.date).toISOString(),
      status: mapStatus(String(r.fixture.status?.short ?? "NS")),
      home: { providerId: String(r.teams.home.id), name: String(r.teams.home.name) },
      away: { providerId: String(r.teams.away.id), name: String(r.teams.away.name) },
      homeGoals: r.goals?.home ?? null,
      awayGoals: r.goals?.away ?? null,
    });
  }
  return out;
}

export function parseLeagues(body: Json): LeagueInfo[] {
  return ((body.response ?? []) as Json[]).map((r) => {
    const current = (r.seasons ?? []).find((s: Json) => s.current);
    return {
      providerId: String(r.league.id),
      name: String(r.league.name),
      country: String(r.country?.name ?? ""),
      season: current ? Number(current.year) : null,
    };
  });
}

export class ApiFootball implements DataProvider {
  name = "api-football";
  constructor(private apiKey: string, private onCall: () => Promise<void>) {}

  private async get(path: string): Promise<Json> {
    await this.onCall(); // counts the call before it is made
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": this.apiKey } });
    } catch (e) {
      throw new ProviderError("network", String(e));
    }
    if (res.status === 429) throw new ProviderError("quota", "rate limited");
    if (!res.ok) throw new ProviderError("http", `HTTP ${res.status}`);
    const body = (await res.json()) as Json;
    const errs = body.errors;
    const msg = Array.isArray(errs) ? errs.join("; ") : errs ? Object.values(errs).join("; ") : "";
    if (msg) throw new ProviderError(/plan|season|subscription/i.test(msg) ? "plan" : "http", msg);
    return body;
  }

  async getLeagues() {
    return parseLeagues(await this.get("/leagues?current=true"));
  }

  async getFixtures(league: string, season: number, from: string, to: string) {
    return parseFixtures(await this.get(`/fixtures?league=${league}&season=${season}&from=${from}&to=${to}`));
  }
}
