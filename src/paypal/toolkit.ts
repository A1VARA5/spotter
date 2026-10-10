// Read only calls through PayPal's official Agent Toolkit (@paypal/agent-toolkit, pinned 1.11.0), with Spotter's
// sandbox app. Only get_order is used, and only for orders Spotter already matched to the asking agent.
import { PayPalAPI } from "@paypal/agent-toolkit/mcp";
import { token } from "./client";

/** The toolkit's own get_order. sandbox must be set: the toolkit defaults to the live API. */
export async function toolkitReadOrder(paypalOrderId: string): Promise<string> {
  const api = new PayPalAPI(await token(), { sandbox: true });
  return api.run("get_order", { id: paypalOrderId });
}
