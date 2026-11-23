// Odds job: runs on GitHub (free, no CPU limit), because OddsPapi responses are ~800 KB each and a free
// Cloudflare Worker only gets 10 ms of CPU. It asks our Worker which games are coming up, downloads
// reference odds from OddsPapi, matches them to our games, and sends back only the small result.
//
// Environment (secrets are never printed):
//   API_URL       our Worker address
//   INGEST_TOKEN  token that can only reach /api/odds/*
//   ODDS_API_KEY  OddsPapi key
//   BOOKMAKERS    comma list, default "pinnacle,1xbet"
//   WITHIN_HOURS  only games kicking off within this many hours, default 36
//   MAX_CALLS     hard cap on OddsPapi calls in one run, default 8
//   DRY_RUN=1     do everything except send results

import { chunk, extractRows, matchFixture, TOURNAMENTS } from "./lib/oddsLib.mjs";

const API_URL = (process.env.API_URL ?? "").replace(/\/$/, "");
const INGEST_TOKEN = process.env.INGEST_TOKEN ?? "";
const ODDS_KEY = process.env.ODDS_API_KEY ?? "";
const BOOKMAKERS = (process.env.BOOKMAKERS ?? "pinnacle,1xbet").split(",").map((s) => s.trim()).filter(Boolean);
const WITHIN_HOURS = Number(process.env.WITHIN_HOURS ?? 36);
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 8);
const DRY = process.env.DRY_RUN === "1";
const ODDSPAPI = "https://api.oddspapi.io/v4";

function need(name, v) {
  if (!v) {
    console.error(`Missing ${name}. Add it as a repository secret (or environment variable) and run again.`);
    process.exit(1);
  }
}
need("API_URL", API_URL);
need("INGEST_TOKEN", INGEST_TOKEN);
need("ODDS_API_KEY", ODDS_KEY);

async function ours(path, init = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Our Worker answered ${res.status} for ${path.split("?")[0]}`);
  return res.json();
}

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The /fixtures list is rate limited more tightly than the odds calls, so space those calls out.
const GAP_MS = { "/fixtures": 15_000 };
const lastCallAt = {};

async function oddspapi(path, params) {
  const url = new URL(`${ODDSPAPI}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apiKey", ODDS_KEY); // v4 takes the key as a query parameter; the URL is never logged
  for (let attempt = 1; attempt <= 3; attempt++) {
    const gap = GAP_MS[path];
    if (gap && lastCallAt[path]) await sleep(Math.max(0, lastCallAt[path] + gap - Date.now()));
    calls++; // every attempt counts, to stay on the safe side of the monthly budget
    lastCallAt[path] = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (res.status === 404) return []; // "no fixtures for this bookmaker and tournament": a normal empty answer
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(Math.max(Number(res.headers.get("retry-after")) || 15, 2), 30);
      console.log(`OddsPapi asked us to slow down (429) on ${path}. Waiting ${wait}s, then trying again.`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`OddsPapi answered ${res.status} for ${path}`);
    return res.json();
  }
}

async function main() {
  const state = await ours("/api/odds/state");
  const budgetLeft = state.monthlyLimit - state.callsThisMonth;
  console.log(`OddsPapi calls used this month: ${state.callsThisMonth} of ${state.monthlyLimit}.`);
  if (budgetLeft <= 0) {
    console.log("Monthly budget is used up. Nothing to do.");
    return;
  }
  const cap = Math.min(MAX_CALLS, budgetLeft);

  const games = await ours(`/api/odds/games?hours=${WITHIN_HOURS}`);
  console.log(`Our upcoming games in the next ${WITHIN_HOURS} hours: ${games.length}.`);
  const byLeague = new Map();
  for (const g of games) {
    if (!TOURNAMENTS[g.leagueId]) continue; // a league OddsPapi does not carry for us
    if (!byLeague.has(g.leagueId)) byLeague.set(g.leagueId, []);
    byLeague.get(g.leagueId).push(g);
  }
  if (byLeague.size === 0) {
    console.log("No games in covered leagues. Nothing to do.");
    return;
  }

  // Leagues with the soonest kickoff first, so a tight budget covers the most urgent games.
  const leagues = [...byLeague.keys()].sort(
    (a, b) => Date.parse(byLeague.get(a)[0].kickoffUtc) - Date.parse(byLeague.get(b)[0].kickoffUtc),
  );
  const groups = chunk(leagues, 5);
  const plannedOdds = groups.length * BOOKMAKERS.length;
  console.log(`Leagues: ${leagues.join(", ")}. Planned odds calls: ${plannedOdds}. Cap for this run: ${cap}.`);

  const participants = { ...state.participants };
  const newParticipants = {};
  const rows = [];
  let unmatched = 0;
  let stoppedEarly = false;

  for (const group of groups) {
    for (const book of BOOKMAKERS) {
      if (calls >= cap) {
        stoppedEarly = true;
        break;
      }
      const tournamentIds = group.map((l) => TOURNAMENTS[l]);
      const fixtures = await oddspapi("/odds-by-tournaments", { bookmaker: book, tournamentIds: tournamentIds.join(",") });

      // Learn team names for any team id we have not seen (one call per tournament, saved for next time).
      const unknownTournaments = new Set();
      for (const f of fixtures) {
        if (!participants[f.participant1Id] || !participants[f.participant2Id]) unknownTournaments.add(f.tournamentId);
      }
      for (const tid of unknownTournaments) {
        if (calls >= cap) {
          stoppedEarly = true;
          break;
        }
        const list = await oddspapi("/fixtures", { tournamentId: tid });
        for (const f of list) {
          if (f.participant1Name) participants[f.participant1Id] = newParticipants[f.participant1Id] = f.participant1Name;
          if (f.participant2Name) participants[f.participant2Id] = newParticipants[f.participant2Id] = f.participant2Name;
        }
      }

      for (const f of fixtures) {
        const h = participants[f.participant1Id];
        const a = participants[f.participant2Id];
        if (!h || !a) {
          unmatched++;
          continue;
        }
        const leagueGames = leagues.flatMap((l) => byLeague.get(l));
        const game = matchFixture({ homeName: h, awayName: a, startTime: f.startTime }, leagueGames);
        if (!game) {
          unmatched++;
          continue;
        }
        for (const r of extractRows(f.bookmakerOdds?.[book])) rows.push({ matchId: game.matchId, bookmaker: book, ...r });
      }
    }
    if (stoppedEarly) break;
  }

  const matches = new Set(rows.map((r) => r.matchId)).size;
  console.log(`Matched odds for ${matches} games (${rows.length} prices). Fixtures not matched: ${unmatched}. OddsPapi calls made: ${calls}.${stoppedEarly ? " Stopped early at the call cap." : ""}`);

  if (DRY) {
    console.log("DRY_RUN: not sending anything.");
    return;
  }
  const summary = await ours("/api/odds/ingest", {
    method: "POST",
    body: JSON.stringify({ rows, participants: newParticipants, calls, note: stoppedEarly ? "stopped at call cap" : null }),
  });
  console.log(`Worker stored ${summary.stored} prices for ${summary.matches} games.`);
}

main().catch((e) => {
  console.error(`Odds job failed: ${e.message}`);
  process.exit(1);
});
