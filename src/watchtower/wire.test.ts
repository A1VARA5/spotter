import { describe, expect, it } from "vitest";
import { revive } from "./wire";

describe("watchtower wire data", () => {
  it("turns the dates that came over as text back into Dates, keeping empty expiries empty", () => {
    const wire = JSON.parse(
      JSON.stringify({
        payments: [
          { id: "a", when: new Date("2026-10-10T10:00:00Z"), paypalExpires: new Date("2026-10-12T10:00:00Z") },
          { id: "b", when: new Date("2026-10-09T10:00:00Z"), paypalExpires: null },
        ],
        signs: [{ paymentId: "a", when: new Date("2026-10-10T10:00:00Z") }],
        people: [{ name: "Gran" }],
        paypal: [{ id: "e", when: new Date("2026-10-10T11:00:00Z") }],
      }),
    );
    const s = revive(wire);
    expect(s.payments[0]!.when).toEqual(new Date("2026-10-10T10:00:00Z"));
    expect(s.payments[0]!.paypalExpires).toEqual(new Date("2026-10-12T10:00:00Z"));
    expect(s.payments[1]!.paypalExpires).toBeNull();
    expect(s.signs[0]!.when).toBeInstanceOf(Date);
    expect(s.paypal![0]!.when).toBeInstanceOf(Date);
    expect(s.people).toEqual([{ name: "Gran" }]);
  });

  it("keeps the price watches, with their start dates as Dates", () => {
    const wire = JSON.parse(JSON.stringify({ payments: [], signs: [], people: [], watches: [{ id: "w", started: new Date("2026-10-01T00:00:00Z"), status: "Dropped" }] }));
    const s = revive(wire);
    expect(s.watches).toEqual([{ id: "w", started: new Date("2026-10-01T00:00:00Z"), status: "Dropped" }]);
  });

  it("leaves the PayPal source out when the server didn't send one", () => {
    expect(revive({ payments: [], signs: [], people: [] } as never).paypal).toBeUndefined();
  });
});
