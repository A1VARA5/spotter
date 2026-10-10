import { describe, expect, it } from "vitest";
import type { PaymentRow } from "./data";
import { INITIAL } from "./initial";
import { incidentName, pickIncidents, withIncidents } from "./incidents";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const row = (over: Partial<PaymentRow>): PaymentRow => ({
  id: "pay_x",
  when: hoursAgo(1),
  who: "Gran",
  kind: "Person",
  payee: "New number",
  category: "family",
  method: "PayPal",
  amount: 400,
  outcome: "Stopped",
  moneyKept: 400,
  signs: 1,
  topSign: "Pretending to be someone",
  verdict: "None",
  newPayee: "Yes",
  sample: "No",
  heldAtPayPal: 0,
  paypalExpires: null,
  paypalId: "",
  ...over,
});

type Page = { id: string; name: string; widgets: Record<string, { type: string; dataMapping: unknown; format?: unknown }>; widgetLayout: Record<string, unknown>; filter?: { widget?: Record<string, Array<{ field: { id: string }; model: { operator: string; value: unknown } }>> } };
type State = { pages: Page[]; selectedPageId: string };

describe("incident pages", () => {
  it("picks waiting payments and ones stopped or denied in the last day, newest first", () => {
    const rows = [
      row({ id: "old_stop", when: hoursAgo(30) }),
      row({ id: "paid", outcome: "Paid", moneyKept: 0 }),
      row({ id: "wait_old", outcome: "Waiting", when: hoursAgo(50), heldAtPayPal: 400 }),
      row({ id: "denied", outcome: "Denied", when: hoursAgo(5) }),
      row({ id: "stop", when: hoursAgo(2) }),
    ];
    expect(pickIncidents(rows, NOW, []).map((r) => r.id)).toEqual(["stop", "denied", "wait_old"]);
  });

  it("skips ones the family has already been shown, and keeps to three", () => {
    const rows = [1, 2, 3, 4, 5].map((h) => row({ id: `s${h}`, when: hoursAgo(h) }));
    expect(pickIncidents(rows, NOW, ["s1"]).map((r) => r.id)).toEqual(["s2", "s3", "s4"]);
  });

  it("names the page after who and how much", () => {
    expect(incidentName(row({ who: "Gran", amount: 400 }))).toBe("Incident: Gran £400");
    expect(incidentName(row({ who: "Leo", amount: 2.99 }))).toBe("Incident: Leo £2.99");
    expect(incidentName(row({ who: "Gran", amount: 1250 }))).toBe("Incident: Gran £1,250");
  });

  it("adds a page with the case file, money in mid air, scam radar and the person's payments, and selects it", () => {
    const { state, added } = withIncidents(INITIAL, [row({ id: "pay_hi", who: "Gran", payee: "New number" })], NOW, []);
    const s = state as unknown as State;
    expect(added).toEqual(["pay_hi"]);
    expect(s.pages[0]!.id).toBe("month");
    const page = s.pages.find((p) => p.id === "incident-pay_hi")!;
    expect(page.name).toBe("Incident: Gran £400");
    expect(s.selectedPageId).toBe("incident-pay_hi");
    expect(Object.values(page.widgets).map((w) => w.type).sort()).toEqual(["case-file", "grid", "money-mid-air", "scam-radar"]);
    for (const id of Object.keys(page.widgets)) expect(page.widgetLayout[id]).toBeDefined();
    const filters = page.filter!.widget!;
    const byType = (t: string) => filters[Object.entries(page.widgets).find(([, w]) => w.type === t)![0]]![0]!;
    expect(byType("case-file")).toEqual({ field: { id: "payments.id" }, model: { operator: "equals", value: "pay_hi" } });
    expect(byType("money-mid-air")).toEqual({ field: { id: "payments.id" }, model: { operator: "equals", value: "pay_hi" } });
    expect(byType("scam-radar")).toEqual({ field: { id: "payments.payee" }, model: { operator: "equals", value: "New number" } });
    expect(byType("grid")).toEqual({ field: { id: "payments.who" }, model: { operator: "equals", value: "Gran" } });
  });

  it("leaves the board alone when there's nothing new, and never duplicates a page", () => {
    expect(withIncidents(INITIAL, [row({ id: "paid", outcome: "Paid" })], NOW, [])).toEqual({ state: INITIAL, added: [] });
    const once = withIncidents(INITIAL, [row({ id: "pay_hi" })], NOW, []).state;
    const twice = withIncidents(once, [row({ id: "pay_hi" })], NOW, []);
    expect(twice.added).toEqual([]);
    expect((twice.state as unknown as State).pages.filter((p) => p.id === "incident-pay_hi")).toHaveLength(1);
  });

  it("selects the newest incident when several arrive at once, and is the same every time", () => {
    const rows = [row({ id: "a", when: hoursAgo(5) }), row({ id: "b", when: hoursAgo(1) })];
    const one = withIncidents(INITIAL, rows, NOW, []);
    expect((one.state as unknown as State).selectedPageId).toBe("incident-b");
    expect(withIncidents(INITIAL, rows, NOW, [])).toEqual(one);
  });

  it("copes with a saved board that isn't the shape it expects", () => {
    expect(withIncidents({} as never, [row({})], NOW, []).added).toEqual([]);
  });
});
