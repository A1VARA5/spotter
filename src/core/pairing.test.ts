import { beforeEach, describe, expect, it } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold, getHousehold, newId } from "./households";
import { createSpender, getSpender } from "./lifecycle";
import { PRESETS } from "./presets";
import { createPairingCode, findCode, issueAgentToken, redeemPairingCode, verifyAgentToken, CODE_ALPHABET } from "./pairing";

let db: Db;
let hh: string;
let gran: string;
let agent: string;

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "H", spotterName: "Sam" })).id;
  gran = newId("sp");
  agent = newId("sp");
  await createSpender(db, { id: gran, householdId: hh, name: "Gran", kind: "person", spotterName: "Sam", allowance: PRESETS.relative.allowance });
  await createSpender(db, { id: agent, householdId: hh, name: "Bot", kind: "agent", spotterName: "Sam", allowance: PRESETS.agent.allowance });
});

describe("pairing codes", () => {
  it("are found anywhere in a subject or message, in any case", () => {
    expect(findCode("Subject: Pairing spot-abcdef\n\nhi")).toBe("SPOT-ABCDEF");
    expect(findCode("/start SPOT-7KQ2XM")).toBe("SPOT-7KQ2XM");
    expect(findCode("SPOT-ABCDEFG")).toBeNull();
    expect(findCode("nothing here")).toBeNull();
  });

  it("look like SPOT-XXXXXX with no lookalike characters", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
    expect(code).toMatch(/^SPOT-[A-Z2-9]{6}$/);
    for (const c of code.slice(5)) expect(CODE_ALPHABET).toContain(c);
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("pair a spender's email once, then stop working", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
    const r = await redeemPairingCode(db, ` ${code.toLowerCase()} `, "email", "Gran@Example.com");
    expect(r?.spender?.id).toBe(gran);
    expect((await getSpender(db, gran))?.email).toBe("gran@example.com");
    expect(await redeemPairingCode(db, code, "email", "someone@else.com")).toBeNull();
  });

  it("a code for one channel can't pair another", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "telegram" });
    expect(await redeemPairingCode(db, code, "email", "gran@example.com")).toBeNull();
  });

  it("expired codes don't work", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
    await db.query("update pairing_codes set expires_at = now() - interval '1 minute'");
    expect(await redeemPairingCode(db, code, "email", "gran@example.com")).toBeNull();
  });

  it("a spotter code (no spender) pairs the household itself", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: null, channel: "telegram" });
    const r = await redeemPairingCode(db, code, "telegram", "555");
    expect(r).toEqual({ householdId: hh, spender: null });
    expect((await getHousehold(db, hh))?.telegram_chat_id).toBe("555");
  });

  it("locks an identity out after 10 wrong codes in an hour, even for a right one", async () => {
    const code = await createPairingCode(db, { householdId: hh, spenderId: gran, channel: "email" });
    for (let i = 0; i < 10; i++) expect(await redeemPairingCode(db, "SPOT-ZZZZZZ", "email", "x@y.com")).toBeNull();
    expect(await redeemPairingCode(db, code, "email", "x@y.com")).toBeNull();
    expect(await redeemPairingCode(db, code, "email", "other@y.com")).not.toBeNull();
  });
});

describe("agent tokens", () => {
  it("are shown once, stored hashed, and identify the agent", async () => {
    const token = await issueAgentToken(db, agent);
    expect(token).toMatch(/^spt_[A-Za-z0-9_-]{40,}$/);
    const rows = await db.query<{ hash: string }>("select hash from agent_tokens");
    expect(rows[0]!.hash).not.toContain(token.slice(4));
    expect(await verifyAgentToken(db, token)).toEqual({ spenderId: agent, householdId: hh });
    expect(await verifyAgentToken(db, token + "x")).toBeNull();
    expect(await verifyAgentToken(db, undefined)).toBeNull();
  });

  it("reissuing revokes the old one", async () => {
    const old = await issueAgentToken(db, agent);
    const fresh = await issueAgentToken(db, agent);
    expect(await verifyAgentToken(db, old)).toBeNull();
    expect((await verifyAgentToken(db, fresh))?.spenderId).toBe(agent);
  });

  it("only agents get tokens", async () => {
    await expect(issueAgentToken(db, gran)).rejects.toThrow();
  });

it("a spotter email code sets where alerts go", async () => {
  const code = await createPairingCode(db, { householdId: hh, spenderId: null, channel: "email" });
  await redeemPairingCode(db, code, "email", "Me@Gmail.com");
  expect((await getHousehold(db, hh))?.alert_email).toBe("me@gmail.com");
});
});
