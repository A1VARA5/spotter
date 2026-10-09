// HTTP handlers for payments, with injectable deps so they're testable without PayPal or Claude.
import { z } from "zod";
import {
  approve,
  deny,
  getPayment,
  getSpender,
  InvalidPaymentError,
  listPayments,
  submitPayment,
  type Deps,
} from "@/core/lifecycle";

export const SubmitBody = z.object({
  spenderId: z.string().min(1).max(64),
  amount: z.number().int("amount must be whole pence or cents").positive("amount must be above zero").max(1_000_000),
  currency: z.enum(["GBP", "USD"]),
  payee: z.string().trim().min(1).max(120),
  payeeIsNew: z.boolean().default(true),
  category: z.string().trim().min(1).max(60),
  method: z.enum(["paypal_order", "friends_and_family", "gift_card", "crypto", "bank_transfer", "other"]).default("paypal_order"),
  context: z.string().max(50_000).default(""),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function makeHandlers(getDeps: () => Promise<Deps>) {
  return {
    async submit(request: Request) {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return json({ error: "Body must be JSON." }, 400);
      }
      const parsed = SubmitBody.safeParse(raw);
      if (!parsed.success) {
        return json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
      }
      const b = parsed.data;
      const deps = await getDeps();
      if (!(await getSpender(deps.db, b.spenderId))) return json({ error: "Unknown spender." }, 404);
      try {
        const payment = await submitPayment(deps, {
          spenderId: b.spenderId,
          money: { amount: b.amount, currency: b.currency },
          payee: { name: b.payee, isNew: b.payeeIsNew },
          category: b.category,
          method: b.method,
          context: b.context,
        });
        return json({ payment }, 201);
      } catch (e) {
        if (e instanceof InvalidPaymentError) return json({ error: e.message }, 400);
        throw e;
      }
    },

    async list() {
      const deps = await getDeps();
      return json({ payments: await listPayments(deps.db) });
    },

    async approve(id: string, by: string) {
      return settle(await getDeps(), id, by, approve);
    },

    async deny(id: string, by: string) {
      return settle(await getDeps(), id, by, deny);
    },
  };
}

async function settle(deps: Deps, id: string, by: string, action: typeof approve) {
  const before = await getPayment(deps.db, id);
  if (!before) return json({ error: "No such payment." }, 404);
  if (before.status !== "needs_approval") return json({ error: `Already ${before.status}.`, payment: before }, 409);
  return json({ payment: await action(deps, id, by) });
}
