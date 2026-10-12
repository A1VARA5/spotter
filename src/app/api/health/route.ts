// Public: is each part of Spotter working right now. Cached a minute, rate limited per address, no secrets.
import { allowHealth, health, healthResponse } from "@/server/health-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return healthResponse(request, health, allowHealth, (r) => r);
}
