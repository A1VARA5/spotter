// Setup: name the spotter, choose the PIN, add the people they look out for. Testable without Next.
import { z } from "zod";
import type { Db } from "@/db";
import { getHousehold, newId } from "@/core/households";
import { createSpender, getSpender } from "@/core/lifecycle";
import { PRESETS } from "@/core/presets";
import { createPairingCode, issueAgentToken } from "@/core/pairing";
import { householdFrom, isUnlocked, InvalidPinError, setPin, unlockCookie } from "./auth";

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });
const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join(" ");

const NameBody = z.object({ spotterName: z.string().trim().min(1, "Enter a name.").max(40, "Keep it under 40 characters.") });
const PinBody = z.object({ pin: z.string().trim(), confirm: z.string().trim() });
const SpenderBody = z
  .object({
    name: z.string().trim().min(1, "Enter their name.").max(40, "Keep it under 40 characters."),
    preset: z.enum(["relative", "kid", "agent"], { message: "Pick who they are." }),
    weeklyPence: z.number().int().positive().max(1_000_000).optional(),
    askAbovePence: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .refine((b) => b.weeklyPence === undefined || b.askAbovePence === undefined || b.askAbovePence <= b.weeklyPence, {
    message: "The ask me amount can't be more than the weekly limit.",
  });

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data : json({ error: issues(parsed.error) }, 400);
}

export function makeSetupHandlers(getDb: () => Promise<Db>) {
  /** Signed in; and unlocked unless the household has no PIN yet (first run). */
  async function session(request: Request, needUnlock: "always" | "after_pin" | "never") {
    const householdId = householdFrom(request);
    if (!householdId) return json({ error: "Sign in first." }, 401);
    const db = await getDb();
    const hh = await getHousehold(db, householdId);
    if (!hh) return json({ error: "Sign in first." }, 401);
    const mustUnlock = needUnlock === "always" || (needUnlock === "after_pin" && hh.pin_hash !== null);
    if (mustUnlock && !isUnlocked(request, householdId)) return json({ error: "Enter your PIN to do that.", locked: true }, 401);
    return { db, hh };
  }

  return {
    async name(request: Request) {
      const s = await session(request, "after_pin");
      if (s instanceof Response) return s;
      const b = await body(request, NameBody);
      if (b instanceof Response) return b;
      await s.db.query("update households set spotter_name = $2, name = $3 where id = $1", [s.hh.id, b.spotterName, `${b.spotterName}'s household`]);
      await s.db.query("update spenders set spotter_name = $2 where household_id = $1", [s.hh.id, b.spotterName]);
      return json({ ok: true });
    },

    async pin(request: Request) {
      const s = await session(request, "never"); // only ever sets a first PIN; changing it is a separate, unlocked action

      if (s instanceof Response) return s;
      if (s.hh.pin_hash) return json({ error: "Your PIN is already set." }, 409);
      const b = await body(request, PinBody);
      if (b instanceof Response) return b;
      if (b.pin !== b.confirm) return json({ error: "The two PINs don't match. Type the same digits twice." }, 400);
      try {
        await setPin(s.db, s.hh.id, b.pin);
      } catch (e) {
        if (e instanceof InvalidPinError) return json({ error: "Use 4 to 8 digits." }, 400);
        throw e;
      }
      return json({ ok: true }, 200, { "set-cookie": unlockCookie(s.hh.id) });
    },

    async addSpender(request: Request) {
      const s = await session(request, "always");
      if (s instanceof Response) return s;
      const b = await body(request, SpenderBody);
      if (b instanceof Response) return b;
      const preset = PRESETS[b.preset];
      const allowance = {
        ...preset.allowance,
        weekly: { ...preset.allowance.weekly, amount: b.weeklyPence ?? preset.allowance.weekly.amount },
        askAbove: { ...preset.allowance.askAbove, amount: b.askAbovePence ?? preset.allowance.askAbove.amount },
      };
      if (allowance.askAbove.amount > allowance.weekly.amount) return json({ error: "The ask me amount can't be more than the weekly limit." }, 400);
      const id = newId("sp");
      await createSpender(s.db, { id, householdId: s.hh.id, name: b.name, kind: preset.kind, spotterName: s.hh.spotter_name, allowance });
      return json({ spender: await getSpender(s.db, id) }, 201);
    },

    async removeSpender(request: Request, id: string) {
      const s = await session(request, "always");
      if (s instanceof Response) return s;
      const rows = await s.db.query("delete from spenders where id = $1 and household_id = $2 returning id", [id, s.hh.id]);
      return rows.length ? json({ ok: true }) : json({ error: "No such person." }, 404);
    },

    async agentToken(request: Request, spenderId: string) {
      const s = await session(request, "always");
      if (s instanceof Response) return s;
      const spender = await getSpender(s.db, spenderId);
      if (!spender || spender.household_id !== s.hh.id) return json({ error: "No such person." }, 404);
      if (spender.kind !== "agent") return json({ error: "Only AI agents get a token." }, 400);
      return json({ token: await issueAgentToken(s.db, spenderId) }, 201);
    },

    /** spenderId null makes a code that pairs the spotter themselves (for alerts). */
    async pairingCode(request: Request, spenderId: string | null) {
      const s = await session(request, "always");
      if (s instanceof Response) return s;
      const b = await body(request, z.object({ channel: z.enum(["email", "telegram"], { message: "Pick email or Telegram." }) }));
      if (b instanceof Response) return b;
      if (spenderId) {
        const spender = await getSpender(s.db, spenderId);
        if (!spender || spender.household_id !== s.hh.id) return json({ error: "No such person." }, 404);
      }
      return json({ code: await createPairingCode(s.db, { householdId: s.hh.id, spenderId, channel: b.channel }) }, 201);
    },
  };
}
