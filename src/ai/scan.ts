// A message with no amount in it yet ("join our VIP group", "you've won") still gets the scam check, so the
// person hears what's wrong with it before anyone asks for money. Nothing is paid or held: there's no payment.
import type { AiCheckResult } from "./check";
import type { PaymentRequest } from "@/core/types";

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
