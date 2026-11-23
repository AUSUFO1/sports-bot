/**
 * Backtest: replays past seasons match by match, using ONLY games played before each kickoff (no leakage),
 * and scores the model against what really happened. It picks the Dixon-Coles rho and the market-blend weight
 * that give the lowest log loss, then checks what the pick rules would have returned at Pinnacle's prices.
 *
 * Data: football-data.co.uk season CSVs (results plus Pinnacle prices) in data/backtest/*.csv.
 * Run:  pnpm backtest
 * Writes apps/web/src/backtest.json (a small summary the app footer shows).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  btts,
  computeLambdas,
  DEFAULT_PICK_CONFIG,
  oneXTwo,
  overUnder,
  removeMargin,
  scoreMatrix,
  type PastMatch,
} from "../packages/stats/src/index";

const DIR = "data/backtest";
const WARMUP_DAYS = 120; // the first months of the earliest season only build history; they are not scored
const RHOS = [0, -0.05, -0.1, -0.15];
const WEIGHTS = [1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1, 0.05, 0];

interface Row extends PastMatch {
  league: string;
  pin1x2: [number, number, number] | null; // fair Pinnacle probabilities (pre-match price)
  pinOu: [number, number] | null; // over, under 2.5
  odds1x2: [number, number, number] | null;
  oddsOu: [number, number] | null;
}

function parseDate(s: string): string {
  const [d, m, y] = s.split("/");
  const year = y!.length === 2 ? 2000 + Number(y) : Number(y);
  return new Date(Date.UTC(year, Number(m) - 1, Number(d), 15)).toISOString();
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

function load(): Row[] {
  const rows: Row[] = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".csv"))) {
    const lines = readFileSync(join(DIR, f), "latin1").split(/\r?\n/).filter((l) => l.trim());
    const head = lines[0]!.replace(/^﻿/, "").replace(/^ï»¿/, "").split(",");
    const col = (name: string) => head.indexOf(name);
    for (const line of lines.slice(1)) {
      const c = line.split(",");
      const get = (n: string) => (col(n) >= 0 ? c[col(n)] : undefined);
      const hg = Number(get("FTHG"));
      const ag = Number(get("FTAG"));
      if (!get("Div") || !get("HomeTeam") || !Number.isInteger(hg) || !Number.isInteger(ag)) continue;
      const o1 = [num(get("PSH")), num(get("PSD")), num(get("PSA"))];
      const oo = [num(get("P>2.5")), num(get("P<2.5"))];
      const ok1 = o1.every((x) => x !== null);
      const okO = oo.every((x) => x !== null);
      rows.push({
        league: get("Div")!,
        home: get("HomeTeam")!,
        away: get("AwayTeam")!,
        homeGoals: hg,
        awayGoals: ag,
        date: parseDate(get("Date")!),
        odds1x2: ok1 ? (o1 as [number, number, number]) : null,
        oddsOu: okO ? (oo as [number, number]) : null,
        pin1x2: ok1 ? (removeMargin(o1 as number[]).fair as [number, number, number]) : null,
        pinOu: okO ? (removeMargin(oo as number[]).fair as [number, number]) : null,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

const clamp = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

function main() {
  const all = load();
  if (all.length === 0) throw new Error(`No CSV files in ${DIR}`);
  const leagues = [...new Set(all.map((r) => r.league))];

  // One pass: lambdas per match (they do not depend on rho or the blend).
  type Case = { r: Row; lh: number; la: number; n: number };
  const cases: Case[] = [];
  for (const lg of leagues) {
    const rows = all.filter((r) => r.league === lg);
    const start = Date.parse(rows[0]!.date) + WARMUP_DAYS * 86400_000;
    for (const r of rows) {
      if (Date.parse(r.date) < start) continue;
      const lam = computeLambdas(rows, r.home, r.away, r.date); // filters to games before kickoff
      if (!lam) continue;
      cases.push({ r, lh: lam.lambdaHome, la: lam.lambdaAway, n: Math.min(lam.homeMatches, lam.awayMatches) });
    }
  }
  const scored = cases.filter((c) => c.r.pin1x2 && c.r.pinOu);

  // Grid search on log loss (1X2 + over/under 2.5). Lower is better.
  const results: { rho: number; w: number; ll1x2: number; llOu: number; brier1x2: number }[] = [];
  const probsFor = (c: Case, rho: number) => {
    const m = scoreMatrix(c.lh, c.la, 10, rho);
    const x = oneXTwo(m);
    return { p1: [x.home, x.draw, x.away], pOver: overUnder(m, 2.5).over, pBtts: btts(m).yes };
  };
  for (const rho of RHOS) {
    const raw = scored.map((c) => ({ c, ...probsFor(c, rho) }));
    for (const w of WEIGHTS) {
      let ll1 = 0;
      let llo = 0;
      let br = 0;
      for (const { c, p1, pOver } of raw) {
        const f = c.r.pin1x2!;
        const b = p1.map((p, i) => w * p + (1 - w) * f[i]!);
        const out = c.r.homeGoals > c.r.awayGoals ? 0 : c.r.homeGoals === c.r.awayGoals ? 1 : 2;
        ll1 -= Math.log(clamp(b[out]!));
        br += b.reduce((s, p, i) => s + (p - (i === out ? 1 : 0)) ** 2, 0);
        const po = w * pOver + (1 - w) * c.r.pinOu![0];
        const over = c.r.homeGoals + c.r.awayGoals > 2.5;
        llo -= Math.log(clamp(over ? po : 1 - po));
      }
      const n = raw.length;
      results.push({ rho, w, ll1x2: ll1 / n, llOu: llo / n, brier1x2: br / n });
    }
  }
  const total = (x: (typeof results)[number]) => x.ll1x2 + x.llOu;
  results.sort((a, b) => total(a) - total(b));
  const best = results[0]!;
  const modelOnly = results.filter((x) => x.w === 1).sort((a, b) => total(a) - total(b))[0]!;
  const marketOnly = results.find((x) => x.w === 0)!;

  // What the pick rules would have done with the best settings (value bets at Pinnacle's pre-match price).
  const cfg = DEFAULT_PICK_CONFIG;
  const valueBets = (rho: number, w: number) => {
    let bets = 0;
    let wins = 0;
    let profit = 0;
    for (const c of scored) {
      if (c.n < cfg.minMatches) continue;
      const { p1, pOver } = probsFor(c, rho);
      const f1 = c.r.pin1x2!;
      const fo = c.r.pinOu!;
      const out = c.r.homeGoals > c.r.awayGoals ? 0 : c.r.homeGoals === c.r.awayGoals ? 1 : 2;
      const cands = [
        ...p1.map((p, i) => ({ p: w * p + (1 - w) * f1[i]!, fair: f1[i]!, odds: c.r.odds1x2![i]!, won: i === out })),
        { p: w * pOver + (1 - w) * fo[0], fair: fo[0], odds: c.r.oddsOu![0], won: c.r.homeGoals + c.r.awayGoals > 2.5 },
        { p: w * (1 - pOver) + (1 - w) * fo[1], fair: fo[1], odds: c.r.oddsOu![1], won: c.r.homeGoals + c.r.awayGoals < 2.5 },
      ];
      for (const k of cands) {
        const edge = k.p - k.fair;
        const ev = k.p * k.odds - 1;
        if (edge >= cfg.minEdge && edge <= cfg.maxEdge && ev >= cfg.minEv) {
          bets++;
          if (k.won) {
            wins++;
            profit += k.odds - 1;
          } else profit -= 1;
        }
      }
    }
    return { bets, wins, roi: bets ? profit / bets : null };
  };
  for (const w of [1, 0.5, 0.25]) {
    const v = valueBets(-0.1, w);
    console.log(`Value picks if model weight ${w}: ${v.bets} bets, ${v.wins} won, ROI ${v.roi === null ? "n/a" : (v.roi * 100).toFixed(1) + "%"}`);
  }
  const { bets, wins, roi } = valueBets(best.rho, best.w);
  const profit = (roi ?? 0) * bets;

  const seasons = [...new Set(all.map((r) => r.date.slice(0, 4)))];
  const summary = {
    ranAt: new Date().toISOString().slice(0, 10),
    leagues,
    matchesScored: scored.length,
    from: scored[0]?.r.date.slice(0, 10),
    to: scored.at(-1)?.r.date.slice(0, 10),
    best: { rho: best.rho, modelWeight: best.w },
    logLoss: {
      market: +(marketOnly.ll1x2 + marketOnly.llOu).toFixed(4),
      modelOnly: +(modelOnly.ll1x2 + modelOnly.llOu).toFixed(4),
      blended: +total(best).toFixed(4),
    },
    picks: { bets, wins, roi: bets ? +(profit / bets).toFixed(4) : null },
    valueRoiModelOnly: (() => { const v = valueBets(modelOnly.rho, 1); return v.roi === null ? null : +v.roi.toFixed(4); })(),
    valueBetsModelOnly: valueBets(modelOnly.rho, 1).bets,
  };
  writeFileSync("apps/web/src/backtest.json", JSON.stringify(summary, null, 2) + "\n");

  console.log(`Leagues ${leagues.join(", ")} · years ${seasons.join(", ")} · ${scored.length} matches scored`);
  console.log("Top settings by log loss (1X2 + O/U 2.5, lower is better):");
  for (const r of results.slice(0, 6)) {
    console.log(`  rho ${r.rho.toFixed(2)}  model weight ${r.w.toFixed(2)}  -> ${total(r).toFixed(4)}  (1X2 ${r.ll1x2.toFixed(4)}, O/U ${r.llOu.toFixed(4)}, Brier ${r.brier1x2.toFixed(4)})`);
  }
  console.log(`Market only: ${summary.logLoss.market} · model only (best rho): ${summary.logLoss.modelOnly} · best blend: ${summary.logLoss.blended}`);
  console.log(`Pick rules at best settings: ${bets} bets, ${wins} won, ROI ${summary.picks.roi === null ? "n/a" : (summary.picks.roi * 100).toFixed(1) + "%"}`);
}

main();
