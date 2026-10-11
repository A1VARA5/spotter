// One live sandbox probe: can PayPal reauthorize a CARD funded hold (the kind Spotter makes for agents)?
// Makes a fresh £1.23 card authorisation, asks PayPal to reauthorize it straight away, prints PayPal's exact answer,
// then voids the hold (with a PayPal-Request-Id) and reads it back. Sandbox only, no AI, no cost.
//   npx tsx scripts/paypal-reauth-probe.mts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { createAuthorizeOrder, getAuthorization, PayPalError, reauthorizeAuthorization, voidAuthorization } from "../src/paypal/client";

const id = `probe-reauth-${Date.now()}`;
const hold = await createAuthorizeOrder(
  { id, spenderId: "probe", money: { amount: 123, currency: "GBP" }, payee: { name: "Reauthorize probe", isNew: false }, category: "test", method: "paypal_order", context: "", createdAt: new Date().toISOString() },
  { source: "card", customId: `probe:${id}` },
);
console.log(JSON.stringify({ step: "authorised", at: new Date().toISOString(), order: hold.orderId, authorization: hold.authorizationId, expires: hold.expiresAt }));
if (!hold.authorizationId) throw new Error("PayPal made no authorisation");
try {
  const r = await reauthorizeAuthorization(hold.authorizationId, `reauth-${id}-${hold.authorizationId}`);
  console.log(JSON.stringify({ step: "reauthorize", ok: true, ...r }));
  await voidAuthorization(r.authorizationId, `void-${id}-${r.authorizationId}`);
} catch (e) {
  const p = e instanceof PayPalError ? { status: e.status, issue: e.issue, message: e.message, debugId: e.debugId } : { message: String(e) };
  console.log(JSON.stringify({ step: "reauthorize", ok: false, ...p }));
}
const v = await voidAuthorization(hold.authorizationId, `void-${id}-${hold.authorizationId}`);
console.log(JSON.stringify({ step: "void", ...v }));
console.log(JSON.stringify({ step: "read back", ...(await getAuthorization(hold.authorizationId)) }));
