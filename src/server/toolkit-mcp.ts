// The guarded PayPal Agent Toolkit as an MCP server. Same tool names and argument shapes as PayPal's toolkit
// (v1.11.0), so an agent built for it can point here instead. Bearer per agent keys, same as /api/mcp.
// There is no approve, capture or refund tool: only the human spotter can let money go.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import type { Deps } from "@/core/lifecycle";
import { verifyAgentToken } from "@/core/pairing";
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
});

export function makeToolkitMcp(opts: { deps: () => Promise<Deps>; read: OrderReader }) {
  const handler = createMcpHandler(
    (server) => {
      server.registerTool(
        "create_order",
        {
          title: "Create Order (through Spotter)",
          description:
            "Create an order in PayPal. This goes through Spotter first: it checks the order against the user's rules and for " +
            "scams, then pays it, holds it for the user's spotter to approve, or refuses. Pass payee and page_text when you can.",
          inputSchema: createOrderInput,
        },
        async (input, ctx) => text(await toolkitCreateOrder(await opts.deps(), agentOf(ctx), input as ToolkitOrderInput)),
      );
      server.registerTool(
        "get_order",
        {
          title: "Get Order",
          description: "Retrieves the order details from PayPal for a given order ID, with Spotter's decision on top. Only your own orders.",
          inputSchema: z.object({ id: ORDER_ID }),
        },
        async ({ id }, ctx) => text(await toolkitGetOrder(await opts.deps(), agentOf(ctx), id, opts.read)),
      );
      server.registerTool(
        "pay_order",
        {
          title: "Process payment for an authorized order (Spotter decides)",
          description:
            "Ask to pay an order you created. Spotter never lets an agent capture a payment: this tells you whether Spotter paid it, " +
            "is holding it for the user's spotter, or refused it.",
          inputSchema: z.object({ id: ORDER_ID }),
        },
        async ({ id }, ctx) => text(await toolkitPayOrder(await opts.deps(), agentOf(ctx), id)),
      );
    },
    { serverInfo: { name: "spotter-paypal-toolkit", version: "0.1.0" } },
  );

  return withMcpAuth(
    handler,
    async (_req, bearer) => {
      const agent = await verifyAgentToken((await opts.deps()).db, bearer);
      return agent ? { token: bearer!, clientId: "spotter-agent", scopes: ["payments:request"], extra: { spenderId: agent.spenderId } } : undefined;
    },
    { required: true },
  );
}
