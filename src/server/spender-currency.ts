// PayPal's Agent Toolkit only makes orders in US dollars, so an AI agent's allowance can be set in dollars.
// The numbers stay as they are; only the currency changes. People and kids stay in pounds.
import type { Db } from "@/db";
import { getSpender } from "@/core/lifecycle";
import { requireSpotter } from "./auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function setAgentCurrency(db: Db, request: Request, spenderId: string): Promise<Response> {
  const s = requireSpotter(request);
  if (s instanceof Response) return s;
  const body = (await request.json().catch(() => null)) as { currency?: unknown } | null;
  const currency = body?.currency;
  if (currency !== "GBP" && currency !== "USD") return json({ error: "Pick pounds or dollars." }, 400);
  const spender = await getSpender(db, spenderId);
  if (!spender || spender.household_id !== s.householdId) return json({ error: "No such person." }, 404);
  if (spender.kind !== "agent") return json({ error: "Only AI agents can pay in dollars." }, 400);
  const a = spender.allowance;
  const allowance = { ...a, weekly: { ...a.weekly, currency }, askAbove: { ...a.askAbove, currency } };
  await db.query("update spenders set allowance = $2 where id = $1", [spenderId, JSON.stringify(allowance)]);
  return json({ ok: true, currency });
}
