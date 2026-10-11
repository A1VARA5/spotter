// Calls through PayPal's official Agent Toolkit (@paypal/agent-toolkit, pinned 1.11.0), with Spotter's sandbox app.
// Only the tools the coverage table guards or passes through (src/core/toolkit-coverage.ts) may run, and only after
// Spotter's own checks. A bait tool can never get here: SPOTTER_RUNS refuses anything else, as a second lock.
import { PayPalAPI } from "@paypal/agent-toolkit/mcp";
import { token } from "./client";

/** Every toolkit method Spotter itself may run. Bait and hidden tools are not here, on purpose. */
export const SPOTTER_RUNS = new Set([
  "get_order",
  "create_order",
  "pay_order",
  "create_refund",
  "get_refund",
  "create_shipment_tracking",
  "get_shipment_tracking",
  "show_subscription_plan_details",
  "create_subscription",
  "show_subscription_details",
]);

type ToolkitApi = { run: (m: string, a: unknown) => Promise<string> };
type Context = { sandbox: true; request_id?: string };
export type RunOpts = {
  /** PayPal-Request-Id for a money call (the toolkit sends context.request_id as that header), so a retry is one request. */
  requestId?: string;
  timeoutMs?: number;
};
const TIMEOUT_MS = 15_000;
const realApi = async (context: Context): Promise<ToolkitApi> => new PayPalAPI(await token(), context);

/**
 * The toolkit's own call. sandbox must be set: the toolkit defaults to the live API. Returns the toolkit's JSON string.
 * The toolkit's HTTP client has no timeout (axios timeout 0), so Spotter stops waiting after 15 seconds and throws a
 * plain error. The request may still land at PayPal, which is why money calls carry a requestId.
 */
export async function toolkitRun(method: string, args: Record<string, unknown>, opts: RunOpts = {}, make: (c: Context) => Promise<ToolkitApi> = realApi): Promise<string> {
  if (!SPOTTER_RUNS.has(method)) throw new Error(`Spotter never runs the toolkit's ${method}.`);
  const ms = opts.timeoutMs ?? TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    // The token fetch is inside the race too, so a hung token request is bounded as well.
    make(opts.requestId ? { sandbox: true, request_id: opts.requestId } : { sandbox: true }).then((client) => client.run(method, args)),
    new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`PayPal didn't answer ${method} within ${Math.round(ms / 1000)} seconds.`)), ms))),
  ]).finally(() => clearTimeout(timer));
}

/** The toolkit's own get_order. */
export const toolkitReadOrder = (paypalOrderId: string) => toolkitRun("get_order", { id: paypalOrderId });
