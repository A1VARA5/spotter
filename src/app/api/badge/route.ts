// A shields.io endpoint badge for the README, from the same cached health answer and the same rate limit.
// https://img.shields.io/endpoint?url=https%3A%2F%2Fspotter-pay.vercel.app%2Fapi%2Fbadge
import { allowHealth, health, healthResponse } from "@/server/health-route";
import { badgeFor } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return healthResponse(request, health, allowHealth, badgeFor);
}
