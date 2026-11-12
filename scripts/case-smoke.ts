// Runs the real case agent (Claude + Channel3 + link checks) on two held payments in a throwaway database.
// PayPal is faked, so no sandbox calls. Costs a few pence of Claude per case.
// npx tsx --env-file=.env.local scripts/case-smoke.ts
import { pgliteDb } from "../src/db";
import { createHousehold } from "../src/core/households";
import { createSpender, submitPayment, type Deps } from "../src/core/lifecycle";
import { fileReport } from "../src/core/network";
import { aiCheck } from "../src/ai/check";
import { buildCase } from "../src/agents/case";
import { searchProducts } from "../src/market/channel3";

const gbp = (amount: number) => ({ amount, currency: "GBP" as const });

async function main() {
  const db = await pgliteDb();
  const deps: Deps = {
    db,
    check: (req) => aiCheck(req),
    paypal: {
      createAuthorizeOrder: async () => ({ orderId: "O-SMOKE", authorizationId: "A-SMOKE", expiresAt: "2026-11-08T00:00:00Z" }),
      captureAuthorization: async () => ({ captureId: "C", status: "COMPLETED" }),
      voidAuthorization: async () => ({ status: "VOIDED" }),
    },
  };
  const hh = (await createHousehold(db, { name: "Smoke", spotterName: "Aivaras" })).id;
  const other = (await createHousehold(db, { name: "Other", spotterName: "Sam" })).id;
  await createSpender(db, { id: "gran", householdId: hh, name: "Gran", kind: "person", spotterName: "Aivaras",
    allowance: { weekly: gbp(30000), askAbove: gbp(5000), blockedCategories: ["gift_cards", "crypto"], allowedPayees: [], blockedPayees: [] } });
  await fileReport(db, { householdId: other, identifier: "jamie.k1994@mail.example", kind: "denied" });

  const cases = [
    {
      money: gbp(25000), payee: { name: "jamie.k1994@mail.example", isNew: true }, category: "family", method: "paypal_order" as const,
      context: "Hi mum its me, I've smashed my phone this is my new number. Can you send £250 to my mate Jamie's PayPal jamie.k1994@mail.example? The bill has to be paid today, can't get into my banking x",
    },
    {
      money: gbp(2499), payee: { name: "BargainPods", isNew: true }, category: "electronics", method: "paypal_order" as const,
      item: "Apple AirPods Pro 3",
      context: "FLASH SALE Apple AirPods Pro 3 now only £24.99! Ends tonight. Order at https://bargainpods-outlet.shop/airpods-pro-3",
    },
  ];
  const only = process.argv[2];
  for (const c of only ? cases.filter((x) => x.payee.name === only) : cases) {
    const p = await submitPayment(deps, { spenderId: "gran", ...c });
    console.log(`\n=== ${c.payee.name}: ${p.status}`);
    const result = await buildCase(
      { db, householdId: hh, payment: p, search: searchProducts, getAuthorization: async () => ({ status: "CREATED", expiresAt: "2026-11-08T00:00:00Z" }), offers: new Map() },
      { who: { name: "Gran", kind: "person" } },
    );
    console.log(JSON.stringify({ ...result, calls: result.calls.map((x) => ({ tool: x.tool, ok: x.ok, args: x.args, summary: x.summary })) }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
