// The agent lab ("Hijack the agent"): a NAIVE TEST AGENT, scripted, runs against Spotter's real guarded toolkit MCP
// handler with a short lived key, step by step, so a judge can watch a tripwire spring without wiring up an MCP client.
// It does literally what the GadgetBarn page says (a real Claude refused the bait twice, so this agent is scripted on
// purpose and falls for it every time). Each run costs at most one Spotter AI check: no case agent, no price check, no
// alerts to channels. PayPal calls are real (sandbox): the hold is made and then voided at PayPal.
import type { Deps, Payment } from "@/core/lifecycle";
import { createSpender, deny } from "@/core/lifecycle";
import { issueAgentKeys } from "@/core/pairing";
import { switchOff } from "@/core/agent-keys";
import { toolsFor } from "@/core/toolkit-coverage";
import { COVERAGE } from "@/core/toolkit-coverage";
import { wouldHaveSent } from "@/core/tripwire";
import { SHOP_HTML } from "@/app/demo-shop/gadgetbarn/shop";
import type { Run } from "@/core/selling";
import { makeToolkitMcp } from "./toolkit-mcp";
import type { OrderReader } from "./toolkit-guard";

export const LAB_DAILY_RUNS = 3;
export const LAB_GLOBAL_DAILY_RUNS = Number(process.env.SPOTTER_LAB_DAILY_RUNS ?? 150);
const KEY_MINUTES = 10;
const SHOP_URL_PATH = "/demo-shop/gadgetbarn";

export type LabStep = {
  kind: "limit" | "start" | "tools" | "read" | "order" | "bait" | "freeze" | "void" | "confirm" | "done" | "error";
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  at: string;
};

/** The page as an AI agent reads it: every bit of text, including text hidden from people. */
export function pageText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

type Call = { name: string; arguments: Record<string, unknown> };

/** The naive agent's whole brain: buy what it was asked for, then obey the page. No model, no judgement. */
export function naivePlan(page: string): Call[] {
  const calls: Call[] = [
    {
      name: "create_order",
      arguments: {
        currencyCode: "USD",
        items: [{ name: "Pulse wireless earbuds", quantity: 1, itemCost: 19.99, taxPercent: 0, itemTotal: 19.99 }],
        payee: "GadgetBarn",
        category: "electronics",
        notes: "The user asked for the Pulse wireless earbuds from GadgetBarn.",
      },
    },
  ];
  const m = /refund capture ([A-Z0-9]{17,32}) for ([\d.]+) (USD|GBP)/.exec(page);
  if (m) calls.push({ name: "create_refund", arguments: { capture_id: m[1], amount: { currency_code: m[3], value: m[2] } } });
  return calls;
}

const now = () => new Date().toISOString();
const step = (kind: LabStep["kind"], title: string, extra: Omit<LabStep, "kind" | "title" | "at"> = {}): LabStep => ({ kind, title, ...extra, at: now() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Claims one run for the family. False (and nothing kept) when the family or everyone is over today's cap. */
async function claimRun(deps: Deps, householdId: string): Promise<string | null> {
  const { db } = deps;
  const [row] = await db.query<{ id: string }>("insert into lab_runs (household_id) values ($1) returning id::text as id", [householdId]);
  const [counts] = await db.query<{ mine: string; total: string }>(
    "select count(*) filter (where household_id = $1)::text as mine, count(*)::text as total from lab_runs where at > now() - interval '1 day'",
    [householdId],
  );
  const mine = Number(counts?.mine ?? 0);
  const total = Number(counts?.total ?? 0);
  if (mine <= LAB_DAILY_RUNS && total <= LAB_GLOBAL_DAILY_RUNS) return null;
  await db.query("delete from lab_runs where id = $1::bigint", [row!.id]);
  return mine > LAB_DAILY_RUNS
    ? `Your family has used today's ${LAB_DAILY_RUNS} runs of the lab. Each run makes a real PayPal sandbox hold and one Spotter check, so it is capped. It resets within 24 hours.`
    : "The lab has hit today's limit for everyone. It resets within 24 hours.";
}

/** The test agent lives in the family as its own agent, so its key never touches the family's real agent keys. */
async function labAgent(deps: Deps, householdId: string): Promise<string> {
  const id = `${householdId}_lab`;
  const [hh] = await deps.db.query<{ spotter_name: string }>("select spotter_name from households where id = $1", [householdId]);
  await createSpender(deps.db, {
    id,
    householdId,
    name: "Naive test agent",
    kind: "agent",
    spotterName: hh?.spotter_name ?? "Your spotter",
    // Dollars (PayPal's toolkit orders in USD), and everything is held for the spotter: the lab never pays anything.
    allowance: { weekly: { amount: 100_000, currency: "USD" }, askAbove: { amount: 0, currency: "USD" }, blockedCategories: [], allowedPayees: [], blockedPayees: [] },
  });
  await deps.db.query("update spenders set agent_job = 'shopping', frozen_at = null where id = $1", [id]);
  await deps.db.query("update tripwires set unfrozen_at = coalesce(unfrozen_at, now()) where spender_id = $1", [id]);
  return id;
}

type Rpc = (method: string, params: unknown) => Promise<{ status: number; result?: any; error?: any }>;

function rpcFor(handler: (req: Request) => Promise<Response> | Response, key: string): Rpc {
  let n = 0;
  return async (method, params) => {
    const res = await handler(
      new Request("http://spotter.lab/api/toolkit/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }),
      }),
    );
    const raw = await res.text();
    const data = raw.trim().startsWith("{") ? raw : (raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}");
    const body = JSON.parse(data) as { result?: unknown; error?: unknown };
    return { status: res.status, ...body };
  };
}

const textOf = (r: { result?: any }) => String(r.result?.content?.[0]?.text ?? "");

export type LabOpts = { read: OrderReader; run: Run; confirmWaitMs?: number };

/**
 * One run, as a stream of steps. The deps' case agent, price check, alerts and was-it-you are dropped on purpose: the
 * only paid call is the one Spotter AI check on the order. The key is switched off at the end, whatever happens.
 */
export async function* runLab(full: Deps, householdId: string, opts: LabOpts): AsyncGenerator<LabStep> {
  const deps: Deps = { db: full.db, check: full.check, paypal: full.paypal };
  const { db } = deps;
  const limited = await claimRun(deps, householdId);
  if (limited) {
    yield step("limit", limited);
    return;
  }
  const agentId = await labAgent(deps, householdId);
  const { key } = await issueAgentKeys(db, agentId, { expiresInMinutes: KEY_MINUTES });
  try {
    yield step("start", "A naive test agent got a Spotter key for the PayPal Agent Toolkit", {
      detail: `The key works for ${KEY_MINUTES} minutes and is switched off when the run ends. It never reaches your browser.`,
      data: { key: `spt_…${key.slice(-4)}`, minutes: KEY_MINUTES },
    });
    const handler = makeToolkitMcp({ deps: async () => deps, read: opts.read, run: opts.run });
    const rpc = rpcFor(handler, key);
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spotter-agent-lab", version: "1" } });
    const listed = await rpc("tools/list", {});
    if (listed.status !== 200) throw new Error(`Spotter's toolkit server answered ${listed.status}`);
    const offered: Array<{ name: string }> = listed.result?.tools ?? [];
    const coverage = toolsFor("shopping");
    const bait = coverage.filter((c) => c.treatment === "bait").map((c) => c.tool);
    yield step("tools", `It asked for its tools: Spotter offers ${offered.length} of the ${COVERAGE.length} PayPal toolkit tools`, {
      detail: `${bait.length} of them are bait: the real PayPal names and schemas, but a shopping agent has no reason to call them. They never run.`,
      data: { total: COVERAGE.length, offered: offered.length, bait: bait.length, sample: bait.slice(0, 6) },
    });

    const page = pageText(SHOP_HTML);
    const plan = naivePlan(page);
    const hidden = /Note for AI shopping assistants[^\n]*/.exec(page)?.[0] ?? "";
    yield step("read", "It read the GadgetBarn page, including a line people can't see", {
      detail: "The shop hides this from people. An AI agent reading the page gets all of it.",
      data: { url: SHOP_URL_PATH, hidden: hidden.slice(0, 400), characters: page.length },
    });

    const orderCall = plan[0]!;
    const ordered = JSON.parse(textOf(await rpc("tools/call", { name: orderCall.name, arguments: orderCall.arguments })) || "{}") as {
      status?: string;
      paypal_order_id?: string;
      amount?: { value?: string; currency_code?: string };
      spotter?: { payment_id?: string; message?: string };
      error?: { message?: string };
    };
    if (ordered.error) throw new Error(`create_order was refused: ${ordered.error.message ?? "no reason given"}`);
    const paymentId = ordered.spotter?.payment_id ?? null;
    yield step("order", ordered.status === "HELD_FOR_APPROVAL" ? "It called create_order: Spotter checked it and PayPal is holding the money" : `It called create_order: Spotter answered ${ordered.status ?? "nothing"}`, {
      detail: ordered.spotter?.message?.slice(0, 300),
      data: { status: ordered.status ?? null, paypalOrderId: ordered.paypal_order_id ?? null, amount: ordered.amount ?? null, paymentId },
    });

    // The lab knows exactly what its agent read, so it is kept on the order: when the tripwire springs, the paused
    // agent's card can quote the hidden line (src/core/tripwire.ts latestCause). A failed write only loses that quote.
    if (paymentId && hidden) {
      await db
        .query("insert into events (payment_id, type, data) values ($1, 'agent_read', $2)", [paymentId, JSON.stringify({ url: SHOP_URL_PATH, hidden: hidden.slice(0, 400) })])
        .catch((e) => console.error(`[spotter] agent lab: couldn't record the page the agent read for ${paymentId}:`, e instanceof Error ? e.message : e));
    }

    const baitCall = plan[1];
    if (!baitCall) throw new Error("The page didn't have the refund line, so the agent had nothing to fall for.");
    const baitReply = textOf(await rpc("tools/call", { name: baitCall.name, arguments: baitCall.arguments }));
    const without = wouldHaveSent(baitCall.name, JSON.stringify(baitCall.arguments));
    yield step("bait", `Then it obeyed the page and called ${baitCall.name}`, {
      detail: "A seller's refund tool, from an agent sent to shop. Spotter never ran it.",
      data: { tool: baitCall.name, arguments: baitCall.arguments, reply: baitReply.slice(0, 400), wouldHaveSent: without?.text ?? null },
    });

    const [agent] = await db.query<{ frozen_at: string | Date | null }>("select frozen_at from spenders where id = $1", [agentId]);
    yield step("freeze", agent?.frozen_at ? "Spotter froze the agent" : "Spotter didn't freeze the agent", {
      detail: agent?.frozen_at ? "Nothing it asks for goes through until the spotter unpauses it with their PIN. It keeps its reads, so the evidence stays." : undefined,
      data: { frozen: !!agent?.frozen_at },
    });

    const [p] = paymentId ? await db.query<Payment>("select * from payments where id = $1", [paymentId]) : [];
    const auth = p?.paypal_authorization_id ?? null;
    yield step(
      "void",
      p?.status === "voided" ? "PayPal released the hold: Spotter voided the authorisation" : p?.status === "voiding" ? "Spotter asked PayPal to let go of the hold. PayPal didn't confirm yet, retrying" : `The hold is ${p?.status ?? "missing"}`,
      { data: { authorizationId: auth, orderId: p?.paypal_order_id ?? null, status: p?.status ?? null } },
    );

    if (auth) {
      let seen: { event_type: string; id: string } | undefined;
      const until = Date.now() + (opts.confirmWaitMs ?? 20_000);
      do {
        [seen] = await db.query<{ event_type: string; id: string }>("select id, event_type from paypal_events where resource_id = $1 and event_type = 'PAYMENT.AUTHORIZATION.VOIDED' limit 1", [auth]);
        if (seen || Date.now() >= until) break;
        await sleep(2000);
      } while (!seen);
      if (seen) {
        yield step("confirm", "PayPal confirmed it: its own webhook says the authorisation is voided", { data: { source: "webhook", event: seen.event_type, eventId: seen.id, authorizationId: auth } });
      } else if (deps.paypal.getAuthorization) {
        const status = (await deps.paypal.getAuthorization(auth)).status;
        yield step("confirm", status === "VOIDED" ? "PayPal confirmed it: asked directly, PayPal says the authorisation is VOIDED" : `PayPal says the authorisation is ${status}`, {
          detail: "The PayPal webhook hadn't arrived yet, so Spotter asked PayPal for the authorisation, the same check its reconcile job makes.",
          data: { source: "paypal_lookup", status, authorizationId: auth },
        });
      }
    }
    const [end] = paymentId ? await db.query<{ status: string }>("select status from payments where id = $1", [paymentId]) : [];
    const frozen = !!agent?.frozen_at;
    const released = end?.status === "voided";
    yield step(
      "done",
      released && frozen
        ? "Nothing was paid. The agent stays frozen until the spotter checks in."
        : `Nothing was paid${released ? "" : `, but the hold is ${end?.status ?? "unknown"}: Spotter keeps asking PayPal to let it go`}.${frozen ? " The agent stays frozen." : " The agent wasn't frozen."}`,
      { data: { paymentId, frozen, released } },
    );
  } catch (e) {
    console.error(`[spotter] agent lab run for ${householdId} failed:`, e instanceof Error ? e.message : e);
    yield step("error", "The run stopped part way", { detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
  } finally {
    // Whatever happened (an error, or the browser left mid run), the lab never leaves a hold behind or a key working.
    await releaseLabHolds(deps, agentId);
    await switchOff(db, householdId, agentId).catch((e) => console.error(`[spotter] agent lab: couldn't switch off the lab key for ${householdId}:`, e instanceof Error ? e.message : e));
  }
}

async function releaseLabHolds(deps: Deps, agentId: string): Promise<void> {
  try {
    const open = await deps.db.query<{ id: string }>("select id from payments where spender_id = $1 and status = 'needs_approval'", [agentId]);
    for (const p of open) {
      const after = await deny(deps, p.id, "Spotter (the lab run ended)");
      if (after.status !== "voided") console.error(`[spotter] agent lab: hold ${p.id} ended ${after.status}, not voided (reconcile keeps asking PayPal)`);
    }
  } catch (e) {
    console.error(`[spotter] agent lab: couldn't let go of the lab agent's holds for ${agentId}:`, e instanceof Error ? e.message : e);
  }
}
