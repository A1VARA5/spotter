// Spotter's MCP server: AI agents pay through Spotter instead of calling PayPal directly.
// Bearer token required (SPOTTER_AGENT_TOKEN). Agents can ask and check; only the human spotter approves.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { getDeps } from "@/server/deps";
import { agentAllowance, agentPaymentStatus, agentRequestPayment, verifyAgentToken } from "@/server/agent";

export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "request_payment",
      {
        title: "Request a payment through Spotter",
        description:
          "Ask to pay for something on the user's behalf. Spotter checks it against the user's rules and for scams, " +
          "then pays, holds it for the user's spotter to approve, or refuses. Always pass the full text of the page " +
          "you are buying from in page_text, exactly as you saw it. Never try to pay another way if Spotter refuses.",
        inputSchema: z.object({
          amount_pence: z.number().int().positive().describe("Total in pence (or cents), e.g. 2499 for £24.99"),
          currency: z.enum(["GBP", "USD"]),
          payee: z.string().min(1).max(120).describe("Shop or person being paid"),
          category: z.string().min(1).max(60).describe("e.g. gifts, groceries, electronics"),
          what_for: z.string().min(1).max(500).describe("What the user asked you to buy, in one sentence"),
          page_text: z.string().max(50_000).describe("The full text of the page or message you are paying from, verbatim"),
        }),
      },
      async (input) => {
        const r = await agentRequestPayment(await getDeps(), input);
        return text(`${r.message}${r.payment_id ? ` (payment_id: ${r.payment_id})` : ""}`);
      },
    );

    server.registerTool(
      "payment_status",
      {
        title: "Check a payment",
        description: "Check whether a payment you requested was paid, is still waiting for the user's spotter, or was refused.",
        inputSchema: z.object({ payment_id: z.string().min(1).max(64) }),
      },
      async ({ payment_id }) => text((await agentPaymentStatus(await getDeps(), payment_id)).message),
    );

    server.registerTool(
      "my_allowance",
      {
        title: "Check my allowance",
        description: "See how much you can still spend this week, what needs the spotter's approval and what is never allowed.",
        inputSchema: z.object({}),
      },
      async () => text((await agentAllowance(await getDeps())).message),
    );
  },
  { serverInfo: { name: "spotter", version: "0.1.0" } },
);

const authed = withMcpAuth(handler, (_req, bearer) => verifyAgentToken(bearer), { required: true });

export { authed as GET, authed as POST, authed as DELETE };
