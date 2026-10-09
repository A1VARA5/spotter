import { makeHandlers } from "@/server/payments";
import { getDeps } from "@/server/deps";

const h = makeHandlers(getDeps);
export const POST = (request: Request) => h.submit(request);
export const GET = () => h.list();
