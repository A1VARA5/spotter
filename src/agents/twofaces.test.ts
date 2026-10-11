import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { compareFaces, lookSimilarity, palette, textOverlap, type FaceSnap } from "./twofaces";

const NO_ASKS = { card: false, bank: false, login: false, giftCard: false };
const TRACKING = "Parcel tracking. Your parcel is on its way and should arrive tomorrow between 9am and 5pm. Track another parcel. Help and contact us.";
const desktop: FaceSnap = { finalUrl: "https://parcels.example/track/A1", title: "Track your parcel", text: TRACKING, visibleChars: TRACKING.length, asks: NO_ASKS };

/** A tiny real PNG (RGB, filter 0 on every row) so the decoder is tested against the format, not a fake. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

describe("textOverlap", () => {
  it("is high for the same page laid out differently and low for a different page", () => {
    expect(textOverlap(TRACKING, `Menu ${TRACKING}`)).toBeGreaterThan(0.9);
    expect(textOverlap(TRACKING, "We missed you. A redelivery fee of 1.99 is due. Enter your card number, expiry and security code to rebook.")).toBeLessThan(0.2);
  });
  it("can't be measured on near empty text", () => {
    expect(textOverlap("Hi", TRACKING)).toBeNull();
  });
});

describe("palette and lookSimilarity", () => {
  it("decodes a real PNG into a colour histogram and tells similar looks from different ones", () => {
    const white = palette(png(8, 6, [250, 250, 250]));
    const white2 = palette(png(4, 9, [245, 248, 250]));
    const red = palette(png(8, 6, [220, 30, 40]));
    expect(white).not.toBeNull();
    expect(lookSimilarity(white!, white2!)).toBeGreaterThan(0.9);
    expect(lookSimilarity(white!, red!)).toBeLessThan(0.1);
  });
  it("refuses anything that isn't a PNG it can read", () => {
    expect(palette(Buffer.from("not a png"))).toBeNull();
    expect(palette(Buffer.alloc(0))).toBeNull();
  });
});

describe("compareFaces", () => {
  it("says the page is the same when both visits saw the same thing", () => {
    const r = compareFaces(desktop, { ...desktop, text: `Menu ${TRACKING}` }, "uk_mobile");
    expect(r).toMatchObject({ compared: true, differs: false });
    expect(r.verdict).toMatch(/looked the same/i);
  });

  it("files a difference when only the phone is asked for card details, and says so plainly", () => {
    const phone: FaceSnap = {
      finalUrl: "https://parcels.example/track/A1",
      title: "Redelivery fee due",
      text: "We missed you. A redelivery fee of £1.99 is due. Enter your card number, expiry and security code to rebook your delivery.",
      visibleChars: 120,
      asks: { ...NO_ASKS, card: true },
    };
    const r = compareFaces(desktop, phone, "uk_mobile");
    expect(r.compared && r.differs).toBe(true);
    expect(r.verdict).toBe("This page shows something different to phones in the UK than to security scanners: only the phone was asked for card details.");
    expect(r.compared && r.differences.map((d) => d.kind)).toEqual(expect.arrayContaining(["asks_money", "text"]));
    expect(r.compared && r.differences.find((d) => d.kind === "asks_money")).toMatchObject({ strong: true, desktop: "No card or bank form", phone: "Asks for card details" });
  });

  it("doesn't claim the UK when the phone visit didn't come from a UK network", () => {
    const r = compareFaces(desktop, { ...desktop, asks: { ...NO_ASKS, bank: true }, text: "Pay the fee by bank transfer. Sort code and account number below please." }, "direct");
    expect(r.verdict).not.toMatch(/UK/);
    expect(r.verdict).toMatch(/to phones than to security scanners/);
  });

  it("counts a different final site as a real difference", () => {
    const r = compareFaces(desktop, { ...desktop, finalUrl: "https://collect-x.example/pay" }, "uk_mobile");
    expect(r.compared && r.differs).toBe(true);
    expect(r.compared && r.differences[0]).toMatchObject({ kind: "final_site", desktop: "parcels.example", phone: "collect-x.example", strong: true });
  });

  it("treats a blank page on one side and content on the other as different", () => {
    const r = compareFaces({ ...desktop, text: "", visibleChars: 0 }, desktop, "uk_mobile");
    expect(r.compared && r.differs).toBe(true);
  });

  it("never lets the picture alone call it cloaking: a different look is only supporting", () => {
    const r = compareFaces({ ...desktop, palette: [1, ...Array(63).fill(0)] }, { ...desktop, palette: [...Array(63).fill(0), 1] }, "uk_mobile");
    expect(r.compared && r.differs).toBe(false);
    expect(r.compared && r.differences).toEqual([expect.objectContaining({ kind: "look", strong: false })]);
  });

  it("a text check that failed on one visit is not a blank page, so it never reads as cloaking", () => {
    const r = compareFaces({ ...desktop, text: undefined, visibleChars: 0, palette: [1, ...Array(63).fill(0)] }, { ...desktop, palette: [1, ...Array(63).fill(0)] }, "uk_mobile");
    expect(r.compared && r.differs).toBe(false);
  });

  it("doesn't say 'the same' when there was nothing to compare (both near empty, no pictures)", () => {
    const empty = { ...desktop, title: "", text: "Hi", visibleChars: 2 };
    const r = compareFaces(empty, empty, "uk_mobile");
    expect(r.compared).toBe(false);
    expect(r.verdict).not.toMatch(/same/i);
  });

  it("says it couldn't compare when either visit failed, never 'the same'", () => {
    for (const r of [compareFaces(null, desktop, "uk_mobile"), compareFaces(desktop, null, "uk_mobile")]) {
      expect(r.compared).toBe(false);
      expect(r.verdict).toMatch(/couldn't open it both ways/i);
      expect(r.verdict).not.toMatch(/same/i);
    }
  });
});
