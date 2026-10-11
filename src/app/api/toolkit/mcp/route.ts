// PayPal's Agent Toolkit tools, with a spotter in the middle. Point an agent built for PayPal's toolkit here.
import { getDeps } from "@/server/deps";
import { makeToolkitMcp } from "@/server/toolkit-mcp";
import { toolkitReadOrder, toolkitRun } from "@/paypal/toolkit";

export const maxDuration = 120;

const handler = makeToolkitMcp({ deps: getDeps, read: toolkitReadOrder, run: (method, args) => toolkitRun(method, args) });

export { handler as GET, handler as POST, handler as DELETE };
