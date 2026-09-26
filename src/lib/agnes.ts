/**
 * Agnes AI client — runs entirely in the browser. No server, no worker.
 * Docs: https://agnes-ai.com/en/docs/overview — base URL https://apihub.agnes-ai.com/v1
 */

const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
export const AGNES_MODEL = "agnes-3.0-flash";
/** Indic retellings use 2.5-flash: 3.0-flash produces broken Hindi/Marathi wording. */
export const AGNES_INDIC_MODEL = "agnes-2.5-flash";

export type AgnesMessage = { role: "system" | "user" | "assistant"; content: string };
export type LangCode = "en" | "hi" | "mr";

/** Temporary keys, intentionally shipped in the browser bundle. One key per language. */
export const API_KEYS: Record<LangCode, string> = {
  en: "sk-I04D4YBECov6kYvbrk2JRno1VY2xyGgxWeJNb7pOPZ43q5fG",
  hi: "sk-OoJrEYImZTN6by4tJoINV0AChxoT5AJyZmKQwcdVBBqDcDZ3",
  mr: "sk-fLpoyFOy5Z71A6aMNQ3tcNCeYoVecwQ33wuYCZe3dbhOTDsw",
};

/** Exactly 60 seconds of cooldown when a key hits its limit. Nothing longer. */
export const COOLDOWN_MS = 60_000;

export function getApiKey(lang: LangCode): string {
  return API_KEYS[lang];
}

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

/** Rate limit / quota / transient upstream failure — always recoverable after a cooldown. */
class CooldownError extends Error {}

export type AgnesProgress = {
  /** Called with remaining seconds while a key is cooling down. */
  onCooldown?: ((secondsLeft: number, reason: string) => void) | undefined;
  /** Return true to abort the whole run. */
  isCancelled?: (() => boolean) | undefined;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cooldown(reason: string, progress: AgnesProgress) {
  const until = Date.now() + COOLDOWN_MS;
  while (Date.now() < until) {
    if (progress.isCancelled?.()) throw new CancelledError();
    progress.onCooldown?.(Math.max(1, Math.ceil((until - Date.now()) / 1000)), reason);
    await sleep(1000);
  }
}

/**
 * Calls Agnes and never gives up on a recoverable failure: it waits exactly 60s
 * and retries the SAME request, so the story resumes from precisely where it
 * stopped without losing the thread.
 */
export async function agnesChat(opts: {
  apiKey: string;
  model?: string | undefined;
  messages: AgnesMessage[];
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  progress?: AgnesProgress | undefined;
}): Promise<string> {
  const progress = opts.progress ?? {};
  const baseTokens = opts.maxTokens ?? 8000;
  let softAttempt = 0;

  for (;;) {
    if (progress.isCancelled?.()) throw new CancelledError();
    try {
      const content = await agnesChatOnce({
        apiKey: opts.apiKey,
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature,
        maxTokens: Math.min(baseTokens + Math.min(softAttempt, 2) * 4000, 16000),
      });
      if (content) return content;
      // Empty reply: reasoning ate the budget or a transient hiccup. Short bump, then retry.
      softAttempt += 1;
      if (softAttempt >= 3) {
        softAttempt = 0;
        await cooldown("empty responses", progress);
      } else {
        await sleep(1500 * softAttempt);
      }
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      if (error instanceof CooldownError) {
        await cooldown(error.message, progress);
        continue;
      }
      throw error;
    }
  }
}

async function agnesChatOnce(opts: {
  apiKey: string;
  model?: string | undefined;
  messages: AgnesMessage[];
  maxTokens: number;
  temperature?: number | undefined;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? AGNES_MODEL,
        messages: opts.messages,
        temperature: opts.temperature ?? 1.0,
        top_p: 0.95,
        max_tokens: opts.maxTokens,
        reasoning_effort: "low",
      }),
    });
  } catch {
    throw new CooldownError("network error");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error("Agnes rejected this API key (unauthorized).");
    }
    if (response.status === 429) throw new CooldownError("rate limit reached");
    if (response.status === 402) throw new CooldownError("key out of credits");
    if (response.status >= 500) throw new CooldownError(`server error ${response.status}`);
    if (/rate|limit|quota|exceed/i.test(body)) throw new CooldownError("limit reached");
    throw new Error(`Agnes request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
    error?: { message?: string };
  } | null;
  if (data?.error?.message && /rate|limit|quota|exceed/i.test(data.error.message)) {
    throw new CooldownError("limit reached");
  }
  return stripThinking(data?.choices?.[0]?.message?.content ?? "");
}
