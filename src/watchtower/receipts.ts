// Each family's AI receipts, kept on the server next to their chats: one compact row per assistant run
// (src/watchtower/receipt.ts). The page folds them from AG Studio's telemetry and posts them here, so they
// are the family's own record of what the assistant did; the server only checks the shape and keeps 50.
import type { Db } from "@/db";
import { householdFrom } from "@/server/auth";
import { isReceipt, type Receipt } from "./receipt";

export const RECEIPTS_PER_FAMILY = 50;
const MAX_BYTES = 8_000;
const LIST = 20;

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function makeReceiptStore(db: Db, opts: { keep?: number } = {}) {
  const keep = opts.keep ?? RECEIPTS_PER_FAMILY;
  return {
    async post(request: Request): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return json({ error: "Sign in first." }, 401);
      const text = await request.text().catch(() => null);
      if (text === null) return json({ error: "Couldn't read that." }, 400);
      if (Buffer.byteLength(text) > MAX_BYTES) return json({ error: "That receipt is too big." }, 413);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return json({ error: "That wasn't JSON." }, 400);
      }
      if (!isReceipt(value)) return json({ error: "That isn't a receipt." }, 400);
      await db.query(
        `insert into watchtower_receipts (household_id, run_id, data, flagged) values ($1, $2, $3::jsonb, $4)
         on conflict (household_id, run_id) do nothing`,
        [hh, value.runId, JSON.stringify(value), value.flagged],
      );
      // The receipt is kept by now: a failed tidy up is logged, not reported as a failed save.
      try {
        await db.query(
          `delete from watchtower_receipts where household_id = $1 and run_id in (
             select run_id from watchtower_receipts where household_id = $1 order by created_at desc, run_id desc offset $2)`,
          [hh, keep],
        );
      } catch (e) {
        console.error(`[spotter] couldn't trim old receipts for ${hh}:`, e instanceof Error ? e.message : e);
      }
      return json({ ok: true });
    },

    async list(request: Request): Promise<Response> {
      const hh = householdFrom(request);
      if (!hh) return json({ error: "Sign in first." }, 401);
      const rows = await db.query<{ data: Receipt }>(
        "select data from watchtower_receipts where household_id = $1 order by created_at desc, run_id desc limit $2",
        [hh, LIST],
      );
      return json({ receipts: rows.map((r) => r.data) });
    },
  };
}
