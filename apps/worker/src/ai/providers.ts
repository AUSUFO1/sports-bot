import type { Env } from "../types";

/**
 * AI providers, tried in order. All use the OpenAI-compatible /chat/completions format, so adding one is one line.
 * A provider is skipped when its key is not set. Model names and limits change often.
 */
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  keyEnv: "GEMINI_API_KEY" | "GROQ_API_KEY" | "OPENROUTER_API_KEY";
  /** extra body fields this provider needs */
  extra?: Record<string, unknown>;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
// Gemini 3 models cannot switch thinking off; "low" keeps it small so it does not eat the answer budget (Google docs).
const GEMINI_EXTRA = { reasoning_effort: "low" };

export const PROVIDERS: ProviderConfig[] = [
  // Checked on 2026-11-23 with the free key: 3.6 and 3.5 answered (JSON mode + low thinking); 3.8, 3.7 and
  // "flash-latest" returned 503 "high demand" at that moment; 2.5-flash is closed to new users (404).
  // They share one key, so if one is busy the next one is tried.
  { name: "gemini", baseUrl: GEMINI, model: "gemini-3.6-flash", keyEnv: "GEMINI_API_KEY", extra: GEMINI_EXTRA },
  { name: "gemini", baseUrl: GEMINI, model: "gemini-3.5-flash", keyEnv: "GEMINI_API_KEY", extra: GEMINI_EXTRA },
  { name: "gemini", baseUrl: GEMINI, model: "gemini-3.8-flash", keyEnv: "GEMINI_API_KEY", extra: GEMINI_EXTRA },
  // TODO: verify model names and free limits before relying on these two.
  { name: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  { name: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", keyEnv: "OPENROUTER_API_KEY" },
];

export class AiCallError extends Error {
  constructor(public kind: "rate_limit" | "server" | "bad_request" | "network" | "empty", message: string) {
    super(message);
  }
}

/** Providers that have a key, in order. */
export function availableProviders(env: Env): ProviderConfig[] {
  return PROVIDERS.filter((p) => !!env[p.keyEnv]);
}

/** One call. Returns the model's text. Never logs the key or the prompt. */
export async function callProvider(
  env: Env,
  p: ProviderConfig,
  messages: { role: "system" | "user"; content: string }[],
): Promise<string> {
  const key = env[p.keyEnv];
  if (!key) throw new AiCallError("bad_request", "no key");
  const send = async (withJsonMode: boolean) => {
    try {
      return await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          messages,
          temperature: 0.2, // low: this is an explanation, not a creative task
          max_tokens: 3000, // includes any hidden thinking tokens
          ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(p.extra ?? {}),
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      throw new AiCallError("network", e instanceof Error ? e.name : "network error");
    }
  };

  let res = await send(true);
  if (res.status === 400) res = await send(false); // some providers reject JSON mode: retry once without it
  if (res.status === 429) throw new AiCallError("rate_limit", `${p.name} rate limited`);
  if (res.status >= 500) throw new AiCallError("server", `${p.name} error ${res.status}`);
  if (!res.ok) throw new AiCallError("bad_request", `${p.name} answered ${res.status}`);

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new AiCallError("empty", `${p.name} returned an empty answer`);
  return text;
}
