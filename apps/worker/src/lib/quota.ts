/** Daily call counter per provider, kept in KV. Resets by UTC date in the key. */
export const DAILY_LIMITS: Record<string, number> = { "api-football": 100 };
const SAFETY_MARGIN = 10; // stop this many calls before the real limit

const key = (provider: string, now: Date) => `quota:${provider}:${now.toISOString().slice(0, 10)}`;

export async function callsToday(kv: KVNamespace, provider: string, now = new Date()): Promise<number> {
  return Number((await kv.get(key(provider, now))) ?? 0);
}

export async function canSpend(kv: KVNamespace, provider: string, n = 1, now = new Date()): Promise<boolean> {
  const limit = DAILY_LIMITS[provider] ?? 0;
  return (await callsToday(kv, provider, now)) + n <= limit - SAFETY_MARGIN;
}

export async function recordCall(kv: KVNamespace, provider: string, now = new Date()): Promise<void> {
  const used = await callsToday(kv, provider, now);
  await kv.put(key(provider, now), String(used + 1), { expirationTtl: 60 * 60 * 36 });
}
