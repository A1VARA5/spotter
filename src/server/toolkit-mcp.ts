// The guarded PayPal Agent Toolkit as an MCP server. Same tool names and argument shapes as PayPal's toolkit
// (v1.11.0), so an agent built for it can point here instead. Bearer per agent keys, same as /api/mcp.
// Which tools an agent is offered, and how each is handled, comes from one table (src/core/toolkit-coverage.ts) and
// the agent's job (shopping or selling): guarded, passed through (scoped to this family), or bait (tripwire tools that
// never run). Hidden tools aren't offered. There is no approve tool: only the human spotter can let money go.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { getSpender, type Deps } from "@/core/lifecycle";
import { verifyAgentToken } from "@/core/pairing";
import { agentAuthInfo, guardAgentRoute, keyLabelOf, logged } from "./agent-guard";
import type { LIMITS } from "@/core/agent-keys";
import { isJob, toolsFor, type Job } from "@/core/toolkit-coverage";
import { springTripwire } from "@/core/tripwire";
import { guardShipment, requestRefund, scopedGetRefund, scopedGetTracking, sellCreateOrder, sellGetOrder, sellPayOrder, type RefundArgs, type Run, type ShipmentArgs } from "@/core/selling";
import { holdSubscription, scopedShowSubscription, type SubscriptionArgs } from "@/core/subscriptions";
import { toolkitCreateOrder, toolkitGetOrder, toolkitPayOrder, type OrderReader, type ToolkitOrderInput } from "./toolkit-guard";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function agentOf(ctx: { http?: { authInfo?: { extra?: Record<string, unknown> } } }): string {
  const id = ctx.http?.authInfo?.extra?.spenderId;
  if (typeof id !== "string") throw new Error("Missing agent identity.");
  return id;
}

// Mirrors createOrderParameters / getOrderParameters / captureOrderParameters in the toolkit's shared/parameters.ts.
const ORDER_ID = z.string().regex(/^[A-Z0-9]{17,32}$/, "Invalid PayPal Order ID").describe("The order id generated during create call");
const lineItem = z.object({
  name: z.string().max(127).describe("The name of the item."),
  quantity: z.number().default(1).describe("The item quantity. Must be a whole number."),
  description: z.string().max(500).optional().describe("The detailed item description."),
  itemCost: z.number().describe("The cost of each item - upto 2 decimal points."),
  taxPercent: z.number().default(0).describe("The tax percent for the specific item."),
  itemTotal: z.number().describe("The total cost of this line item."),
});
const createOrderInput = z.object({
  currencyCode: z.enum(["USD", "GBP"]).describe("Currency code of the amount. The agent's Spotter allowance currency."),
  items: z.array(lineItem).min(1).max(50),
  discount: z.number().default(0).optional().describe("The discount amount for the order."),
  shippingCost: z.number().default(0).optional().describe("The cost of shipping for the order."),
  shippingAddress: z.record(z.string(), z.unknown()).nullable().optional().describe("The shipping address for the order."),
  notes: z.string().max(2000).nullable().optional(),
  returnUrl: z.string().max(2000).optional(),
  cancelUrl: z.string().max(2000).optional(),
  payee: z.string().max(120).optional().describe("Spotter extra: the shop or person being paid. Without it the order always waits for the spotter."),
  category: z.string().max(60).optional().describe("Spotter extra: e.g. electronics, groceries, gifts."),
  page_text: z.string().max(50_000).optional().describe("Spotter extra: the full text of the page you are buying from, verbatim."),
  offer_id: z
    .string()
    .max(64)
    .optional()
    .describe("Spotter extra: only when Spotter stopped an order and returned a safer_option. Its offer_id, with that option's payee, item and price."),
});

// PayPal's own definitions, read from the installed toolkit: bait and passed through tools are offered exactly as PayPal wrote them.
const EVERYTHING = new Proxy({}, { get: () => new Proxy({}, { get: () => true }) }) as never;
const OFFICIAL = new Map(
  new PayPalMCPToolkit({ accessToken: "unused-spotter-reads-definitions-only", configuration: { actions: EVERYTHING, context: { sandbox: true } } }).getTools().map((t) => [t.method, t]),
);

type Extra = { json: Record<string, unknown>; check: (v: unknown) => boolean };
const PAYEE_EXTRA: Record<string, Extra> = {
  payee: { json: { type: "string", maxLength: 120, description: "Spotter extra: who this subscription pays, when it isn't the plan's name." }, check: (v) => typeof v === "string" && v.length <= 120 },
};

/**
 * A Standard Schema (what the MCP server takes) built from the toolkit's own zod definition. tools/list shows PayPal's
 * JSON Schema. "official" validates with PayPal's own rules; "anything" accepts any arguments (bait: a hijacked agent
 * sending junk is still caught).
 */
function officialSchema(method: string, mode: "official" | "anything", extras: Record<string, Extra> = {}) {
  const tool = OFFICIAL.get(method);
  if (!tool) throw new Error(`PayPal's toolkit has no ${method}`);
  const { $schema: _s, ...json } = (zodToJsonSchema as (s: unknown) => Record<string, any>)(tool.parameters);
  void _s;
  for (const [k, e] of Object.entries(extras)) json.properties = { ...(json.properties ?? {}), [k]: e.json };
  return {
    "~standard": {
      version: 1 as const,
      vendor: "spotter-paypal-toolkit",
      validate: (value: unknown) => {
        const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
        if (mode === "anything") return { value: v };
        const own: Record<string, unknown> = {};
        const rest: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) (k in extras ? own : rest)[k] = x;
        for (const [k, x] of Object.entries(own)) if (!extras[k]!.check(x)) return { issues: [{ message: `${k} isn't valid`, path: [k] }] };
        const parsed = tool.parameters.safeParse(rest);
        if (!parsed.success) return { issues: parsed.error.issues.map((i) => ({ message: i.message, path: i.path })) };
        return { value: { ...(parsed.data as Record<string, unknown>), ...own } };
      },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

type Handler = (args: any, agentId: string, keyLabel?: string) => Promise<string>;
type Tools = Record<string, { schema: unknown; title?: string; description?: string; handle: Handler }>;

function toolSet(job: Job, deps: () => Promise<Deps>, read: OrderReader, run: Run): Tools {
  const d = deps;
  const shared: Tools = {
    create_subscription: {
      schema: officialSchema("create_subscription", "official", PAYEE_EXTRA),
      description:
        `${OFFICIAL.get("create_subscription")!.description.trim()}\n\nThrough Spotter: the subscription stays waiting for approval at PayPal, ` +
        "Spotter shows the user's spotter the whole cost first, and only the spotter gets the approval link.",
      handle: async (a, id) => holdSubscription(await d(), run, id, a as SubscriptionArgs),
    },
    show_subscription_plan_details: { schema: officialSchema("show_subscription_plan_details", "official"), handle: async (a) => run("show_subscription_plan_details", a) },
    show_subscription_details: { schema: officialSchema("show_subscription_details", "official"), handle: async (a, id) => scopedShowSubscription(await d(), run, id, String(a.subscription_id)) },
  };
  if (job === "selling") {
    return {
      ...shared,
      create_order: { schema: createOrderInput, title: "Create Order (a sale, through Spotter)", description: "Create an order in PayPal for a buyer to pay this family. Spotter records it as the family's sale. Orders are in USD.", handle: async (a, id) => sellCreateOrder(await d(), run, id, a as ToolkitOrderInput) },
      get_order: { schema: z.object({ id: ORDER_ID }), title: "Get Order", description: "Retrieves one of this family's sales from PayPal.", handle: async (a, id) => sellGetOrder(await d(), run, id, a.id) },
      pay_order: { schema: z.object({ id: ORDER_ID }), title: "Process payment for an authorized order", description: "Takes the buyer's approved payment for one of this family's sales.", handle: async (a, id) => sellPayOrder(await d(), run, id, a.id) },
      create_refund: {
        schema: officialSchema("create_refund", "official"),
        description: `${OFFICIAL.get("create_refund")!.description.trim()}\n\nThrough Spotter: nothing is refunded straight away. It waits for the user's spotter, goes back to the original payment only, and can't be more than the buyer paid.`,
        handle: async (a, id) => requestRefund(await d(), run, id, a as RefundArgs),
      },
      get_refund: { schema: officialSchema("get_refund", "official"), handle: async (a, id) => scopedGetRefund(await d(), run, id, String(a.refund_id)) },
      create_shipment_tracking: {
        schema: officialSchema("create_shipment_tracking", "official"),
        description: `${OFFICIAL.get("create_shipment_tracking")!.description.trim()}\n\nThrough Spotter: refused until PayPal shows a completed payment for that sale.`,
        handle: async (a, id) => guardShipment(await d(), run, id, a as ShipmentArgs),
      },
      get_shipment_tracking: { schema: officialSchema("get_shipment_tracking", "official"), handle: async (a, id) => scopedGetTracking(await d(), run, id, a) },
    };
  }
  return {
    ...shared,
    create_order: {
      schema: createOrderInput,
      title: "Create Order (through Spotter)",
      description:
        "Create an order in PayPal. This goes through Spotter first: it checks the order against the user's rules and for " +
        "scams, then pays it, holds it for the user's spotter to approve, or refuses. Pass payee and page_text when you can. " +
        "If Spotter refuses an order and returns a safer_option (the same item at a real retailer), you may order that instead with its offer_id.",
      handle: async (a, id, key) => toolkitCreateOrder(await d(), id, a as ToolkitOrderInput, key),
    },
    get_order: {
      schema: z.object({ id: ORDER_ID }),
      title: "Get Order",
      description: "Retrieves the order details from PayPal for a given order ID, with Spotter's decision on top. Only your own orders.",
      handle: async (a, id) => toolkitGetOrder(await d(), id, a.id, read),
    },
    pay_order: {
      schema: z.object({ id: ORDER_ID }),
      title: "Process payment for an authorized order (Spotter decides)",
      description:
        "Ask to pay an order you created. Spotter never lets an agent capture a payment: this tells you whether Spotter paid it, " +
        "is holding it for the user's spotter, or refused it.",
      handle: async (a, id) => toolkitPayOrder(await d(), id, a.id),
    },
  };
}

function handlerFor(job: Job, opts: { deps: () => Promise<Deps>; read: OrderReader; run: Run }) {
  const real = toolSet(job, opts.deps, opts.read, opts.run);
  return createMcpHandler(
    (server) => {
      for (const c of toolsFor(job)) {
        const official = OFFICIAL.get(c.tool)!;
        if (c.treatment === "bait") {
          // A tripwire: PayPal's own name, description and schema. It never runs and never reaches PayPal.
          (server.registerTool as any)(
            c.tool,
            { title: official.name, description: official.description.trim(), inputSchema: officialSchema(c.tool, "anything") },
            async (args: unknown, ctx: Parameters<typeof agentOf>[0]) => {
              const deps = await opts.deps();
              return text(await logged(deps.db, ctx, c.tool, args, async () => (await springTripwire(deps, agentOf(ctx), c.tool, args)).reply, () => "tripwire"));
            },
          );
          continue;
        }
        const t = real[c.tool];
        if (!t) throw new Error(`The coverage table says ${c.tool} is ${c.treatment} for a ${job} agent, but Spotter has no handler for it.`);
        (server.registerTool as any)(
          c.tool,
          { title: t.title ?? official.name, description: t.description ?? official.description.trim(), inputSchema: t.schema },
          async (args: unknown, ctx: Parameters<typeof agentOf>[0]) => text(await logged((await opts.deps()).db, ctx, c.tool, args, () => t.handle(args, agentOf(ctx), keyLabelOf(ctx)))),
        );
      }
    },
    { serverInfo: { name: "spotter-paypal-toolkit", version: "0.2.0" } },
  );
}

export function makeToolkitMcp(opts: { deps: () => Promise<Deps>; read: OrderReader; run: Run; limits?: typeof LIMITS }) {
  const auth = async (_req: Request, bearer?: string) => agentAuthInfo((await opts.deps()).db, bearer);
  const byJob = {
    shopping: withMcpAuth(handlerFor("shopping", opts), auth, { required: true }),
    selling: withMcpAuth(handlerFor("selling", opts), auth, { required: true }),
  };
  // The agent's job picks which set of tools it is offered. An unknown key falls to the shopping set, whose auth answers 401.
  return guardAgentRoute(opts.deps, async (req: Request) => {
    const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const { db } = await opts.deps();
    const agent = await verifyAgentToken(db, bearer);
    const job = agent ? (await getSpender(db, agent.spenderId))?.agent_job : undefined;
    return byJob[isJob(job) ? job : "shopping"](req);
  }, opts.limits);
}
