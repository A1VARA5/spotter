import { describe, expect, it } from "vitest";
import type { PaymentRow } from "./data";
import { INITIAL } from "./initial";
import { incidentName, pickIncidents, withIncidents } from "./incidents";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const row = (over: Partial<PaymentRow>): PaymentRow => ({
  id: "pay_x",
  currency: "GBP",
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
  marketCheapest: null,
  marketMedian: null,
  priceGap: null,
  marketShop: "",
  marketItem: "",
  wasItYou: "Not asked",
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

  it("adds a page with the case file, money in mid air, scam radar and the person's payments, and stays on This month", () => {
    const { state, added } = withIncidents(INITIAL, [row({ id: "pay_hi", who: "Gran", payee: "New number" })], NOW, []);
    const s = state as unknown as State;
    expect(added).toEqual(["pay_hi"]);
    expect(s.pages[0]!.id).toBe("month");
    const page = s.pages.find((p) => p.id === "incident-pay_hi")!;
    expect(page.name).toBe("Incident: Gran £400");
    expect(s.selectedPageId).toBe("month");
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
    expect(withIncidents(INITIAL, [row({ id: "paid", outcome: "Paid" })], NOW, [])).toEqual({ state: INITIAL, added: [], changed: false });
    const once = withIncidents(INITIAL, [row({ id: "pay_hi" })], NOW, []).state;
    const twice = withIncidents(once, [row({ id: "pay_hi" })], NOW, []);
    expect(twice.added).toEqual([]);
    expect((twice.state as unknown as State).pages.filter((p) => p.id === "incident-pay_hi")).toHaveLength(1);
  });

  it("keeps the family on the page they were on when several arrive at once, and is the same every time", () => {
    const rows = [row({ id: "a", when: hoursAgo(5) }), row({ id: "b", when: hoursAgo(1) })];
    const one = withIncidents(INITIAL, rows, NOW, []);
    expect((one.state as unknown as State).selectedPageId).toBe("month");
    expect(withIncidents(INITIAL, rows, NOW, [])).toEqual(one);
  });

  const incidentIds = (s: unknown) => (s as State).pages.map((p) => p.id).filter((id) => id.startsWith("incident-"));

  it("never piles up: at most three incident tabs, the newest kept", () => {
    let board = INITIAL;
    const seen: string[] = [];
    // Five visits, a new waiting payment each time (a judge sending Hi Mum again and again).
    for (let i = 1; i <= 5; i++) {
      const rows = Array.from({ length: i }, (_, k) => row({ id: `w${k + 1}`, outcome: "Waiting", when: hoursAgo(10 - k) }));
      const r = withIncidents(board, rows, NOW, seen);
      seen.push(...r.added);
      board = r.state;
    }
    expect(incidentIds(board)).toEqual(["incident-w3", "incident-w4", "incident-w5"]);
  });

  it("closes incident tabs that are over: paid, cleared by Start fresh, or stopped more than a day ago", () => {
    const rows = [row({ id: "a", outcome: "Waiting" }), row({ id: "b", outcome: "Waiting" }), row({ id: "c", outcome: "Waiting" })];
    const opened = withIncidents(INITIAL, rows, NOW, []);
    const later = [row({ id: "a", outcome: "Paid" }), row({ id: "c", outcome: "Stopped", when: hoursAgo(30) })]; // b is gone
    const r = withIncidents(opened.state, later, NOW, ["a", "b", "c"]);
    expect(incidentIds(r.state)).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it("keeps a tab whose payment just isn't in a capped list of rows (not proof it's over)", () => {
    const opened = withIncidents(INITIAL, [row({ id: "a", outcome: "Waiting" })], NOW, []);
    expect(incidentIds(withIncidents(opened.state, [], NOW, ["a"], false).state)).toEqual(["incident-a"]);
  });

  it("never closes a tab the family renamed, and moves off a closed tab that was open", () => {
    const opened = withIncidents(INITIAL, [row({ id: "a", outcome: "Waiting" }), row({ id: "b", outcome: "Waiting" })], NOW, []).state as unknown as State;
    const board = { ...opened, selectedPageId: "incident-b", pages: opened.pages.map((p) => (p.id === "incident-a" ? { ...p, name: "Gran's big one" } : p)) } as never;
    const r = withIncidents(board, [], NOW, ["a", "b"]);
    expect(incidentIds(r.state)).toEqual(["incident-a"]);
    expect((r.state as unknown as State).selectedPageId).toBe("month");
  });

  it("tells same named incidents apart by payee, then by time", () => {
    const rows = [
      row({ id: "a", who: "Shopping agent", amount: 24.99, payee: "Earbud Outlet", when: new Date("2026-10-10T09:05:00Z") }),
      row({ id: "b", who: "Shopping agent", amount: 24.99, payee: "Earbud Outlet", when: new Date("2026-10-10T10:40:00Z") }),
      row({ id: "c", who: "Shopping agent", amount: 24.99, payee: "Gadget Barn", when: new Date("2026-10-10T11:00:00Z") }),
    ];
    const names = (withIncidents(INITIAL, rows, NOW, []).state as unknown as State).pages.map((p) => p.name);
    expect(names).toContain("Incident: Shopping agent £24.99 to Gadget Barn");
    expect(names).toContain("Incident: Shopping agent £24.99 to Earbud Outlet, 10:05");
    expect(names).toContain("Incident: Shopping agent £24.99 to Earbud Outlet, 11:40");
    expect(new Set(names).size).toBe(names.length);
  });

  it("renames duplicates already saved on the board, but never a page the family renamed", () => {
    const rows = [
      row({ id: "a", who: "Leo", amount: 5, payee: "Game Shop" }),
      row({ id: "b", who: "Leo", amount: 5, payee: "Skins Hub" }),
    ];
    const saved = withIncidents(INITIAL, rows.slice(0, 1), NOW, []).state as unknown as State;
    const dup = { ...saved.pages.find((p) => p.id === "incident-a")!, id: "incident-b" };
    const mine = { ...dup, id: "incident-x", name: "Leo's games" };
    const board = { ...saved, pages: [...saved.pages, dup, mine] } as never;
    const { state, added } = withIncidents(board, rows, NOW, ["a", "b"]);
    const names = (state as unknown as State).pages.map((p) => p.name);
    expect(added).toEqual([]);
    expect(names).toContain("Incident: Leo £5 to Game Shop");
    expect(names).toContain("Incident: Leo £5 to Skins Hub");
    expect(names).toContain("Leo's games");
  });

  it("copes with a saved board that isn't the shape it expects", () => {
    expect(withIncidents({} as never, [row({})], NOW, []).added).toEqual([]);
  });
});
