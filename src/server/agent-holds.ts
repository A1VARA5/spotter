// The spotter's side of PayPal's toolkit: paused agents (tripwires), refunds a selling agent asked for, subscriptions
// waiting for approval, and the agent's job. Anything that moves money or unpauses an agent needs the PIN every time.
import type { Deps } from "@/core/lifecycle";
import { getSpender } from "@/core/lifecycle";
import { getHousehold } from "@/core/households";
import { isJob } from "@/core/toolkit-coverage";
import { listTripwires, unfreeze } from "@/core/tripwire";
import { decideRefund, listRefunds, recordSale, type Run } from "@/core/selling";
import { decideSubscription, listHeldSubscriptions } from "@/core/subscriptions";
import { randomBytes } from "node:crypto";
import { checkPin, householdFrom, requireSpotter } from "./auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export type CreateSale = (s: { amount: number; currency: string; item: string; ref: string }) => Promise<{ orderId: string; captureId: string }>;

// The example sale: labelled everywhere it shows. £50 trainers, so the overpayment line reads "They paid £50.00".
const EXAMPLE = { amount: 5000, currency: "GBP" as const, item: "Example sale: trainers, size 9" };

export async function holdsFor(db: Deps["db"], householdId: string) {
  const [tripwires, refunds, subscriptions, sales, agents] = await Promise.all([
    listTripwires(db, householdId),
    listRefunds(db, householdId),
    listHeldSubscriptions(db, householdId),
    db.query<{ id: string; item: string; amount: string; currency: string; capture_id: string | null; example: boolean; agent: string | null }>(
      "select sa.id, sa.item, sa.amount, sa.currency, sa.capture_id, sa.example, s.name as agent from sales sa left join spenders s on s.id = sa.spender_id where sa.household_id = $1 order by sa.created_at desc limit 10",
      [householdId],
    ),
    db.query<{ id: string; name: string; agent_job: string; frozen_at: string | null }>("select id, name, agent_job, frozen_at from spenders where household_id = $1 and kind = 'agent' order by created_at", [householdId]),
  ]);
  return {
    tripwires,
    refunds,
    subscriptions,
    sales: sales.map((s) => ({ ...s, amount: Number(s.amount) })),
    agents: agents.map((a) => ({ ...a, frozen_at: a.frozen_at ? new Date(a.frozen_at).toISOString() : null })),
  };
}
export type AgentHolds = Awaited<ReturnType<typeof holdsFor>>;

export function makeAgentHolds(opts: { deps: () => Promise<Deps>; run: Run; createSale: CreateSale }) {
  return {
    async GET(request: Request) {
      const householdId = householdFrom(request);
      if (!householdId) return json({ error: "Sign in first." }, 401);
      return json(await holdsFor((await opts.deps()).db, householdId));
    },

    async POST(request: Request) {
      const s = requireSpotter(request);
      if (s instanceof Response) return s;
      const deps = await opts.deps();
      const { db } = deps;
      const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown; action?: unknown; pin?: unknown; job?: unknown } | null;
      const { kind, id, action, pin } = body ?? {};
      if (typeof id !== "string" || typeof action !== "string") return json({ error: "Something was missing from that request." }, 400);
      const needsPin = action === "approve" || action === "unfreeze";
      if (needsPin) {
        if (typeof pin !== "string" || !pin) return json({ error: "Enter your PIN to do that.", needsPin: true }, 400);
        const ok = await checkPin(db, s.householdId, pin);
        if (ok === "locked") return json({ error: "Too many wrong PINs. Try again in a few minutes." }, 429);
        if (ok === "wrong") return json({ error: "That PIN isn't right.", needsPin: true }, 403);
      }
      const by = (await getHousehold(db, s.householdId))?.spotter_name ?? "spotter";

      if (kind === "refund" && (action === "approve" || action === "deny")) {
        const r = await decideRefund(deps, opts.run, s.householdId, id, action, by);
        return json(r, r.ok ? 200 : 409);
      }
      if (kind === "subscription" && (action === "approve" || action === "deny")) {
        const r = await decideSubscription(db, s.householdId, id, action, by);
        return json(r, r.ok ? 200 : 409);
      }
      const agent = await getSpender(db, id);
      if ((kind === "agent" || kind === "sale") && (!agent || agent.household_id !== s.householdId)) return json({ error: "No such agent." }, 404);
      if (kind === "agent" && action === "unfreeze") {
        return (await unfreeze(db, s.householdId, id)) ? json({ ok: true, message: `${agent!.name} can ask for payments again.` }) : json({ error: "That agent isn't paused." }, 409);
      }
      if (kind === "agent" && action === "job") {
        if (agent!.kind !== "agent") return json({ error: "Only AI agents have a job for the PayPal tools." }, 400);
        if (!isJob(body?.job)) return json({ error: "Pick shopping or selling." }, 400);
        await db.query("update spenders set agent_job = $2 where id = $1", [id, body.job]);
        return json({ ok: true, job: body.job });
      }
      if (kind === "sale" && action === "example") {
        if (agent!.kind !== "agent" || agent!.agent_job !== "selling") return json({ error: "Example sales are for an agent whose job is selling." }, 400);
        const ref = `sale_${randomBytes(8).toString("hex")}`;
        let made;
        try {
          made = await opts.createSale({ ...EXAMPLE, ref });
        } catch (e) {
          console.error("[spotter] example sale failed:", e instanceof Error ? e.message : e);
          return json({ error: "The PayPal sandbox didn't make the example sale. Try again in a minute." }, 502);
        }
        try {
          await recordSale(db, { householdId: s.householdId, spenderId: id, orderId: made.orderId, captureId: made.captureId, ...EXAMPLE, example: true });
        } catch (e) {
          console.error(`[spotter] example sale ${made.orderId} (capture ${made.captureId}) was paid in the sandbox but couldn't be saved:`, e instanceof Error ? e.message : e);
          return json({ error: "PayPal made the example sale, but Spotter couldn't save it. Try again." }, 500);
        }
        return json({ ok: true, captureId: made.captureId, orderId: made.orderId });
      }
      return json({ error: "Spotter doesn't know that action." }, 400);
    },
  };
}
