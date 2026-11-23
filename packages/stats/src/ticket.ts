/** Builds an accumulator (ticket) from top picks. The user places it by hand; nothing is sent anywhere. */

export interface TicketCandidate {
  matchId: string;
  home: string;
  away: string;
  kickoffUtc: string;
  market: string;
  selection: string;
  modelProb: number;
  odds: number | null;
  /** lowest odds worth taking on this leg (see TopPick.minOdds) */
  minOdds?: number;
  kind: "value" | "model";
  ticketOk: boolean;
}

export interface Ticket {
  legs: TicketCandidate[];
  /** product of the legs' model probabilities: the model's own chance that EVERY leg wins */
  combinedProb: number;
  /** product of the odds, only when every leg has odds */
  combinedOdds: number | null;
  /** model-implied value of the whole ticket, only when odds are known */
  ev: number | null;
  /** break-even combined odds: 1 / combinedProb. Take the ticket only if the real combined odds are at least this. */
  breakEvenOdds: number;
  /** lowest combined odds worth taking: product of every leg's minOdds, when all legs have one */
  minCombinedOdds: number | null;
}

/**
 * Picks the safest legs: only ticket-ok candidates still in the future, one leg per match,
 * highest model probability first, at most maxLegs. Returns null when nothing qualifies.
 */
export function buildTicket(cands: TicketCandidate[], maxLegs = 4, now = Date.now()): Ticket | null {
  const byMatch = new Map<string, TicketCandidate>();
  for (const c of cands) {
    if (!c.ticketOk || Date.parse(c.kickoffUtc) <= now) continue;
    const cur = byMatch.get(c.matchId);
    if (!cur || c.modelProb > cur.modelProb) byMatch.set(c.matchId, c);
  }
  const legs = [...byMatch.values()].sort((a, b) => b.modelProb - a.modelProb).slice(0, maxLegs);
  if (legs.length === 0) return null;
  const combinedProb = legs.reduce((p, l) => p * l.modelProb, 1);
  const allOdds = legs.every((l) => l.odds !== null);
  const combinedOdds = allOdds ? legs.reduce((p, l) => p * l.odds!, 1) : null;
  const minCombinedOdds = legs.every((l) => l.minOdds !== undefined) ? legs.reduce((p, l) => p * l.minOdds!, 1) : null;
  return {
    legs,
    combinedProb,
    combinedOdds,
    ev: combinedOdds === null ? null : combinedProb * combinedOdds - 1,
    breakEvenOdds: 1 / combinedProb,
    minCombinedOdds,
  };
}
