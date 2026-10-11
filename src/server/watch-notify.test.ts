import { beforeAll, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import type { WatchView } from "@/core/watch";
import { dropLines, makeDropNotify } from "./watch-notify";

const w: WatchView & { householdId: string } = {
  id: "watch_1",
  householdId: "",
  paymentId: "pay_1",
  who: "Gran",
  item: "the headphones the agent typed",
  title: "Over ear <b>headphones</b>", // the notice names Channel3's title, not the item text
  currency: "GBP",
  nearlyPaid: 8900,
  target: 7600,
  best: { price: 6900, shop: "harbourline-audio.co.uk", url: "https://harbourline-audio.co.uk/x2" },
  saving: 2000,
  status: "dropped",
  history: null,
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-10-15T00:00:00Z",
  lastCheckedAt: null,
  example: false,
  createdBy: "spotter",
};

describe("dropLines", () => {
  it("says who wanted it, the real shop, the price, the saving and that the spotter decides", () => {
    const t = dropLines(w).join(" ");
    expect(t).toContain("harbourline-audio.co.uk now sells the Over ear <b>headphones</b> Gran wanted for £69.00.");
    expect(t).toContain("£20.00 less than Gran nearly paid");
    expect(t).toContain("Nothing is bought unless you decide to.");
    expect(t).not.toMatch(/\b(deal|buy now|autobuy)\b/i);
  });

  it("leaves the saving out when there isn't one (it was a fake shop price)", () => {
    expect(dropLines({ ...w, nearlyPaid: 2499, saving: null }).join(" ")).not.toContain("less than");
  });
});

describe("makeDropNotify", () => {
  let db: Db;
  beforeAll(async () => {
    db = await pgliteDb();
  }, 30_000);
  it("tells the spotter on every channel they set up, escaping text for Telegram, and never the person who wanted it", async () => {

    const hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
    await db.query("update households set telegram_chat_id = '111', discord_user_id = '222', alert_email = 'sam@example.com' where id = $1", [hh]);
    const tg = vi.fn(async () => {});
    const dm = vi.fn(async () => {});
    const mail = vi.fn(async () => {});
    await makeDropNotify(db, "https://site", { telegram: tg, discord: dm, email: mail })({ ...w, householdId: hh });
    expect(tg).toHaveBeenCalledTimes(1);
    expect((tg.mock.calls[0] as unknown as [string, string])[0]).toBe("111");
    expect((tg.mock.calls[0] as unknown as [string, string])[1]).toContain("&lt;b&gt;headphones&lt;/b&gt;");
    expect((dm.mock.calls[0] as unknown as [string, string])[0]).toBe("222");
    expect((mail.mock.calls[0] as unknown as [string])[0]).toBe("sam@example.com");
  });

  it("says so when there's no household to tell, and warns when no channel is set up", async () => {
    await expect(makeDropNotify(db, "https://site", {})({ ...w, householdId: "hh_gone" })).rejects.toThrow(/no household/);
    const hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await makeDropNotify(db, "https://site", {})({ ...w, householdId: hh });
    expect(warn.mock.calls.flat().join(" ")).toContain("watch_1");
  });

  it("names every channel that failed in one error", async () => {

    const hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
    await db.query("update households set telegram_chat_id = '111', discord_user_id = '222' where id = $1", [hh]);
    const fail = vi.fn(async () => {
      throw new Error("telegram down");
    });
    await expect(makeDropNotify(db, "https://site", { telegram: fail, discord: vi.fn(async () => {}) })({ ...w, householdId: hh })).rejects.toThrow("telegram down");
  });
});
