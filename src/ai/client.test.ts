import { beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { claudeUnavailable, ClaudeKeysUnusable, keyUnusable, PRIMARY_OUT_MS, resetKeyMemory, withClaude } from "./client";

const PRIMARY = "test-primary-value";
const BACKUP = "test-backup-value";
const env = { ANTHROPIC_API_KEY: PRIMARY, ANTHROPIC_API_KEY_BACKUP: BACKUP };

/** An error exactly as the SDK builds one from an Anthropic response. */
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

const CREDIT = () => apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");

/** A stubbed SDK: records which key each client got; `answer` decides per key what the call does. */
function stub(answer: (apiKey: string | undefined) => unknown) {
  const keys: Array<string | undefined> = [];
  const make = (o: ClientOptions) => {
    keys.push(typeof o.apiKey === "string" ? o.apiKey : undefined);
    return { key: o.apiKey } as unknown as Anthropic;
  };
  const run = async (c: Anthropic) => {
    const out = answer((c as unknown as { key?: string }).key);
    if (out instanceof Error) throw out;
    return out;
  };
  const log = { warn: vi.fn(), info: vi.fn() };
  return { keys, make, run, log };
}

beforeEach(() => resetKeyMemory());

describe("keyUnusable", () => {
  it.each([
    ["credit balance too low (400)", CREDIT(), "400 credit balance too low"],
    ["bad key (401)", apiError(401, "authentication_error", "invalid x-api-key"), "401 key rejected"],
    ["not allowed (403)", apiError(403, "permission_error", "not allowed"), "403 key not allowed"],
    ["rate limited (429)", apiError(429, "rate_limit_error", "slow down"), "429 rate limited"],
    ["overloaded (529)", apiError(529, "overloaded_error", "Overloaded"), "529 overloaded"],
    ["billing (402)", apiError(402, "billing_error", "billing"), "402 billing"],
  ])("fails over on %s", (_name, e, reason) => {
    expect(keyUnusable(e)).toBe(reason);
  });

  it.each([
    ["a bad schema (400)", apiError(400, "invalid_request_error", "output_config.format: invalid schema")],
    ["a prompt that is too long (400)", apiError(400, "invalid_request_error", "prompt is too long: 1200000 tokens > 1000000 maximum")],
    ["not found (404)", apiError(404, "not_found_error", "model not found")],
    ["a server error (500)", apiError(500, "api_error", "Internal server error")],
    ["a timeout", new Anthropic.APIConnectionTimeoutError()],
    ["an abort", new Anthropic.APIUserAbortError()],
    ["a plain error", new Error("credit balance is too low")],
  ])("never fails over on %s", (_name, e) => {
    expect(keyUnusable(e)).toBeNull();
  });
});

describe("withClaude", () => {
  it("uses the primary key when it works, and never touches the backup", async () => {
    const s = stub(() => "ok");
    await expect(withClaude("check", { timeout: 1 }, s.run, { make: s.make, env, log: s.log })).resolves.toBe("ok");
    expect(s.keys).toEqual([PRIMARY]);
  });

  it.each([
    ["credit balance too low", CREDIT],
    ["401", () => apiError(401, "authentication_error", "invalid x-api-key")],
    ["403", () => apiError(403, "permission_error", "nope")],
    ["429 after the SDK's retries", () => apiError(429, "rate_limit_error", "slow down")],
    ["529 overloaded", () => apiError(529, "overloaded_error", "Overloaded")],
  ])("retries once with the backup on %s", async (_name, err) => {
    const s = stub((k) => (k === PRIMARY ? err() : "from backup"));
    await expect(withClaude("check", {}, s.run, { make: s.make, env, log: s.log })).resolves.toBe("from backup");
    expect(s.keys).toEqual([PRIMARY, BACKUP]);
  });

  it("passes the caller's client options through to both keys", async () => {
    const seen: ClientOptions[] = [];
    const s = stub((k) => (k === PRIMARY ? CREDIT() : "ok"));
    const make = (o: ClientOptions) => (seen.push(o), s.make(o));
    await withClaude("check", { timeout: 20_000, maxRetries: 1 }, s.run, { make, env, log: s.log });
    expect(seen.map((o) => [o.timeout, o.maxRetries])).toEqual([
      [20_000, 1],
      [20_000, 1],
    ]);
  });

  it.each([
    ["a bad schema", () => apiError(400, "invalid_request_error", "invalid schema")],
    ["a prompt that is too long", () => apiError(400, "invalid_request_error", "prompt is too long")],
    ["a timeout", () => new Anthropic.APIConnectionTimeoutError()],
    ["an abort", () => new Anthropic.APIUserAbortError()],
  ])("does not retry %s on the backup", async (_name, err) => {
    const e = err();
    const s = stub(() => e);
    await expect(withClaude("check", {}, s.run, { make: s.make, env, log: s.log })).rejects.toBe(e);
    expect(s.keys).toEqual([PRIMARY]);
  });

  it("remembers the primary is out, goes straight to the backup, and tries the primary again later", async () => {
    let t = 1_000;
    const now = () => t;
    const s = stub((k) => (k === PRIMARY ? CREDIT() : "ok"));
    await withClaude("check", {}, s.run, { make: s.make, env, now, log: s.log });
    await withClaude("case", {}, s.run, { make: s.make, env, now, log: s.log });
    expect(s.keys).toEqual([PRIMARY, BACKUP, BACKUP]);
    t += PRIMARY_OUT_MS + 1;
    await withClaude("check", {}, s.run, { make: s.make, env, now, log: s.log });
    expect(s.keys).toEqual([PRIMARY, BACKUP, BACKUP, PRIMARY, BACKUP]);
  });

  it("goes back to the primary when the backup can't be used either while the primary is remembered as out", async () => {
    let topUp = false;
    const s = stub((k) => (k === BACKUP ? CREDIT() : topUp ? "primary again" : CREDIT()));
    await expect(withClaude("check", {}, s.run, { make: s.make, env, log: s.log })).rejects.toBeInstanceOf(ClaudeKeysUnusable);
    topUp = true;
    await expect(withClaude("check", {}, s.run, { make: s.make, env, log: s.log })).resolves.toBe("primary again");
    expect(s.keys).toEqual([PRIMARY, BACKUP, BACKUP, PRIMARY]);
  });

  it("says no key could be used when both fail that way, keeping the last error as the cause", async () => {
    const last = apiError(401, "authentication_error", "invalid x-api-key");
    const s = stub((k) => (k === PRIMARY ? CREDIT() : last));
    const e = await withClaude("check", {}, s.run, { make: s.make, env, log: s.log }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ClaudeKeysUnusable);
    expect((e as ClaudeKeysUnusable).cause).toBe(last);
    expect(claudeUnavailable(e)).toBe(true);
  });

  it("without a backup key, a key error still ends as 'no key could be used'", async () => {
    const s = stub(() => CREDIT());
    await expect(withClaude("check", {}, s.run, { make: s.make, env: { ANTHROPIC_API_KEY: PRIMARY }, log: s.log })).rejects.toBeInstanceOf(ClaudeKeysUnusable);
    expect(s.keys).toEqual([PRIMARY]);
  });

  it("with only a backup key, uses it", async () => {
    const s = stub(() => "ok");
    await withClaude("check", {}, s.run, { make: s.make, env: { ANTHROPIC_API_KEY_BACKUP: BACKUP }, log: s.log });
    expect(s.keys).toEqual([BACKUP]);
  });

  it("logs the key slot by name and never a key value", async () => {
    const s = stub((k) => (k === PRIMARY ? CREDIT() : "ok"));
    await withClaude("check", {}, s.run, { make: s.make, env, log: s.log });
    const logged = JSON.stringify([...s.log.warn.mock.calls, ...s.log.info.mock.calls]);
    expect(logged).toContain("primary key can't be used (400 credit balance too low), trying the backup key");
    expect(logged).not.toContain(PRIMARY);
    expect(logged).not.toContain(BACKUP);
  });
});

describe("claudeUnavailable", () => {
  it("is true when Claude is down or unreachable, false for a request Claude rejected", () => {
    expect(claudeUnavailable(apiError(500, "api_error", "x"))).toBe(true);
    expect(claudeUnavailable(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    expect(claudeUnavailable(new Anthropic.APIUserAbortError())).toBe(false);
    expect(claudeUnavailable(apiError(400, "invalid_request_error", "invalid schema"))).toBe(false);
    expect(claudeUnavailable(new Error("model gave no usable output (refusal)"))).toBe(false);
  });
});
