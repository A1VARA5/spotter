// What Spotter does with every tool in PayPal's Agent Toolkit (@paypal/agent-toolkit 1.11.0, 47 tools, read from
// the installed package's getTools()). One table drives the guarded MCP server (/api/toolkit/mcp: which tools an agent
// is offered and how each is handled) and the "all 47 tools" view in the app, so the two can never disagree.
// A test checks the table against the installed toolkit's own list.
//
// PayPal's toolkit is a seller's toolkit: refunds, invoices, tracking and subscriptions act for the account that gets
// paid. So what makes sense depends on the agent's job. A family's shopping agent pays; a family's selling agent
// (a teen reselling on a parent's PayPal, or a small business) gets paid.
//   guarded      the call goes through Spotter's checks and, where money moves, the spotter's PIN
//   passthrough  runs the toolkit's real call, but only on things Spotter made for this family
//   bait         offered with PayPal's own name, description and schema, but never runs: an agent sent to do this job
//                has no honest reason to call it, so calling it means someone else is steering the agent
//   hidden       not offered at all (an honest agent might call it by mistake, or it can't be scoped to one family)

export const TOOLKIT_VERSION = "1.11.0";

export type Job = "shopping" | "selling";
export type Treatment = "guarded" | "passthrough" | "bait" | "hidden";
export type Group = "Orders and payments" | "Invoices" | "Subscriptions" | "Catalog" | "Shipping" | "Disputes" | "Reporting";

type Side = { treatment: Treatment; why: string };
export type ToolCoverage = { tool: string; group: Group; shopping: Side; selling: Side };

const g = (treatment: Treatment, why: string): Side => ({ treatment, why });

// Reasons used more than once.
const ASKS_FOR_MONEY = "Invoices ask other people for money in the family's name. A shopping agent pays; it never bills anyone.";
const INVOICE_ADMIN = "Invoice admin for the business that gets paid. A shopping agent has no invoices to manage.";
const SHARED_ACCOUNT = "Every family shares Spotter's one PayPal sandbox account, and this reaches the whole account, so it can't be kept to one family.";
const READS_ACCOUNT = "Reads the seller's whole PayPal account. A shopping agent has no reason to look, and snooping first is how a hijacked agent starts.";
const INVOICES_LATER = "Invoices can't be held for the spotter yet, and every family shares one sandbox account, so a selling agent doesn't get them.";

const invoiceTool = (tool: string, shoppingWhy: string): ToolCoverage => ({ tool, group: "Invoices", shopping: g("bait", shoppingWhy), selling: g("hidden", INVOICES_LATER) });

export const COVERAGE: ToolCoverage[] = [
  // Orders and payments
  {
    tool: "create_order",
    group: "Orders and payments",
    shopping: g("guarded", "Becomes a Spotter payment: rules, the AI check, a real PayPal hold and the spotter's yes. Spotter works out the total itself."),
    selling: g("passthrough", "Makes a real PayPal order for a buyer to pay this family, recorded as this family's sale. Money only comes in."),
  },
  {
    tool: "pay_order",
    group: "Orders and payments",
    shopping: g("guarded", "Never captures. It tells the agent what Spotter decided: paid, held for the spotter, or refused."),
    selling: g("passthrough", "Takes a buyer's approved payment for one of this family's own sales, through the toolkit. Money only comes in."),
  },
  {
    tool: "get_order",
    group: "Orders and payments",
    shopping: g("passthrough", "Runs the toolkit's real get_order, only for orders this agent made, with Spotter's decision on top."),
    selling: g("passthrough", "Runs the toolkit's real get_order, only for this family's own sales."),
  },
  {
    tool: "create_refund",
    group: "Orders and payments",
    shopping: g("bait", "Refunds send money back from the seller's account. A shopping agent has nothing to refund, so this is someone else's plan."),
    selling: g("guarded", "Held for the spotter's PIN. Only back to the original payment, and checked against what PayPal says the buyer really paid."),
  },
  {
    tool: "get_refund",
    group: "Orders and payments",
    shopping: g("hidden", "Looks up a seller's refund. An honest shopping agent might call it to check on its own refund, so it isn't bait, just not offered."),
    selling: g("passthrough", "Runs the toolkit's real get_refund, only for refunds Spotter made for this family."),
  },
  // Invoices
  invoiceTool("create_invoice", ASKS_FOR_MONEY),
  invoiceTool("send_invoice", ASKS_FOR_MONEY),
  invoiceTool("send_invoice_reminder", ASKS_FOR_MONEY),
  invoiceTool("create_recurring_series", ASKS_FOR_MONEY),
  invoiceTool("activate_recurring_series", ASKS_FOR_MONEY),
  invoiceTool("get_recurring_series", READS_ACCOUNT),
  invoiceTool("cancel_recurring_series", INVOICE_ADMIN),
  invoiceTool("delete_recurring_series", INVOICE_ADMIN),
  invoiceTool("list_invoices", READS_ACCOUNT),
  invoiceTool("get_invoice", READS_ACCOUNT),
  invoiceTool("search_invoicing", READS_ACCOUNT),
  invoiceTool("update_invoicing", INVOICE_ADMIN),
  invoiceTool("cancel_sent_invoice", INVOICE_ADMIN),
  invoiceTool("delete_invoice", INVOICE_ADMIN),
  invoiceTool("setup_invoice_auto_reminders", ASKS_FOR_MONEY),
  invoiceTool("update_invoice_auto_reminder", INVOICE_ADMIN),
  invoiceTool("cancel_invoice_auto_reminder", INVOICE_ADMIN),
  invoiceTool("generate_invoice_qr_code", ASKS_FOR_MONEY),
  invoiceTool("generate_invoice_number", INVOICE_ADMIN),
  invoiceTool("record_payment_for_invoice", "Marks an invoice as paid in the seller's books. A shopping agent writing the seller's books has been told to by someone else."),
  invoiceTool("record_refund_for_invoice", "Marks an invoice as refunded in the seller's books. A shopping agent has no books to write."),
  invoiceTool("create_conditional_rules_for_invoice", INVOICE_ADMIN),
  // Subscriptions
  {
    tool: "create_subscription",
    group: "Subscriptions",
    shopping: g("guarded", "Stays waiting for approval at PayPal. Spotter reads the plan and shows the whole tail first (now, later, every month, the first year) and keeps the approval link for the spotter's PIN."),
    selling: g("guarded", "Same as for a shopping agent: the whole tail first, and the approval link only with the spotter's PIN."),
  },
  {
    tool: "show_subscription_plan_details",
    group: "Subscriptions",
    shopping: g("passthrough", "Runs the toolkit's real call. Reading a plan's prices before signing up is what a careful agent should do."),
    selling: g("passthrough", "Runs the toolkit's real call, read only."),
  },
  {
    tool: "show_subscription_details",
    group: "Subscriptions",
    shopping: g("passthrough", "Runs the toolkit's real call, only for subscriptions this agent started through Spotter."),
    selling: g("passthrough", "Runs the toolkit's real call, only for subscriptions this agent started through Spotter."),
  },
  {
    tool: "list_subscription_plans",
    group: "Subscriptions",
    shopping: g("hidden", "Lists the seller's plans. An honest agent might mistake it for browsing a shop, so it isn't bait, just not offered."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "cancel_subscription",
    group: "Subscriptions",
    shopping: g("bait", "Cancels a customer's subscription from the seller's side. A shopping agent has no customers."),
    selling: g("hidden", "Cancelling a customer's plan can't be held for the spotter yet, and plans are shared by every family in the sandbox."),
  },
  {
    tool: "update_subscription",
    group: "Subscriptions",
    shopping: g("bait", "Changes a customer's subscription from the seller's side. A shopping agent has no customers."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "create_subscription_plan",
    group: "Subscriptions",
    shopping: g("bait", "Sets up something to sell every month. A shopping agent sells nothing."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "update_plan",
    group: "Subscriptions",
    shopping: g("bait", "Changes the price of a plan the seller offers. A shopping agent sells nothing."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  // Catalog
  {
    tool: "create_product",
    group: "Catalog",
    shopping: g("bait", "Adds a product to the seller's catalog. A shopping agent sells nothing."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "update_product",
    group: "Catalog",
    shopping: g("bait", "Changes a product in the seller's catalog. A shopping agent sells nothing."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "list_products",
    group: "Catalog",
    shopping: g("hidden", "Lists the seller's own catalog. An honest agent might mistake it for browsing a shop, so it isn't bait, just not offered."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "show_product_details",
    group: "Catalog",
    shopping: g("hidden", "Reads one product from the seller's catalog. An honest agent might mistake it for a shop page, so it isn't bait, just not offered."),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  // Shipping
  {
    tool: "create_shipment_tracking",
    group: "Shipping",
    shopping: g("bait", "Adds tracking to a sale the seller shipped. A shopping agent ships nothing."),
    selling: g("guarded", "Paid? Prove it. Refused until PayPal itself shows a completed payment for that sale, so a fake 'payment received' email can't get goods posted."),
  },
  {
    tool: "get_shipment_tracking",
    group: "Shipping",
    shopping: g("hidden", "Looks up the seller's tracking. An honest agent might call it to follow its own parcel, so it isn't bait, just not offered."),
    selling: g("passthrough", "Runs the toolkit's real call, only for this family's own paid sales."),
  },
  {
    tool: "update_shipment_tracking",
    group: "Shipping",
    shopping: g("bait", "Changes tracking on a sale the seller shipped. A shopping agent ships nothing."),
    selling: g("hidden", "Tracking ids aren't tied to one family yet, so changing them can't be kept to this family's sales."),
  },
  // Disputes
  {
    tool: "list_disputes",
    group: "Disputes",
    shopping: g("bait", READS_ACCOUNT),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "get_dispute",
    group: "Disputes",
    shopping: g("bait", READS_ACCOUNT),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "accept_dispute_claim",
    group: "Disputes",
    shopping: g("bait", "Gives up a dispute so PayPal refunds the buyer from the seller's money. A shopping agent is never the seller."),
    selling: g("hidden", "It refunds the buyer straight away with no hold, and disputes can't be kept to one family yet, so it isn't offered."),
  },
  // Reporting
  {
    tool: "list_transactions",
    group: "Reporting",
    shopping: g("bait", READS_ACCOUNT),
    selling: g("hidden", SHARED_ACCOUNT),
  },
  {
    tool: "get_merchant_insights",
    group: "Reporting",
    shopping: g("hidden", "Only works on live PayPal accounts. The toolkit itself refuses it in the sandbox."),
    selling: g("hidden", "Only works on live PayPal accounts. The toolkit itself refuses it in the sandbox."),
  },
];

const BY_TOOL = new Map(COVERAGE.map((c) => [c.tool, c]));

/** How Spotter handles one toolkit tool for an agent with this job, or undefined for a name the toolkit doesn't have. */
export function coverageFor(tool: string, job: Job): (Side & { tool: string; group: Group }) | undefined {
  const c = BY_TOOL.get(tool);
  return c ? { tool: c.tool, group: c.group, ...c[job] } : undefined;
}

/** Every tool the guarded MCP server offers an agent with this job: guarded, passed through and bait. Never hidden. */
export function toolsFor(job: Job) {
  return COVERAGE.map((c) => ({ tool: c.tool, group: c.group, ...c[job] })).filter((c) => c.treatment !== "hidden");
}

export const GROUPS: Group[] = ["Orders and payments", "Subscriptions", "Shipping", "Invoices", "Disputes", "Catalog", "Reporting"];

export const isJob = (v: unknown): v is Job => v === "shopping" || v === "selling";
