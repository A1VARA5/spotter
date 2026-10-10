// Spotter's MCP server: AI agents pay through Spotter instead of calling PayPal directly.
// Each agent has its own bearer token (issued on its page in Spotter). Agents can ask and check; only the human spotter approves.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { getDeps } from "@/server/deps";
import { agentAllowance, agentFindProducts, agentPaymentStatus, agentRequestPayment } from "@/server/agent";
import { verifyAgentToken } from "@/core/pairing";
import { searchProducts } from "@/market/channel3";

export const maxDuration = 120;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** The agent this call is for, from the verified token. withMcpAuth guarantees it is present. */
function agentOf(ctx: { http?: { authInfo?: { extra?: Record<string, unknown> } } }): string {
  const id = ctx.http?.authInfo?.extra?.spenderId;
  if (typeof id !== "string") throw new Error("Missing agent identity.");
  return id;
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "request_payment",
      {
        title: "Request a payment through Spotter",
        description:
          "Ask to pay for something on the user's behalf. Spotter checks it against the user's rules and for scams, " +
          "then pays, holds it for the user's spotter to approve, or refuses. Always pass the full text of the page " +
          "you are buying from in page_text, exactly as you saw it. Never try to pay another way if Spotter refuses. " +
          "The one exception: if Spotter stops a payment and suggests a safer option (a real retailer, with an offer_id), you may order that instead.",
        inputSchema: z.object({
          item: z.string().max(200).optional().describe("The product name, e.g. 'noise cancelling wireless earbuds'. Lets Spotter check the price against real shops"),
          amount_pence: z.number().int().positive().describe("Total in pence (or cents), e.g. 2499 for £24.99"),
          currency: z.enum(["GBP", "USD"]),
          payee: z.string().min(1).max(120).describe("Shop or person being paid"),
          category: z.string().min(1).max(60).describe("e.g. gifts, groceries, electronics"),
          what_for: z.string().min(1).max(500).describe("What the user asked you to buy, in one sentence"),
          page_text: z.string().max(50_000).describe("The full text of the page or message you are paying from, verbatim"),
          offer_id: z
            .string()
            .max(64)
            .optional()
            .describe("Only when Spotter stopped a payment and suggested a safer option: its offer_id, with that option's payee, amount and item"),
        }),
      },
      async (input, ctx) => {
        const r = await agentRequestPayment(await getDeps(), agentOf(ctx), input);
        const safer = r.safer_option ? `\nsafer_option: ${JSON.stringify(r.safer_option)}` : "";
        return text(`${r.message}${r.payment_id ? ` (payment_id: ${r.payment_id})` : ""}${safer}`);
      },
    );

    server.registerTool(
      "find_products",
      {
        title: "Find real products",
        description:
          "Search real products from real retailers (powered by Channel3) with current prices and shops. Use this before buying " +
          "so you pick a known shop at a fair price.",
        inputSchema: z.object({
          query: z.string().min(2).max(200),
          currency: z.enum(["GBP", "USD"]).default("GBP"),
        }),
      },
      async ({ query, currency }) =>
        text((await agentFindProducts((q, c, l) => searchProducts(q, c, l), query, currency)).message),
    );

    server.registerTool(
      "payment_status",
      {
        title: "Check a payment",
        description: "Check whether a payment you requested was paid, is still waiting for the user's spotter, or was refused.",
        inputSchema: z.object({ payment_id: z.string().min(1).max(64) }),
      },
      async ({ payment_id }, ctx) => text((await agentPaymentStatus(await getDeps(), agentOf(ctx), payment_id)).message),
    );

    server.registerTool(
      "my_allowance",
      {
        title: "Check my allowance",
        description: "See how much you can still spend this week, what needs the spotter's approval and what is never allowed.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => text((await agentAllowance(await getDeps(), agentOf(ctx))).message),
    );
  },
  { serverInfo: { name: "spotter", version: "0.1.0" } },
);

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    const agent = await verifyAgentToken((await getDeps()).db, bearer);
    return agent ? { token: bearer!, clientId: "spotter-agent", scopes: ["payments:request"], extra: { spenderId: agent.spenderId } } : undefined;
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
