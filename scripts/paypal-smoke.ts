// Real sandbox check of src/paypal/client.ts: one capture, one void. Run: npx tsx scripts/paypal-smoke.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { captureAuthorization, createAuthorizeOrder, voidAuthorization } from "../src/paypal/client";
import type { PaymentRequest } from "../src/core/types";

const base = (id: string, amount: number): PaymentRequest => ({
  id,
  spenderId: "smoke",
  money: { amount, currency: "GBP" },
  payee: { name: "Smoke Test Shop", isNew: false },
  category: "test",
  method: "paypal_order",
  context: "",
  createdAt: new Date().toISOString(),
});

const run = Date.now();
const a = await createAuthorizeOrder(base(`smoke-a-${run}`, 1250), { source: "card" });
const cap = await captureAuthorization(a.authorizationId!, `capture-smoke-a-${run}`);
console.log("capture:", cap.status);
const b = await createAuthorizeOrder(base(`smoke-b-${run}`, 4000), { source: "card" });
const v = await voidAuthorization(b.authorizationId!);
console.log("void:", v.status);
process.exitCode = cap.status === "COMPLETED" && v.status === "VOIDED" ? 0 : 1;
