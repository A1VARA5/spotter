// The one health instance both public routes share (/api/health and /api/badge): one cache, one rate limit.
import { getDb } from "@/db";
import { primaryKeyOut } from "@/ai/client";
import { token } from "@/paypal/client";
import { anthropicKeyProbe, CACHE_MS, clientIp, createHealth, rateLimiter, type HealthReport } from "./health";

export const health = createHealth(() => ({
  db: getDb,
  env: process.env,
  paypalToken: token,
  claudeKey: anthropicKeyProbe,
  primaryOut: () => primaryKeyOut(),
}));

/** 20 asks a minute per address, per server instance. The answer is cached anyway; this only stops hammering. */
export const allowHealth = rateLimiter({ limit: 20, windowMs: 60_000 });

export async function healthResponse(
  request: Request,
  source: { get(): Promise<HealthReport> },
  allow: (ip: string) => boolean,
  toBody: (r: HealthReport) => unknown,
  log: Pick<Console, "error"> = console,
): Promise<Response> {
  if (!allow(clientIp(request.headers))) {
    return Response.json({ error: "Too many asks. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  try {
    const report = await source.get();
    // Browsers keep it half as long as the server does, so an answer is never much more than a minute old.
    return Response.json(toBody(report), { headers: { "Cache-Control": `public, max-age=${CACHE_MS / 2000}` } });
  } catch (e) {
    log.error(`[spotter] health: the probe run failed (${e instanceof Error ? e.name : typeof e})`);
    return Response.json({ status: "down", error: "The health check itself failed. Try again in a minute." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
