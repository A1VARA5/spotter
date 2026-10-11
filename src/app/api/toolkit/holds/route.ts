// The spotter's side of PayPal's toolkit: paused agents, held refunds and subscriptions, an agent's job, example sales.
import { getDeps } from "@/server/deps";
import { makeAgentHolds } from "@/server/agent-holds";
import { toolkitRun } from "@/paypal/toolkit";
import { createExampleSale } from "@/paypal/client";

export const maxDuration = 30;

const h = makeAgentHolds({ deps: getDeps, run: (method, args) => toolkitRun(method, args), createSale: createExampleSale });

export const GET = (request: Request) => h.GET(request);
export const POST = (request: Request) => h.POST(request);
