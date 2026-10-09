import { getDb } from "@/db";
import { makeSetupHandlers } from "@/server/setup";

export const POST = (request: Request) => makeSetupHandlers(getDb).pairingCode(request, null);
