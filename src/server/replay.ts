// "Watch Spotter open it": streams KERNEL's video of the cloud browser visit to the household that owns the payment.
// The browser never sees KERNEL's link (it carries a signed token with KERNEL account ids); this server opens the
// sealed link, follows KERNEL's redirect only to its storage on Amazon S3, and relays the mp4, range requests
// included (Safari needs them). Recordings are offered for a day, which is how long KERNEL keeps them on our plan.
import type { Db } from "@/db";
import { getPayment } from "@/core/lifecycle";
import { open } from "@/core/seal";
import { isReplayUrl } from "@/agents/kernel";
import { REPLAY_SEAL } from "@/agents/tools";

export const REPLAY_TTL_MS = 23 * 60 * 60 * 1000;
const MAX_BYTES = 20_000_000;
const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const S3 = /^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//;
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function replayVideo(
  db: Db,
  householdId: string,
  paymentId: string,
  request: Request,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<Response> {
  const p = await getPayment(db, paymentId, householdId);
  const r = p?.case_file?.page?.replay;
  if (!p || !r) return fail(404, "There's no recording for this payment.");
  if ((opts.now ?? Date.now()) - new Date(r.at).getTime() > REPLAY_TTL_MS) return fail(410, "The recording has expired (they're kept for a day).");
  const url = open(REPLAY_SEAL, r.sealed);
  if (!isReplayUrl(url)) return fail(404, "There's no recording for this payment.");

  const get = opts.fetch ?? fetch;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const first = await get(url, { redirect: "manual", signal });
    const to = first.headers.get("location");
    if (first.status < 300 || first.status > 399 || !to || !S3.test(to)) {
      console.error(`[spotter] KERNEL replay for ${paymentId} answered ${first.status} without a storage redirect`);
      return fail(502, "The recording isn't available right now.");
    }
    const range = request.headers.get("range");
    const video = await get(to, { redirect: "error", signal, ...(range && /^bytes=\d*-\d*$/.test(range) ? { headers: { range } } : {}) });
    const size = Number(video.headers.get("content-length") ?? 0);
    if (!video.ok || !video.body || !/^video\/mp4\b/.test(video.headers.get("content-type") ?? "") || size > MAX_BYTES) {
      console.error(`[spotter] KERNEL replay for ${paymentId}: storage answered ${video.status} ${video.headers.get("content-type")} ${size} bytes`);
      return fail(502, "The recording isn't available right now.");
    }
    const headers = new Headers({ "content-type": "video/mp4", "cache-control": "private, max-age=3600", "accept-ranges": "bytes", "x-content-type-options": "nosniff" });
    for (const h of ["content-length", "content-range"]) {
      const v = video.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(video.body, { status: video.status, headers });
  } catch (e) {
    console.error(`[spotter] fetching the KERNEL replay for ${paymentId} failed:`, e instanceof Error ? e.message : e);
    return fail(502, "The recording isn't available right now.");
  }
}
