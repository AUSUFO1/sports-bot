/** Normalise a team name so the same club matches across providers. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find a team by name or alias among known teams. Returns its id or null. */
export function matchTeam(name: string, teams: { id: string; name: string; aliases: string[] }[]): string | null {
  const n = normalizeName(name);
  for (const t of teams) {
    if (normalizeName(t.name) === n || t.aliases.some((a) => normalizeName(a) === n)) return t.id;
  }
  return null;
}
