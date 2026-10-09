import { makeLoginHandlers } from "@/paypal/identity";
import { getDeps } from "@/server/deps";

export async function GET() {
  return makeLoginHandlers({ db: (await getDeps()).db }).start();
}
