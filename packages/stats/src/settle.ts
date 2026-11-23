/** Decide whether a pick won, from the final score after 90 minutes (plus stoppage). Pure and tested. */

export type PickResult = "win" | "loss";

export function settlePick(market: string, selection: string, homeGoals: number, awayGoals: number): PickResult | null {
  const total = homeGoals + awayGoals;
  let won: boolean;
  if (market === "1x2") {
    if (selection === "home") won = homeGoals > awayGoals;
    else if (selection === "away") won = awayGoals > homeGoals;
    else if (selection === "draw") won = homeGoals === awayGoals;
    else return null;
  } else if (market === "btts") {
    const both = homeGoals > 0 && awayGoals > 0;
    if (selection === "yes") won = both;
    else if (selection === "no") won = !both;
    else return null;
  } else {
    const m = /^ou_(\d)_(\d)$/.exec(market); // ou_2_5 means line 2.5
    if (!m) return null;
    const line = Number(`${m[1]}.${m[2]}`);
    if (selection === "over") won = total > line;
    else if (selection === "under") won = total < line;
    else return null;
  }
  return won ? "win" : "loss";
}
