import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import type { ScreenshotRead } from "@/ai/screenshot";
import { routePicture, savePending, screenshotText, takePending, type PictureDeps } from "./picture";

let db: Db;
let hh: string;
let read: ReturnType<typeof vi.fn<PictureDeps["read"]>>;
let deps: PictureDeps;
const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
const msg: ScreenshotRead = { ok: true, kind: "message", from: "+44 7700 900461", text: "Hi mum, new number. Send £250 to jamie", injection: false };

beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
  read = vi.fn<PictureDeps["read"]>(async () => msg);
  deps = { db, householdId: hh, read };
});

describe("routePicture", () => {
  it("sends a screenshot of a message to the message check", async () => {
    expect(await routePicture(deps, img, "jpeg", null)).toEqual({ route: "message", read: msg });
  });

  it("sends a photo of things to the price check, and unclear pictures to a question", async () => {
    read.mockResolvedValueOnce({ ok: true, kind: "products", from: null, text: "", injection: false });
    expect(await routePicture(deps, img, "jpeg", null)).toEqual({ route: "prices" });
    read.mockResolvedValueOnce({ ok: true, kind: "unclear", from: null, text: "", injection: false });
    expect(await routePicture(deps, img, "jpeg", null)).toEqual({ route: "ask" });
  });

  it("goes straight to prices when the person chose prices, without reading the picture", async () => {
    expect(await routePicture(deps, img, "jpeg", "prices")).toEqual({ route: "prices" });
    expect(read).not.toHaveBeenCalled();
  });

  it("when the person chose 'message', it is a message if there are words, whatever the reader thought it was", async () => {
    read.mockResolvedValueOnce({ ok: true, kind: "products", from: null, text: "Total £1,200 for the lot", injection: false });
    expect(await routePicture(deps, img, "jpeg", "message")).toMatchObject({ route: "message" });
    read.mockResolvedValueOnce({ ok: true, kind: "unclear", from: null, text: "", injection: false });
    expect(await routePicture(deps, img, "jpeg", "message")).toMatchObject({ route: "error", status: 422 });
  });

  it("fails honestly when the reader fails, never guessing a route", async () => {
    read.mockResolvedValueOnce({ ok: false, error: "x" });
    expect(await routePicture(deps, img, "jpeg", null)).toMatchObject({ route: "error", status: 502 });
  });

  it("caps reads per family and overall, before calling the model", async () => {
    deps.perHousehold = 1;
    await routePicture(deps, img, "jpeg", null);
    expect(await routePicture(deps, img, "jpeg", null)).toMatchObject({ route: "error", status: 429 });
    const other = (await createHousehold(db, { name: "U", spotterName: "Kim" })).id;
    expect(await routePicture({ ...deps, householdId: other, perHousehold: 5, overall: 1 }, img, "jpeg", null)).toMatchObject({ status: 429 });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("screenshotText", () => {
  it("says the words were read from a screenshot, who it appears to be from, and flags instructions aimed at an AI", () => {
    const t = screenshotText({ ...msg, injection: true });
    expect(t).toContain("Read from a screenshot");
    expect(t).toContain("It appears to be from: +44 7700 900461");
    expect(t).toContain("try to instruct an AI");
    expect(t.endsWith("Hi mum, new number. Send £250 to jamie")).toBe(true);
  });
});

describe("pending pictures", () => {
  it("are taken once, only by the same chat", async () => {
    const token = await savePending(db, { householdId: hh, chat: "111", fileId: "file-1", caption: "" });
    expect(await takePending(db, token, "222")).toBeNull();
    expect(await takePending(db, token, "111")).toMatchObject({ fileId: "file-1", householdId: hh });
    expect(await takePending(db, token, "111")).toBeNull();
    expect(await takePending(db, "nope", "111")).toBeNull();
  });
});
