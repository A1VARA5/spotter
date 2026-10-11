// Makes the example subscription plan for the "tail first" demo in PayPal's SANDBOX, with PayPal's own Agent Toolkit
// tools (create_product, create_subscription_plan). This is Spotter's own setup, run once by hand: no agent ever gets
// these tools. Free (sandbox REST only). Prints the plan id to use with create_subscription.
//
//   npx tsx --env-file=.env.local scripts/setup-toolkit-plans.mts
import { PayPalAPI } from "@paypal/agent-toolkit/mcp";
import { token } from "../src/paypal/client";

const api = new PayPalAPI(await token(), { sandbox: true });
const parse = (raw: string) => {
  const j = JSON.parse(raw);
  if (j.error) throw new Error(j.error.message);
  return j;
};

const product = parse(
  await api.run("create_product", { name: "Example: StreamBox (sandbox demo, not a real service)", type: "SERVICE", description: "Made up for Spotter's demo." }),
);
console.log(`Product ${product.id}`);
const plan = parse(
  await api.run("create_subscription_plan", {
    product_id: product.id,
    name: "Example: StreamBox Premium (sandbox)",
    description: "7 day free trial, then 39.99 a month. Made up for Spotter's demo.",
    billing_cycles: [
      { frequency: { interval_unit: "DAY", interval_count: 7 }, tenure_type: "TRIAL", sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { currency_code: "USD", value: "0" } } },
      { frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: "USD", value: "39.99" } } },
    ],
    payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 1 },
  }),
);
console.log(`Plan ${plan.id} (${plan.status}): ${plan.name}`);
