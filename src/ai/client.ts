// One way to call Claude for every feature: try the primary key, and when Anthropic says that key can't be used
// (out of credit, rejected, rate limited after the SDK's own retries, overloaded), run the same request once more on
// ANTHROPIC_API_KEY_BACKUP. A primary that failed like that is skipped for a few minutes (per server instance), so
// later calls go straight to the backup. A real request error (bad schema, prompt too long, a timeout, an abort) is
// never retried on the other key: it would fail the same way. Logs name the key slot only, never the key.
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

export type KeySlot = "primary" | "backup";

/** How long a primary that couldn't be used is skipped before Spotter tries it again. */
export const PRIMARY_OUT_MS = 5 * 60_000;

let primaryOutUntil = 0;

/** Every Anthropic key Spotter has was tried and none could be used. `reason` is safe to log (no key in it). */
export class ClaudeKeysUnusable extends Error {
  constructor(
    readonly label: string,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`no Anthropic key could be used for ${label} (${reason})`, options);
    this.name = "ClaudeKeysUnusable";
  }
}

/**
 * Why this error means "this key can't be used right now", or null when it is a real request error (or a network
 * problem) that another key wouldn't fix. The SDK has no class for "credit balance too low": Anthropic sends it as a
 * 400 invalid_request_error, so that one case is recognised by its message.
 */
export function keyUnusable(e: unknown): string | null {
  if (!(e instanceof Anthropic.APIError) || typeof e.status !== "number") return null;
  if (e.status === 401) return "401 key rejected";
  if (e.status === 403) return "403 key not allowed";
  if (e.status === 402 || e.type === "billing_error") return `${e.status} billing`;
  if (e.status === 429) return "429 rate limited";
  if (e.status === 529 || e.type === "overloaded_error") return `${e.status} overloaded`;
  if (e.status === 400 && /credit balance is too low/i.test(e.message)) return "400 credit balance too low";
  return null;
}

/** True when Claude itself is unavailable (no usable key, Anthropic down or unreachable), not a bad request. */
export function claudeUnavailable(e: unknown): boolean {
  if (e instanceof ClaudeKeysUnusable) return true;
  if (e instanceof Anthropic.APIUserAbortError) return false;
  if (e instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  return e instanceof Anthropic.APIError && typeof e.status === "number" && e.status >= 500;
}

type Deps = {
  make?: (opts: ClientOptions) => Anthropic;
  env?: Record<string, string | undefined>;
  now?: () => number;
  log?: Pick<Console, "warn" | "info">;
};

/**
 * Runs `run` with a Claude client, failing over between the primary and backup keys as described above.
 * `label` names the feature in logs ("check", "case", ...).
 */
export async function withClaude<T>(label: string, opts: ClientOptions, run: (client: Anthropic) => Promise<T>, deps: Deps = {}): Promise<T> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const make = deps.make ?? ((o: ClientOptions) => new Anthropic(o));
  const log = deps.log ?? console;
  const backupKey = env.ANTHROPIC_API_KEY_BACKUP?.trim() || undefined;
  const primaryKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  // Without a backup, the primary is left to the SDK's own credential lookup when ANTHROPIC_API_KEY isn't set here.
  const slots: Array<{ slot: KeySlot; apiKey: string | undefined }> = [];
  if (primaryKey || !backupKey) slots.push({ slot: "primary", apiKey: primaryKey });
  if (backupKey) {
    const backup = { slot: "backup" as const, apiKey: backupKey };
    if (now() < primaryOutUntil) slots.unshift(backup);
    else slots.push(backup);
  }

  let last: { reason: string; error: unknown } | null = null;
  for (const [i, s] of slots.entries()) {
    try {
      const out = await run(make({ ...opts, ...(s.apiKey ? { apiKey: s.apiKey } : {}) }));
      if (s.slot === "primary") primaryOutUntil = 0;
      else log.info(`[spotter] claude ${label}: answered with the backup key`);
      return out;
    } catch (e) {
      const reason = keyUnusable(e);
      if (!reason) throw e;
      if (s.slot === "primary") primaryOutUntil = now() + PRIMARY_OUT_MS;
      const next = slots[i + 1];
      log.warn(`[spotter] claude ${label}: the ${s.slot} key can't be used (${reason})${next ? `, trying the ${next.slot} key` : ""}`);
      last = { reason, error: e };
    }
  }
  throw new ClaudeKeysUnusable(label, last!.reason, { cause: last!.error });
}

/** For tests: forget that the primary key was out. */
export function resetKeyMemory(): void {
  primaryOutUntil = 0;
}
