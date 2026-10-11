// A message with no amount in it yet ("join our VIP group", "you've won") still gets the scam check, so the
// person hears what's wrong with it before anyone asks for money. Nothing is paid or held: there's no payment.
import type { AiCheckResult } from "./check";
import { formatMoney, type PaymentRequest } from "@/core/types";
import type { Extracted } from "./extract";

/**
 * The check on a message's words when there is nobody's payment to hold (the spotter's own screenshot, the dashboard):
 * what it asks for, and its scam signs. Nothing is paid or held.
 */
export async function checkWordsOnly(
  check: (req: PaymentRequest) => Promise<AiCheckResult>,
  extract: (text: string) => Promise<Extracted>,
  text: string,
): Promise<{ signs: boolean; text: string[] }> {
  let found: Extracted;
  try {
    found = await extract(text);
  } catch (e) {
    console.error("[spotter] reading the ask out of a message failed:", e instanceof Error ? e.message : e);
    found = { ok: false, error: "extract threw" };
  }
  if (!found.ok || !found.found) return scanMessage(check, text);
  const ask = `It asks for ${formatMoney({ amount: found.amountPence, currency: found.currency })} to ${found.payee}.`;
  const req: PaymentRequest = {
    id: "scan",
    spenderId: "",
    money: { amount: found.amountPence, currency: found.currency },
    payee: { name: found.payee, isNew: true },
    category: found.category,
    method: found.method,
    ...(found.item ? { item: found.item } : {}),
    context: text,
    createdAt: new Date().toISOString(),
  };
  let r: AiCheckResult | null = null;
  try {
    r = await check(req);
  } catch (e) {
    console.error("[spotter] check of a message's words failed:", e instanceof Error ? e.message : e);
  }
  if (!r?.ok) return { signs: false, text: [ask, "Spotter couldn't finish its check, so treat it with care: don't pay until you've rung them on a number you already have. Nothing was paid."] };
  const serious = r.flags.filter((f) => f.severity !== "low");
  if (!serious.length) return { signs: false, text: [ask, "Spotter found no clear warning signs. If you're unsure, ring them on a number you already have. Nothing was paid."] };
  return {
    signs: true,
    text: [
      `${ask} It has the signs of a scam.`,
      r.summary,
      ...serious.slice(0, 3).map((f) => (f.quote ? `${f.why} ("${f.quote.slice(0, 120)}")` : f.why)),
      "Don't pay, don't reply and don't click its links. Nothing was paid.",
    ].filter(Boolean),
  };
}

export async function scanMessage(check: (req: PaymentRequest) => Promise<AiCheckResult>, text: string): Promise<{ signs: boolean; text: string[] }> {
  const req: PaymentRequest = {
    id: "scan",
    spenderId: "",
    money: { amount: 0, currency: "GBP" },
    payee: { name: "nobody yet", isNew: true },
    category: "unknown",
    method: "other",
    context: text,
    createdAt: new Date().toISOString(),
  };
  let r: AiCheckResult | null = null;
  try {
    r = await check(req);
  } catch (e) {
    console.error("[spotter] scan failed:", e instanceof Error ? e.message : e);
  }
  const serious = r?.ok ? r.flags.filter((f) => f.severity !== "low") : [];
  if (serious.length) {
    return {
      signs: true,
      text: [
        "No money asked for yet, but this has the signs of a scam.",
        r!.summary,
        ...serious.slice(0, 3).map((f) => (f.quote ? `${f.why} ("${f.quote.slice(0, 120)}")` : f.why)),
        "Don't reply, don't click its links, and don't send anything. Nothing was paid.",
      ].filter(Boolean),
    };
  }
  return {
    signs: false,
    text: r?.ok
      ? ["There's no request for money in this, so nothing was paid.", "Spotter found no clear warning signs either. If someone asks you to pay later, forward that message too."]
      : ["There's no request for money in this, so nothing was paid.", "If someone is asking you to pay, forward the message that has the amount in it."],
  };
}
