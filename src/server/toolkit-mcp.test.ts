import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { createHousehold } from "@/core/households";
import { pgliteDb } from "@/db";
import { createSpender, type Deps } from "@/core/lifecycle";
import { issueAgentToken } from "@/core/pairing";
import type { AiCheckResult } from "@/ai/check";
import { makeToolkitMcp } from "./toolkit-mcp";
import type { OrderReader } from "./toolkit-guard";
import type { Run } from "@/core/selling";
import { toolsFor } from "@/core/toolkit-coverage";

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
let deps: Deps;
let token: string;
let read: ReturnType<typeof vi.fn<OrderReader>>;
let run: ReturnType<typeof vi.fn<Run>>;
let warn: ReturnType<typeof vi.fn<NonNullable<Deps["warn"]>>>;
let handler: (req: Request) => Promise<Response> | Response;

beforeEach(async () => {
  const db = await pgliteDb();
  const hh = (await createHousehold(db, { name: "Test", spotterName: "Sam" })).id;
  await createSpender(db, {
    householdId: hh,
    id: "agent",
    name: "Shopping agent",
    kind: "agent",
    spotterName: "Sam",
    allowance: { weekly: { amount: 40000, currency: "USD" }, askAbove: { amount: 3000, currency: "USD" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] },
  });
  token = await issueAgentToken(db, "agent");
  warn = vi.fn<NonNullable<Deps["warn"]>>(async () => {});
  deps = {
    db,
    warn,
    check: vi.fn<Deps["check"]>(async () => clean()),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "5O190127TN364715T", authorizationId: "A1" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  read = vi.fn<OrderReader>(async (id) => JSON.stringify({ id, status: "COMPLETED" }));
  run = vi.fn<Run>(async () => JSON.stringify({ error: { message: "not stubbed", type: "paypal_error" } }));
  handler = makeToolkitMcp({ deps: async () => deps, read, run });
});

let rpcId = 0;
async function rpc(method: string, params: unknown, bearer: string | null = token) {
  const res = await handler(
    new Request("http://localhost/api/toolkit/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}";
  return { status: res.status, body: JSON.parse(data) as { result?: any; error?: any } };
}

const callText = (r: { body: { result?: any } }) => r.body.result?.content?.[0]?.text as string;

const ORDER = {
  currencyCode: "USD",
  items: [{ name: "Noise cancelling earbuds", quantity: 1, itemCost: 119, taxPercent: 0, itemTotal: 119 }],
  notes: "The user asked for new earbuds",
};

describe("guarded PayPal toolkit over MCP", () => {
  it("refuses calls without a valid agent key", async () => {
    expect((await rpc("tools/list", {}, null)).status).toBe(401);
    expect((await rpc("tools/list", {}, "spt_notarealtokennotarealtoken123")).status).toBe(401);
  });

  it("lists exactly the coverage table's tools for a shopping agent: guarded, passed through and bait, never hidden or approving", async () => {
    const names: string[] = (await rpc("tools/list", {})).body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(toolsFor("shopping").map((c) => c.tool).sort());
    for (const hidden of ["get_merchant_insights", "list_products", "get_refund"]) expect(names).not.toContain(hidden);
    expect(names.some((n) => /approve|capture|deny/.test(n))).toBe(false);
  });

  it("won't run a hidden toolkit tool", async () => {
    const r = await rpc("tools/call", { name: "get_merchant_insights", arguments: {} });
    expect(r.body.error ?? r.body.result?.isError).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  it("a bait tool is offered with PayPal's own name, description and schema", async () => {
    const tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }> = (await rpc("tools/list", {})).body.result.tools;
    const refund = tools.find((t) => t.name === "create_refund")!;
    const theirs = officialAll.find((t) => t.method === "create_refund")!;
    expect(refund.description).toBe(theirs.description.trim());
    expect(Object.keys(refund.inputSchema.properties).sort()).toEqual(["amount", "capture_id", "invoice_id", "note_to_payer"]);
    expect(refund.inputSchema.required).toEqual(["capture_id"]);
  });

  it("calling a bait tool never calls PayPal: the agent is frozen, its holds voided, the spotter told, and it gets a calm no", async () => {
    const held = JSON.parse(callText(await rpc("tools/call", { name: "create_order", arguments: ORDER })));
    expect(held.status).toBe("HELD_FOR_APPROVAL");
    const r = await rpc("tools/call", { name: "create_refund", arguments: { capture_id: "2GG279541U471931P", amount: { currency_code: "USD", value: "200.00" } } });
    expect(JSON.parse(callText(r)).error.message).toMatch(/Stop here and tell the user/);
    expect(run).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(deps.paypal.voidAuthorization).toHaveBeenCalledOnce();
    expect(deps.paypal.captureAuthorization).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![1].kind).toBe("agent_hijacked");
    const again = JSON.parse(callText(await rpc("tools/call", { name: "create_order", arguments: ORDER })));
    expect(again.error.message).toMatch(/frozen/i);
  });

  it("a bait call with junk arguments still springs the tripwire", async () => {
    const r = await rpc("tools/call", { name: "list_transactions", arguments: { page_size: "lots", evil: "<script>" } });
    expect(JSON.parse(callText(r)).error.message).toMatch(/spotter has been told/);
    const [t] = await deps.db.query<{ tool: string }>("select tool from tripwires");
    expect(t!.tool).toBe("list_transactions");
  });

  it("a selling agent is offered its own set: create_refund guarded, invoices not offered", async () => {
    await deps.db.query("update spenders set agent_job = 'selling' where id = 'agent'");
    const names: string[] = (await rpc("tools/list", {})).body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(toolsFor("selling").map((c) => c.tool).sort());
    const r = JSON.parse(callText(await rpc("tools/call", { name: "create_refund", arguments: { capture_id: "2GG279541U471931P" } })));
    expect(r.error.message).toMatch(/only refund a payment Spotter took for this family/);
    expect(await deps.db.query("select 1 from tripwires")).toHaveLength(0);
  });

  it("create_order with the toolkit's own arguments makes a held payment, and pay_order never captures it", async () => {
    const created = JSON.parse(callText(await rpc("tools/call", { name: "create_order", arguments: ORDER })));
    expect(created.status).toBe("HELD_FOR_APPROVAL");
    const paid = JSON.parse(callText(await rpc("tools/call", { name: "pay_order", arguments: { id: created.id } })));
    expect(paid.status).toBe("HELD_FOR_APPROVAL");
    expect(deps.paypal.captureAuthorization).not.toHaveBeenCalled();
  });

  it("get_order passes through to PayPal for the agent's own order", async () => {
    const created = JSON.parse(callText(await rpc("tools/call", { name: "create_order", arguments: ORDER })));
    const got = JSON.parse(callText(await rpc("tools/call", { name: "get_order", arguments: { id: created.id } })));
    expect(read).toHaveBeenCalledWith("5O190127TN364715T");
    expect(got.paypal.status).toBe("COMPLETED");
  });
});

const officialAll = new PayPalMCPToolkit({
  accessToken: "unused",
  configuration: { actions: new Proxy({}, { get: () => new Proxy({}, { get: () => true }) }) as never, context: { sandbox: true } },
}).getTools();

describe("matches PayPal's official toolkit definitions (v1.11.0)", () => {
  const official = officialAll;

  it("every tool Spotter offers exists in the toolkit, and an official call fits Spotter's schema", async () => {
    const ours: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }> = (await rpc("tools/list", {})).body.result.tools;
    for (const tool of ours) {
      const theirs = official.find((t) => t.method === tool.name);
      expect(theirs, tool.name).toBeTruthy();
      const schema = (zodToJsonSchema as (s: unknown) => unknown)(theirs!.parameters) as { properties: Record<string, unknown>; required?: string[] };
      // Every argument the toolkit knows, Spotter accepts; Spotter requires nothing the toolkit doesn't.
      for (const p of Object.keys(schema.properties)) expect(Object.keys(tool.inputSchema.properties), `${tool.name}.${p}`).toContain(p);
      for (const p of tool.inputSchema.required ?? []) expect(schema.required ?? [], `${tool.name}.${p}`).toContain(p);
    }
  });
});

describe("agent key lifecycle on the toolkit route", () => {
  it("logs every tool call for the key card, with the outcome", async () => {
    await rpc("tools/call", { name: "create_order", arguments: { ...ORDER, payee: "GadgetBarn" } });
    await rpc("tools/call", { name: "create_refund", arguments: { capture_id: "2GG279541U471931P", amount: { currency_code: "USD", value: "200.00" } } });
    const calls = await deps.db.query<{ tool: string; outcome: string }>("select tool, outcome from agent_calls order by id");
    expect(calls).toEqual([
      { tool: "create_order", outcome: "HELD_FOR_APPROVAL" },
      { tool: "create_refund", outcome: "tripwire" },
    ]);
  });

  it("an agent order carries PayPal custom_id with the key's label and the payment id", async () => {
    await rpc("tools/call", { name: "create_order", arguments: { ...ORDER, payee: "GadgetBarn" } });
    const opts = vi.mocked(deps.paypal.createAuthorizeOrder).mock.calls[0]![1];
    expect(opts.customId).toMatch(new RegExp(`^spt-${token.slice(-4).replace(/[-_]/g, "\\$&")}:pay_[a-z0-9]+$`));
  });

  it("answers 429 with a plain message once the key used up today's calls", async () => {
    handler = makeToolkitMcp({ deps: async () => deps, read, run, limits: { perKey: 1, global: 100 } });
    await rpc("tools/call", { name: "get_order", arguments: { id: "5O190127TN364715T" } });
    const r = await rpc("tools/list", {});
    expect(r.status).toBe(429);
    expect(JSON.stringify(r.body)).toMatch(/daily limit/);
  });

  it("the decoy key gets a calm 401, and the agent is frozen with both keys burned", async () => {
    const { issueAgentKeys } = await import("@/core/pairing");
    const { key, decoy } = await issueAgentKeys(deps.db, "agent");
    expect((await rpc("tools/list", {}, decoy)).status).toBe(401);
    expect((await rpc("tools/list", {}, key)).status).toBe(401);
    const [s] = await deps.db.query<{ frozen_at: string | null }>("select frozen_at from spenders where id = 'agent'");
    expect(s!.frozen_at).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "agent_hijacked" }));
  });
});
