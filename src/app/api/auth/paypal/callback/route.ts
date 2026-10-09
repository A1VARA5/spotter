import { makeLoginHandlers } from "@/paypal/identity";
import { getDeps } from "@/server/deps";

export async function GET(request: Request) {
  return makeLoginHandlers({ db: (await getDeps()).db }).callback(request);
}
