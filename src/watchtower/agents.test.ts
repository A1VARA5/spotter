import { describe, expect, it } from "vitest";
import { PL_NEVER } from "./granLang";
import { BRIEF_ID, GRAN_ID, SPOTTER_ID, buildGranRoster, buildRoster, catalogueText, paypalStatus, weekOf, type SpotterTools } from "./agents";
import type { PaymentRow, PaypalRow } from "./data";

type T = { name: string; ids?: readonly string[] };
const t = (name: string) => ({ name }) as never;
const def = (id: string) => ({ id, name: id, instructions: () => `built in ${id}`, tools: () => [t(`own_${id}`)] });
const builtIn = { lead: def("lead"), data: def("data"), page: def("page"), planning: def("planning"), widget: def("widget") } as never;
const studio = { viewSchema: () => t("view_schema"), viewReport: () => t("view_report"), viewPage: () => t("view_page"), executeQuery: () => t("execute_query") };
const harnessTools = {
  delegateTo: (ids: readonly string[]) => ({ name: "delegate_to", ids }) as never,
  renameThread: () => t("rename_thread"),
  plan: { view: () => t("view_plan"), update: () => t("update_plan"), clear: () => t("clear_plan"), create: () => t("create_plan") },
};
const extra: SpotterTools = {
  caseFile: t("open_case_file"),
  alerts: t("watch_alerts"),
  radar: t("scam_radar"),
  paypal: t("paypal_status"),
  price: t("real_price"),
  fair: t("fair_prices"),
  addPage: t("add_page"),
  place: t("place_widget"),
};
const NOW = new Date("2026-10-10T12:00:00Z"); // a Saturday
const catalogue = [{ type: "fair-price", name: "Fair price", description: "What was paid against real shops.", sizing: {} }];
const ctx = { api: { getAiContext: () => ({ catalogue: () => catalogue }) }, studio, tools: harnessTools } as never;

const roster = () => buildRoster({ builtIn, extra, context: "SPOTTER CONTEXT", now: () => NOW });
const agent = (id: string) => roster().agents.find((a) => a.id === id)!;
const toolsOf = (id: string) => (agent(id).tools!(ctx, undefined as never) as unknown as T[]);
const names = (id: string) => toolsOf(id).map((x) => x.name);

describe("Watchtower's agent roster", () => {
  it("puts our own Spotter agent first as the one the chat opens with, keeps AG's lead and every built in agent, and adds the brief writer", () => {
    const r = roster();
    expect(r.primary).toBe(SPOTTER_ID);
    expect(r.agents.map((a) => a.id)).toEqual([SPOTTER_ID, BRIEF_ID, "lead", "data", "page", "planning", "widget"]);
    expect(agent(SPOTTER_ID).name).toBe("Spotter");
  });

  it("gives Spotter its read only tools and a delegate_to aimed at the brief writer and Studio's built in agents", () => {
    expect(names(SPOTTER_ID)).toEqual(expect.arrayContaining(["open_case_file", "watch_alerts", "scam_radar", "paypal_status", "real_price", "add_page", "rename_thread", "delegate_to"]));
    expect(toolsOf(SPOTTER_ID).find((x) => x.name === "delegate_to")!.ids).toEqual([BRIEF_ID, "data", "planning", "page", "widget"]);
  });

  it("never lets Spotter build widgets or query rows itself: building is the built in agents' job", () => {
    expect(names(SPOTTER_ID)).not.toEqual(expect.arrayContaining(["execute_query"]));
    for (const n of names(SPOTTER_ID)) expect(n).not.toMatch(/add_widget|configure_widget|position_widget|remove_widget/);
  });

  it("lets the brief writer gather numbers and hand the page to the page and widget agents, but not search shops", () => {
    expect(names(BRIEF_ID)).toEqual(expect.arrayContaining(["execute_query", "watch_alerts", "scam_radar", "add_page", "delegate_to"]));
    expect(names(BRIEF_ID)).not.toContain("real_price");
    expect(toolsOf(BRIEF_ID).find((x) => x.name === "delegate_to")!.ids).toEqual(["data", "planning", "page", "widget"]);
  });

  it("tells each custom agent the house rules, the widget catalogue and, for the brief, this week's page title", () => {
    const s = agent(SPOTTER_ID).instructions!(ctx, undefined as never);
    expect(s).toContain("SPOTTER CONTEXT");
    expect(s).toContain("fair-price");
    expect(s).toMatch(/untrusted/i);
    const b = agent(BRIEF_ID).instructions!(ctx, undefined as never);
    expect(b).toContain('"Week of 5 Oct 2026"');
    expect(b).toContain("SPOTTER CONTEXT");
  });

  it("tells Spotter whose counts the scam radar has: demo families for a demo family, Spotter families otherwise", () => {
    const demo = buildRoster({ builtIn, extra, context: "C", now: () => NOW, demo: true }).agents.find((a) => a.id === SPOTTER_ID)!.instructions!(ctx, undefined as never);
    expect(demo).toMatch(/scam_radar: [^\n]*other demo families/);
    expect(demo).not.toContain("other Spotter families");
    expect(agent(SPOTTER_ID).instructions!(ctx, undefined as never)).toMatch(/scam_radar: [^\n]*other Spotter families/);
  });

  it("declares no delegation params the way AG asks (s.undefined()), so the primary agent starts", () => {
    const s = { undefined: () => "none" };
    expect(agent(SPOTTER_ID).schema!(s as never)).toBe("none");
    expect(agent(BRIEF_ID).schema!(s as never)).toBe("none");
  });

  it("still extends AG's built in agents with Spotter's context, and the lead and data agents with the case file and alerts", () => {
    expect(agent("lead").instructions!(ctx, undefined as never)).toBe("built in lead\n\nSPOTTER CONTEXT");
    expect(names("lead")).toEqual(["own_lead", "open_case_file", "watch_alerts"]);
    expect(names("data")).toEqual(["own_data", "open_case_file", "watch_alerts"]);
    expect(names("page")).toEqual(["own_page"]);
  });

  it("answers the fair price question in one tool call: fair_prices, with no data agent hop", () => {
    expect(names(SPOTTER_ID)).toContain("fair_prices");
    expect(names(BRIEF_ID)).not.toContain("fair_prices");
    const s = agent(SPOTTER_ID).instructions!(ctx, undefined as never) as string;
    const route = s.split("\n").find((l) => l.startsWith('- "Did we pay fair prices?"'))!;
    expect(route).toMatch(/fair_prices/);
    expect(route).not.toMatch(/ask data/i);
    // the answer comes in chat first: no board look or page agent hop before it
    expect(route).not.toMatch(/view_page|have page/);
    expect(route).toMatch(/only when they ask/i);
    expect(route).toMatch(/place_widget with widgetType fair-price/);
    // a loose name match must never be passed off as the usual price
    expect(s).toMatch(/never call it the usual price/i);
  });

  it("turns a breakdown or show me question into a new tile: place_widget, then the widget and data agents side by side", () => {
    expect(names(SPOTTER_ID)).toContain("place_widget");
    const s = agent(SPOTTER_ID).instructions!(ctx, undefined as never) as string;
    const route = s.split("\n").find((l) => l.startsWith("- Breakdowns and show me questions"))!;
    expect(route).toMatch(/place_widget/);
    expect(route).toMatch(/widget/);
    expect(route).toMatch(/same turn|side by side|together/i);
    expect(route).toMatch(/spend|how much/i);
    // the same question asked again reuses its tile rather than building another
    expect(route).toMatch(/title/);
    expect(route).toMatch(/reused/);
  });

  it("never lets a price far below real shops pass as a good price, and never calls an unpaid payment paid", () => {
    const s = agent(SPOTTER_ID).instructions!(ctx, undefined as never) as string;
    expect(s).toMatch(/fake shop/i);
    expect(s).toMatch(/never a good price|never call it a good price|not a saving/i);
    expect(s).toMatch(/wasPaid/);
  });

  it("describes both custom agents so a delegating agent knows when to hand off", () => {
    expect(agent(BRIEF_ID).description).toMatch(/weekly brief/i);
    expect(agent(SPOTTER_ID).description).toBeTruthy();
  });
});

describe("weekOf", () => {
  it("names the Monday the week started", () => {
    expect(weekOf(NOW)).toBe("Week of 5 Oct 2026");
    expect(weekOf(new Date("2026-10-05T08:00:00Z"))).toBe("Week of 5 Oct 2026");
    expect(weekOf(new Date("2026-10-04T20:00:00Z"))).toBe("Week of 28 Sep 2026");
  });
});

describe("catalogueText", () => {
  it("lists each widget type with its name and a short description", () => {
    expect(catalogueText(catalogue as never)).toBe("- fair-price (Fair price): What was paid against real shops.");
  });
});

describe("paypalStatus", () => {
  const row = { id: "pay_1", who: "Gran", payee: "Corner Grocer", amount: 24.99, outcome: "Waiting", heldAtPayPal: 24.99, paypalExpires: new Date("2026-10-12T16:00:00Z"), sample: "No" } as PaymentRow;
  const ev = (id: string, when: string, label: string): PaypalRow => ({ id, when: new Date(when), eventType: "X", label, paymentId: "pay_1", amount: 24.99 });

  it("says what PayPal last said about a payment, newest first, with the hold expiry", () => {
    const s = paypalStatus("pay_1", [row], [ev("e1", "2026-10-09T10:00:00Z", "PayPal is holding the money"), ev("e2", "2026-10-09T11:00:00Z", "Order approved at PayPal"), { ...ev("e3", "2026-10-09T12:00:00Z", "Other"), paymentId: "pay_2" }]);
    expect(s).toEqual({
      found: true,
      who: "Gran",
      payee: "Corner Grocer",
      amount: 24.99,
      outcome: "Waiting",
      heldAtPayPal: 24.99,
      holdExpires: "2026-10-12T16:00:00.000Z",
      events: [
        { when: "2026-10-09T11:00:00.000Z", said: "Order approved at PayPal" },
        { when: "2026-10-09T10:00:00.000Z", said: "PayPal is holding the money" },
      ],
      note: "",
    });
  });

  it("is honest when PayPal hasn't said anything, or the payment is from the sample month", () => {
    expect(paypalStatus("pay_1", [row], undefined)).toMatchObject({ note: expect.stringMatching(/no PayPal events/i) });
    expect(paypalStatus("pay_s", [{ ...row, id: "pay_s", sample: "Yes" }], [])).toMatchObject({ note: expect.stringMatching(/sample/i) });
  });

  it("says when there's no such payment", () => {
    expect(paypalStatus("nope", [row], [])).toEqual({ found: false });
  });
});

describe("the simple view's agent (Gran mode)", () => {
  const month = t("my_month");
  const gran = () => buildGranRoster({ month, who: "Margaret", spotter: "Sam" });
  const g = () => gran().agents[0]!;
  const said = (d = g()) => d.instructions!(ctx, undefined as never) as string;

  it("is one agent on its own, with only the read only month tool and no way to build or hand work on", () => {
    expect(gran().primary).toBe(GRAN_ID);
    expect(gran().agents.map((a) => a.id)).toEqual([GRAN_ID]);
    const names = (g().tools!(ctx, undefined as never) as unknown as T[]).map((x) => x.name);
    expect(names).toEqual(["my_month"]);
  });

  it("speaks to the person, in short plain sentences, without ids or jargon", () => {
    const s = said();
    expect(s).toContain("Margaret");
    expect(s).toContain("Sam");
    expect(s).toMatch(/short, plain sentences/i);
    expect(s).toMatch(/no ids/i);
  });

  it("never tells them to approve or pay, says only the spotter decides, and gives the usual advice", () => {
    const s = said();
    expect(s).toMatch(/never tell .*approve/i);
    expect(s).toMatch(/only Sam decides/i);
    expect(s).toMatch(/number you already have/);
    expect(s).toMatch(/scammer wrote/i);
  });

  it("keeps runs short so a question costs a turn or two", () => {
    expect(g().maxTurns).toBeLessThanOrEqual(4);
  });

  it("in Polish: answers in Polish with the hand checked words, and still never approves anything", () => {
    const pl = said(buildGranRoster({ month, who: "Margaret", spotter: "Sam", lang: "pl" }).agents[0]!);
    const en = said();
    // every English rule is still there, word for word
    expect(pl.startsWith(en)).toBe(true);
    expect(pl).toMatch(/never tell .*approve/i);
    expect(pl).toMatch(/only Sam decides/i);
    expect(pl).toMatch(/always answer in Polish/);
    expect(pl).toMatch(/in any language/);
    expect(pl).toContain('"czeka"');
    expect(pl).toContain("Nie płać. Zadzwoń do tej osoby na numer, który już masz");
    for (const w of PL_NEVER) expect(pl).toContain(`"${w}"`);
    expect(en).not.toMatch(/Polish/);
  });

  it("works without a name", () => {
    expect(said(buildGranRoster({ month, who: null, spotter: "your spotter" }).agents[0]!)).toMatch(/the person Spotter looks out for/);
  });
});
