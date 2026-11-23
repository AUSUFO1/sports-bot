const BASE: string = import.meta.env.VITE_API_URL ?? "https://sports-bot-api.oabubakar2019.workers.dev";
const KEY = "sb_token";

// Storage can be blocked (private windows), so every access is wrapped.
export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
export function setToken(t: string): void {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing to do: the token then lives only until the page closes */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, method: "GET" | "POST" = "GET"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${getToken()}` } });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your internet and try again.");
  }
  if (res.status === 401) throw new ApiError(401, "That token was not accepted.");
  if (res.status === 404) throw new ApiError(404, "Not found.");
  if (!res.ok) {
    // The server writes a plain-words reason for AI failures (limit reached, providers busy); show it when present.
    let reason = `Server error (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(res.status, reason);
  }
  return (await res.json()) as T;
}

export interface AiAnalysis {
  provider: string;
  model: string;
  cached: boolean;
  createdAt: string;
  /** written by code, never by the AI */
  verdictLine: string;
  analysis: {
    summary: string;
    keyFactors: string[];
    risks: string[];
    recommendation: { market: string; selection: string } | null;
    skip: { market: string; selection: string; reason: string }[];
    reasoning: string;
  };
  issues: string[];
  numberMismatches: string[];
}

export interface Game {
  id: string;
  leagueId: string;
  leagueName: string;
  kickoffUtc: string;
  status: string;
  home: string;
  away: string;
  homeCrest: string | null;
  awayCrest: string | null;
  fixturesFetchedAt: string | null;
  hasReport: boolean;
  verdict: "BET_CANDIDATE" | "NO_BET" | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  oddsFetchedAt: string | null;
  bestEv: number | null;
  pHome: number | null;
  pDraw: number | null;
  pAway: number | null;
  /** model chance of over 2.5 goals, drives the low/high scoring label */
  pOver25: number | null;
}

export interface LeagueRow {
  id: string;
  name: string;
  matches: number;
  fetchedAt: string | null;
  dataStatus: "ready" | "not_filled";
}

export interface PickRow {
  matchId: string;
  leagueName: string;
  kickoffUtc: string;
  home: string;
  away: string;
  homeCrest: string | null;
  awayCrest: string | null;
  predictedScore: string | null;
  pOver25: number | null;
  confidence: string | null;
  market: string;
  selection: string;
  modelProb: number;
  kind: "value" | "model";
  odds: number | null;
  ev: number | null;
  /** lowest odds worth taking, and the odds where the pick breaks even */
  minOdds: number | null;
  breakEven: number | null;
  /** reference prices from the odds job, when known */
  refPinnacle: number | null;
  ref1xbet: number | null;
  ticketOk: boolean;
  flags: string[];
}

export interface Ticket {
  legs: PickRow[];
  combinedProb: number;
  combinedOdds: number | null;
  ev: number | null;
  breakEvenOdds: number;
  minCombinedOdds: number | null;
}

export interface HistoryPick {
  id: number;
  matchId: string;
  leagueName: string;
  kickoffUtc: string;
  home: string;
  away: string;
  homeCrest: string | null;
  awayCrest: string | null;
  market: string;
  selection: string;
  modelProb: number;
  odds: number | null;
  kind: string | null;
  confidence: string | null;
  predictedScore: string | null;
  finalScore: string | null;
  result: "win" | "loss" | "void" | null;
}
export interface History {
  picks: HistoryPick[];
  byMarket: { market: string; selection: string; wins: number; losses: number }[];
  byBucket: { bucket: number; wins: number; losses: number }[];
  open: number;
}

type Probs = Record<string, number>;
export interface Report {
  matchId: string;
  league: string;
  kickoffUtc: string;
  home: string;
  away: string;
  homeCrest?: string | null;
  awayCrest?: string | null;
  dataFreshness: { fixtures: string; odds: string | null };
  sample: { homeMatches: number; awayMatches: number };
  model: {
    version: string;
    expectedGoals: { home: number; away: number };
    probabilities: Record<string, Probs>;
    topScorelines: { score: string; prob: number }[];
    eloCheck: { home: number; draw: number; away: number; agrees: boolean };
  } | null;
  market: {
    bestOdds: Record<string, Probs>;
    fairProbabilities: Record<string, Probs>;
    marginByMarket: Record<string, number>;
    byBook?: Record<string, Record<string, Probs>>;
  };
  value: { market: string; selection: string; modelProb: number; fairProb: number; edge: number; odds: number; ev: number }[];
  shortlist: { market: string; selection: string; odds: number; ev: number; confidence: string }[];
  verdict: "BET_CANDIDATE" | "NO_BET";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  warnings: string[];
}
