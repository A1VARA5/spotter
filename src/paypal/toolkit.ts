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

/** The toolkit's own call. sandbox must be set: the toolkit defaults to the live API. Returns the toolkit's JSON string. */
export async function toolkitRun(method: string, args: Record<string, unknown>, api?: { run: (m: string, a: unknown) => Promise<string> }): Promise<string> {
  if (!SPOTTER_RUNS.has(method)) throw new Error(`Spotter never runs the toolkit's ${method}.`);
  const client = api ?? new PayPalAPI(await token(), { sandbox: true });
  return client.run(method, args);
}

/** The toolkit's own get_order. */
export const toolkitReadOrder = (paypalOrderId: string) => toolkitRun("get_order", { id: paypalOrderId });
