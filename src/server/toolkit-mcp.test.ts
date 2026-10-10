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

const clean = (): AiCheckResult => ({ ok: true, flags: [], dropped: 0, hidden: [], summary: "Fine.", injectionAttempt: false });
let deps: Deps;
let token: string;
let read: ReturnType<typeof vi.fn<OrderReader>>;
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
  deps = {
    db,
    check: vi.fn<Deps["check"]>(async () => clean()),
    paypal: {
      createAuthorizeOrder: vi.fn(async () => ({ orderId: "5O190127TN364715T", authorizationId: "A1" })),
      captureAuthorization: vi.fn(async () => ({ captureId: "C1", status: "COMPLETED" })),
      voidAuthorization: vi.fn(async () => ({ status: "VOIDED" })),
    },
  };
  read = vi.fn<OrderReader>(async (id) => JSON.stringify({ id, status: "COMPLETED" }));
  handler = makeToolkitMcp({ deps: async () => deps, read });
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

  it("lists only the toolkit tools Spotter can guard or scope, and nothing that approves", async () => {
    const names: string[] = (await rpc("tools/list", {})).body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["create_order", "get_order", "pay_order"]);
    for (const hidden of ["create_refund", "create_invoice", "send_invoice", "create_subscription", "accept_dispute_claim", "list_transactions"]) {
      expect(names).not.toContain(hidden);
    }
    expect(names.some((n) => /approve|capture|deny|refund/.test(n))).toBe(false);
  });

  it("won't run a hidden toolkit tool", async () => {
    const r = await rpc("tools/call", { name: "create_refund", arguments: { capture_id: "X", amount: "10" } });
    expect(r.body.error ?? r.body.result?.isError).toBeTruthy();
    expect(deps.paypal.captureAuthorization).not.toHaveBeenCalled();
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

describe("matches PayPal's official toolkit definitions (v1.11.0)", () => {
  const official = new PayPalMCPToolkit({
    accessToken: "unused",
    configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } },
  }).getTools();

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
