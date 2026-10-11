import { describe, expect, it, vi } from "vitest";
import { pgliteDb } from "@/db";
import { createHousehold } from "@/core/households";
import { makeWarn } from "./warn";

describe("sending a switched off warning", () => {
  it("goes to every channel the spotter connected, and names the channel that failed", async () => {
    const db = await pgliteDb();
    const hh = (await createHousehold(db, { name: "H", spotterName: "Sam" })).id;
    await db.query("update households set telegram_chat_id = '9', discord_user_id = 'd1', alert_email = 'sam@example.com' where id = $1", [hh]);
    const telegram = vi.fn(async () => {});
    const discord = vi.fn(async () => {
      throw new Error("Discord refused the DM (403)");
    });
    const email = vi.fn(async () => {});
    const warn = makeWarn(db, "https://x", { telegram, discord, email });
    await expect(warn(hh, { kind: "chat_blocked", text: "Gran <b>just</b> blocked Spotter's chat." })).rejects.toThrow("discord: Discord refused the DM (403)");
    expect(telegram).toHaveBeenCalledWith("9", expect.stringContaining("Gran &lt;b&gt;just&lt;/b&gt; blocked"), expect.anything());
    expect(email).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a household with no channels", async () => {
    const db = await pgliteDb();
    const hh = (await createHousehold(db, { name: "H", spotterName: "Sam" })).id;
    const telegram = vi.fn(async () => {});
    await makeWarn(db, "https://x", { telegram })(hh, { kind: "chat_blocked", text: "x" });
    expect(telegram).not.toHaveBeenCalled();
  });
});
