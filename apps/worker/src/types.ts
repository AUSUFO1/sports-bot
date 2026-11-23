export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  APP_TOKEN?: string;
  API_FOOTBALL_KEY?: string;
  FOOTBALL_DATA_KEY?: string;
  /** a second token that can ONLY reach /api/odds/* (used by the GitHub odds job) */
  INGEST_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** web search for the AI research section (Tavily free plan) */
  TAVILY_API_KEY?: string;
}

export interface LeagueInfo {
  providerId: string;
  name: string;
  country: string;
  season: number | null; // current season, if the provider lists one
}

export interface Fixture {
  providerId: string;
  leagueProviderId: string;
  season: number;
  kickoffUtc: string;
  status: "scheduled" | "live" | "finished" | "postponed";
  home: { providerId: string; name: string; crest?: string | null };
  away: { providerId: string; name: string; crest?: string | null };
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface DataProvider {
  name: string;
  getLeagues(): Promise<LeagueInfo[]>;
  getFixtures(leagueProviderId: string, season: number, from: string, to: string): Promise<Fixture[]>;
}

/** kind "plan" = the provider's plan does not allow this request (not a bug, not retryable today). */
export class ProviderError extends Error {
  constructor(public kind: "plan" | "quota" | "http" | "network", message: string) {
    super(message);
  }
}
