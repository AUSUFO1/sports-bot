import { settlePick } from "@sports/stats";
import type { Env } from "../types";

/** Marks logged picks as win / loss / void once their match has a final score. Safe to run any time. */
export async function settlePicks(env: Env, now = new Date()) {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.market, p.selection, m.status, m.home_goals, m.away_goals
     FROM picks_log p JOIN matches m ON m.id = p.match_id
     WHERE p.result IS NULL AND m.status IN ('finished', 'postponed')
     LIMIT 100`,
  ).all<{ id: number; market: string; selection: string; status: string; home_goals: number | null; away_goals: number | null }>();

  const upd = env.DB.prepare(`UPDATE picks_log SET result = ?1, final_score = ?2, settled_at = ?3 WHERE id = ?4 AND result IS NULL`);
  const stmts: D1PreparedStatement[] = [];
  const out = { win: 0, loss: 0, void: 0, skipped: 0 };
  for (const r of rows.results) {
    if (r.status === "postponed") {
      stmts.push(upd.bind("void", null, now.toISOString(), r.id));
      out.void++;
      continue;
    }
    if (r.home_goals === null || r.away_goals === null) {
      out.skipped++; // finished but no score stored yet: wait, never guess
      continue;
    }
    const res = settlePick(r.market, r.selection, r.home_goals, r.away_goals);
    if (!res) {
      out.skipped++;
      continue;
    }
    stmts.push(upd.bind(res, `${r.home_goals}-${r.away_goals}`, now.toISOString(), r.id));
    out[res]++;
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  const summary = { at: now.toISOString(), checked: rows.results.length, ...out };
  await env.KV.put("lastRun:settlePicks", JSON.stringify(summary));
  return summary;
}
