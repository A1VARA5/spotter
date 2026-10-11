import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/core/households";
import { pgliteDb, type Db } from "@/db";
import { createSpender, type Deps } from "./lifecycle";
import { authenticate, issueAgentKeys, issueAgentToken, verifyAgentToken } from "./pairing";
import { keyCard, keyLabel, logCall, overLimit, springCanary, switchOff } from "./agent-keys";

const usd = (amount: number) => ({ amount, currency: "USD" as const });
let db: Db;
let hh: string;
let other: string;
let warn: ReturnType<typeof vi.fn<NonNullable<Deps["warn"]>>>;
let deps: Deps;

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  other = (await createHousehold(db, { name: "Other", spotterName: "Kim" })).id;
  const allowance = { weekly: usd(40000), askAbove: usd(3000), blockedCategories: [], allowedPayees: [], blockedPayees: [] };
  await createSpender(db, { householdId: hh, id: "agent", name: "Shopping agent", kind: "agent", spotterName: "Sam", allowance });
  warn = vi.fn<NonNullable<Deps["warn"]>>(async () => {});
  deps = { db, check: vi.fn(), warn, paypal: { createAuthorizeOrder: vi.fn(), captureAuthorization: vi.fn(), voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })) } } as unknown as Deps;
});

describe("agent keys with a planted decoy", () => {
  it("makes a real key and a decoy; only the real key works, the decoy is recognised as a canary", async () => {
    const { key, decoy } = await issueAgentKeys(db, "agent");
    expect(key).toMatch(/^spt_[A-Za-z0-9_-]{40,}$/);
    expect(decoy).toMatch(/^spt_[A-Za-z0-9_-]{40,}$/);
    expect(decoy).not.toBe(key);
    expect(await verifyAgentToken(db, key)).toMatchObject({ spenderId: "agent", householdId: hh });
    expect(await verifyAgentToken(db, decoy)).toBeNull();
    expect(await authenticate(db, decoy)).toMatchObject({ kind: "canary", spenderId: "agent" });
  });

  it("a new key switches off the old key and the old decoy", async () => {
    const first = await issueAgentKeys(db, "agent");
    await issueAgentToken(db, "agent");
    expect(await authenticate(db, first.key)).toBeNull();
    expect(await authenticate(db, first.decoy)).toBeNull();
  });

  it("an expired key doesn't work", async () => {
    const { key } = await issueAgentKeys(db, "agent", { expiresInMinutes: -1 });
    expect(await verifyAgentToken(db, key)).toBeNull();
  });

  it("the decoy being used means the agent leaked its secrets: freeze, burn both keys, alert, record", async () => {
    const { key, decoy } = await issueAgentKeys(db, "agent");
    const hit = await authenticate(db, decoy);
    if (hit?.kind !== "canary") throw new Error("expected a canary hit");
    await springCanary(deps, hit);
    const [s] = await db.query<{ frozen_at: string | null }>("select frozen_at from spenders where id = 'agent'");
    expect(s!.frozen_at).not.toBeNull();
    expect(await authenticate(db, key)).toBeNull();
    expect(await authenticate(db, decoy)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatchObject({ kind: "agent_hijacked" });
    expect(String(warn.mock.calls[0]![1].text)).toMatch(/leaked/i);
    const trips = await db.query<{ tool: string }>("select tool from tripwires where spender_id = 'agent'");
    expect(trips.map((t) => t.tool)).toEqual(["decoy_key"]);
    expect((await keyCard(db, hh, "agent"))?.status).toBe("frozen");
  });
});

describe("the canary when something breaks half way", () => {
  it("doesn't burn the keys until the freeze and the record are saved, so the next decoy use tries again", async () => {
    const { decoy } = await issueAgentKeys(db, "agent");
    const real = db.query.bind(db);
    let failed = false;
    const flaky = {
      ...deps,
      db: {
        query: (async (sql: string, params?: unknown[]) => {
          if (!failed && sql.startsWith("insert into tripwires")) {
            failed = true;
            throw new Error("connection reset");
          }
          return real(sql, params);
        }) as Db["query"],
      },
    } as Deps;
    const hit = (await authenticate(db, decoy)) as Extract<Awaited<ReturnType<typeof authenticate>>, { kind: "canary" }>;
    await expect(springCanary(flaky, hit)).rejects.toThrow(/connection reset/);
    const again = await authenticate(db, decoy);
    expect(again?.kind).toBe("canary");
    await springCanary(flaky, again as typeof hit);
    expect(await authenticate(db, decoy)).toBeNull();
    expect(await db.query("select 1 from tripwires where tool = 'decoy_key'")).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("rate limits on the agent MCP routes", () => {
  it("counts tool calls per key per day, then refuses with a plain message", async () => {
    const { key } = await issueAgentKeys(db, "agent");
    const a = (await authenticate(db, key))!;
    if (a.kind !== "agent") throw new Error("expected the agent");
    const limits = { perKey: 2, global: 100 };
    expect(await overLimit(db, a.hash, limits)).toBeNull();
    await logCall(db, a, "create_order", "ok", {});
    await logCall(db, a, "get_order", "ok", {});
    expect(await overLimit(db, a.hash, limits)).toMatch(/2 tool calls today/);
  });

  it("has a global daily cap across every key", async () => {
    const { key } = await issueAgentKeys(db, "agent");
    const a = (await authenticate(db, key))! as Extract<Awaited<ReturnType<typeof authenticate>>, { kind: "agent" }>;
    await logCall(db, a, "get_order", "ok", {});
    expect(await overLimit(db, a.hash, { perKey: 100, global: 1 })).toMatch(/today's limit/);
  });
});

describe("the key card", () => {
  it("shows the label, job, allowance left, status and the last 5 calls with args as capped plain text", async () => {
    const { key } = await issueAgentKeys(db, "agent");
    const a = (await authenticate(db, key))! as Extract<Awaited<ReturnType<typeof authenticate>>, { kind: "agent" }>;
    for (let i = 0; i < 6; i++) await logCall(db, a, `tool_${i}`, i === 5 ? "tripwire" : "ok", { note: "<b>" + "x".repeat(500) });
    const card = (await keyCard(db, hh, "agent"))!;
    expect(card.label).toBe(`spt_…${key.slice(-4)}`);
    expect(card.job).toBe("shopping");
    expect(card.status).toBe("live");
    expect(card.allowanceLeft).toEqual({ amount: 40000, currency: "USD" });
    expect(card.lastUsedAt).not.toBeNull();
    expect(card.calls).toHaveLength(5);
    expect(card.calls[0]).toMatchObject({ tool: "tool_5", outcome: "tripwire" });
    expect(card.calls[0]!.args.length).toBeLessThanOrEqual(301);
    expect(card.calls[0]!.args).toContain("<b>");
  });

  it("is only for the spotter's own household", async () => {
    await issueAgentKeys(db, "agent");
    expect(await keyCard(db, other, "agent")).toBeNull();
  });

  it("Switch off now revokes the key without making a new one, only in its own household", async () => {
    const { key } = await issueAgentKeys(db, "agent");
    expect(await switchOff(db, other, "agent")).toBe(false);
    expect(await verifyAgentToken(db, key)).not.toBeNull();
    expect(await switchOff(db, hh, "agent")).toBe(true);
    expect(await verifyAgentToken(db, key)).toBeNull();
    expect((await keyCard(db, hh, "agent"))?.status).toBe("switched_off");
  });

  it("the key's label for PayPal's custom_id has no secret in it beyond its last 4 characters", () => {
    expect(keyLabel("spt_abcdefghijklmnopqrstuvwxyz0123456789ABCD")).toBe("spt-ABCD");
  });
});
