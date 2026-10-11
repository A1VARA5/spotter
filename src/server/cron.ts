// Vercel calls this once a day, at 9am UK time in winter (vercel.json). Each job runs on its own, so one failing
// never stops or hides the others; any failure answers 500 for monitoring:
// - settled: payments left half captured when a PayPal webhook never arrived (webhooks settle them in seconds normally)
// - renewed: sleeping holds past PayPal's 3 day honor period get their one reauthorization (core/sleep.ts)
// - askedAgain: payments someone chose to sleep on are asked about again (core/sleep.ts)
// - watches: price watches are polled (core/watch.ts), so drops are found even without Channel3's webhook
// Vercel sends "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type Result = number | Record<string, number>;
export type Jobs = Record<string, () => Promise<Result>>;

export async function handleDaily(request: Request, secret: string | undefined, jobs: Jobs): Promise<Response> {
  if (!secret) {
    console.error("[spotter] CRON_SECRET is not set, so the daily jobs can't run");
    return Response.json({ error: "Not configured." }, { status: 503 });
  }
  if (!same(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "No." }, { status: 401 });
  const done: Record<string, Result | { error: string }> = {};
  const failed: string[] = [];
  for (const [name, run] of Object.entries(jobs)) {
    try {
      done[name] = await run();
    } catch (e) {
      failed.push(name);
      done[name] = { error: `${name} failed.` };
      console.error(`[spotter] daily ${name} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.info(`[spotter] daily jobs: ${JSON.stringify(done)}`);
  return failed.length ? Response.json({ ...done, error: `Failed: ${failed.join(", ")}.` }, { status: 500 }) : Response.json(done);
}
