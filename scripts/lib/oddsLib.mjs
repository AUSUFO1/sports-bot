// Pure helpers for the odds job: match OddsPapi fixtures to our games, and pull out the markets we use.
// No network, no secrets, so everything here is unit-tested.

/** OddsPapi tournament code for each of our leagues (found from its tournament list). */
export const TOURNAMENTS = {
  "fd-PL": 17, // Premier League
  "fd-PD": 8, // LaLiga
  "fd-SA": 23, // Serie A
  "fd-FL1": 34, // Ligue 1
  "fd-BL1": 35, // Bundesliga
  "fd-ELC": 18, // Championship
  "fd-DED": 37, // Eredivisie
  "fd-PPL": 238, // Liga Portugal
  "fd-BSA": 325, // Brasileiro Serie A
  "fd-CL": 7, // UEFA Champions League
};

/** OddsPapi market and outcome codes -> our market and selection names. */
export const MARKETS = {
  101: { market: "1x2", outcomes: { 101: "home", 102: "draw", 103: "away" } },
  104: { market: "btts", outcomes: { 104: "yes", 105: "no" } },
  108: { market: "ou_1_5", outcomes: { 108: "over", 109: "under" } },
  1010: { market: "ou_2_5", outcomes: { 1010: "over", 1011: "under" } },
  1012: { market: "ou_3_5", outcomes: { 1012: "over", 1013: "under" } },
};

// Words that differ between providers but carry no identity ("SV Werder Bremen" vs "Werder Bremen").
const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "sv", "fsv", "vfb", "vfl", "tsg", "ssc", "as", "us", "rc", "ud", "cd", "fk", "sk", "club", "the", "de", "1", "fortuna", "calcio"]);

export function tokens(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/** 0 to 1: how much of the shorter name's words appear in the other name. */
export function nameScore(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hits = small.filter((t) => big.includes(t)).length;
  return hits / small.length;
}

const MINUTES = 60_000;

/**
 * Finds our game for an OddsPapi fixture: kickoff within 45 minutes, then the best combined name score.
 * One side may fail to match (Köln vs Cologne) as long as the other side is a clear match.
 * Returns the game or null. A tie between two games returns null instead of guessing.
 */
export function matchFixture(fixture, games) {
  const t = Date.parse(fixture.startTime);
  const near = games.filter((g) => Math.abs(Date.parse(g.kickoffUtc) - t) <= 45 * MINUTES);
  const scored = near
    .map((g) => {
      const h = nameScore(fixture.homeName, g.home);
      const a = nameScore(fixture.awayName, g.away);
      return { g, h, a, score: h + a };
    })
    .filter((x) => x.score >= 1 && (x.h >= 0.99 || x.a >= 0.99)) // at least one side must match fully
    .sort((x, y) => y.score - x.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.34) return null; // ambiguous
  return scored[0].g;
}

/**
 * Pulls our markets out of one bookmaker's block of an OddsPapi fixture.
 * Only active prices above 1.0 are kept. Returns [{ market, selection, odds }].
 */
export function extractRows(bookmakerBlock) {
  const out = [];
  const markets = bookmakerBlock?.markets ?? {};
  for (const [id, def] of Object.entries(MARKETS)) {
    const m = markets[id];
    if (!m || m.marketActive === false) continue;
    for (const [outcomeId, selection] of Object.entries(def.outcomes)) {
      const p = m.outcomes?.[outcomeId]?.players?.["0"];
      if (p && p.active !== false && typeof p.price === "number" && p.price > 1) {
        out.push({ market: def.market, selection, odds: p.price });
      }
    }
  }
  return out;
}

/** Splits a list into groups of at most n (OddsPapi takes 5 tournaments per call). */
export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
