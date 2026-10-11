// HTTP side of "Was it you?": the answer page's buttons (email links and the demo's example phone) and starting the
// side by side demo. Telegram and Discord answers come through their own signed endpoints.
import { z } from "zod";
import { getHousehold } from "@/core/households";
import { getPayment, type Deps, type Payment } from "@/core/lifecycle";
import { answerWasItYou, findAsk, tokenFor, type Answerer } from "@/core/was-it-you";
import { createWasItYouExample, EXAMPLE_ASKS_PER_DAY } from "./example-hold";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const Body = z.object({ token: z.string().max(80), answer: z.enum(["not_me", "it_was_me"]) });
const STATUS = { invalid: 403, answered: 409, expired: 410 } as const;

/** Answers with a token. An email ask needs only the token; the demo's example ask also needs that family's session. */
export async function answerRequest(deps: Deps, request: Request, householdId: string | null): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const b = Body.safeParse(raw);
  if (!b.success) return json({ error: "Send a token and an answer: not_me or it_was_me." }, 400);
  const found = await findAsk(deps.db, b.data.token);
  const as: Answerer = found?.w.channel === "example" ? (householdId ? { channel: "example", householdId } : { channel: "link" }) : { channel: "link" };
  const r = await answerWasItYou(deps, { token: b.data.token, answer: b.data.answer, as });
  const payment = r.payment ? publicPayment(r.payment) : undefined;
  if (!r.ok) return json({ error: r.reply, reply: r.reply, payment }, STATUS[r.code ?? "invalid"]);
  return json({ reply: r.reply, payment });
}

/** Only what the phones need: never the PayPal ids or the case file. */
function publicPayment(p: Payment) {
  return { id: p.id, status: p.status, amount: p.amount, currency: p.currency, payee: p.request.payee.name, was_it_you: p.was_it_you ?? null };
}

/** Starts the demo for a demo family: a real sandbox hold and an example ask to Tom. */
export async function startExampleAsk(deps: Deps, householdId: string): Promise<{ payment: Payment; token: string } | "not_demo" | "limit" | "unavailable"> {
  const hh = await getHousehold(deps.db, householdId);
  if (!hh?.demo) return "not_demo";
  const [row] = await deps.db.query<{ n: string }>(
    `select count(*)::text as n from payments p join spenders s on s.id = p.spender_id
     where s.household_id = $1 and p.was_it_you->>'channel' = 'example' and p.created_at > now() - interval '1 day'`,
    [householdId],
  );
  if (Number(row?.n ?? 0) >= EXAMPLE_ASKS_PER_DAY) return "limit";
  const made = await createWasItYouExample(deps, householdId);
  if (made === "paypal_unavailable") return "unavailable";
  if (typeof made === "string") throw new Error(`was it you demo can't start: ${made}`);
  const payment = (await getPayment(deps.db, made.paymentId))!;
  return { payment, token: tokenFor(made.wasItYou, payment.id) };
}

export async function startRequest(deps: Deps, householdId: string): Promise<Response> {
  const r = await startExampleAsk(deps, householdId);
  if (r === "not_demo") return json({ error: "This example is for the demo family." }, 403);
  if (r === "limit") return json({ error: `That's ${EXAMPLE_ASKS_PER_DAY} runs today. It resets within 24 hours.` }, 429);
  if (r === "unavailable") return json({ error: "The PayPal sandbox didn't answer in time. Nothing was held. Try again in a moment." }, 503);
  return json({ payment: publicPayment(r.payment), token: r.token, context: r.payment.request.context }, 201);
}
