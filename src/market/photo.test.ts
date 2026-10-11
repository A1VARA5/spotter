import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import type { Product, Scene } from "./channel3";
import { buildPhoto, captionAmount, confirmMatch, imageFrom, parseAmount, photoCheck, photoMode, sameModel, type PhotoDeps } from "./photo";

type Cond = "new" | "used" | null;
const prod = (id: string, title: string, brand: string | undefined, offers: Array<[string, number, Cond?]>, categories?: string[]): Product => ({
  id,
  title,
  ...(brand ? { brand } : {}),
  image: `https://cdn.trychannel3.com/${id}`,
  offers: offers.map(([domain, price, condition]) => ({ title, domain, price, currency: "GBP" as const, url: `https://buy.trychannel3.com/${id}-${domain}`, ...(condition !== undefined ? { condition } : {}) })),
  ...(categories ? { categories } : {}),
});

// Shaped like the live answer for a desk photo (11 Oct 2026): the headphones crop came back as three listings of the
// same model, the monitor crop as eight different monitors.
const HEADPHONES = [
  prod("5jesTFu", "WH-1000XM4C Wireless Noise Cancelling Over-Ear Headphones with USB-C", "Sony", [["currys.co.uk", 21900, "new"], ["argos.co.uk", 21999, "new"]], ["headphones", "electronics"]),
  prod("2sYIKEs", "WH-1000XM4C Noise Cancelling Wireless Bluetooth High Resolution Audio Over-Ear Headphones", "Sony", [["johnlewis.com", 21900, "new"]], ["headphones"]),
  prod("YDHU1Hw", "Sony WH-CH720 Noise Cancelling Bluetooth Wireless Over-Ear Headphones", "Sony", [["currys.co.uk", 6900, "new"]], ["headphones"]),
];
const MONITORS = [
  prod("nBPm6qY", 'MPG 34" 3440 x 1440 UWQHD Tandem QD-OLED 360Hz Gaming Monitor', "MSI", [["currys.co.uk", 99900, "new"]], ["monitors"]),
  prod("6bGlS6F", 'Odyssey G8 OLED 34" Quad HD Curved Gaming Monitor 175Hz', "Samsung", [["currys.co.uk", 104999, "new"]], ["monitors"]),
  prod("ChpkD0c", "34-inch VA Curved WQHD 180Hz Gaming Monitor", "Lenovo", [["currys.co.uk", 27900, "new"]], ["monitors"]),
];
const scene = (): Scene => ({
  size: [960, 720],
  things: [
    { thing: "overear headphones", bbox: [86, 117, 217, 253], categories: ["headphones"], matches: HEADPHONES },
    { thing: "computer monitor", bbox: [212, 74, 718, 322], categories: ["monitors"], matches: MONITORS },
  ],
});

describe("sameModel", () => {
  it("matches listings that share a model number and a brand", () => {
    expect(sameModel(HEADPHONES[0]!, HEADPHONES[1]!)).toBe(true);
    expect(sameModel(HEADPHONES[0]!, HEADPHONES[2]!)).toBe(false); // XM4C vs CH720
  });

  it("treats a sizes, refresh rates and storage as specs, not model numbers", () => {
    expect(sameModel(MONITORS[0]!, MONITORS[2]!)).toBe(false); // both 34 inch, different brands
    expect(sameModel(prod("a", "Gaming Monitor 27 inch 165Hz", "Acme", []), prod("b", "Office Monitor 27 inch 165Hz", "Acme", []))).toBe(false);
  });

  it("reads a name and a number as a model (iPhone 13), but a Pro or Max is a different product", () => {
    expect(sameModel(prod("a", "iPhone 13 128GB", "Apple", []), prod("b", "Apple iPhone 13 (Unlocked)", "Apple", []))).toBe(true);
    expect(sameModel(prod("a", "iPhone 13", "Apple", []), prod("b", "iPhone 13 Pro", "Apple", []))).toBe(false);
    expect(sameModel(prod("a", "Odyssey G8 OLED 34", "Samsung", []), prod("b", "Odyssey G9 OLED 34", "Samsung", []))).toBe(false);
  });

  it("never matches different brands", () => {
    expect(sameModel(prod("a", "Model X200 speaker", "Acme", []), prod("b", "Model X200 speaker", "Other", []))).toBe(false);
  });
});

describe("confirmMatch", () => {
  it("confirms a thing only when at least two listings agree on the model, and the kind fits", () => {
    expect(confirmMatch(scene().things[0]!)?.map((p) => p.id)).toEqual(["5jesTFu", "2sYIKEs"]);
    expect(confirmMatch(scene().things[1]!)).toBeNull();
  });

  it("only counts agreement among Channel3's best three listings (a 1st and 4th match is too weak)", () => {
    const pcs = [
      prod("BQX5U6f", "HP Omnidesk Slim S03", "HP", [["currys.co.uk", 34999]], ["desktop-computers"]),
      prod("OFsPb9I", "Alienware Area-51 Gaming Desktop", "Alienware", [["dell.com", 454902]], ["desktop-computers"]),
      prod("zKUqjuD", "HP Z8 Fury Desktop Computer", "HP", [["hp.com", 149999]], ["desktop-computers"]),
      prod("QiHekhk", "HP OmniDesk S03-0011na Slim Desktop PC", "HP", [["argos.co.uk", 42999]], ["desktop-computers"]),
    ];
    expect(confirmMatch({ thing: "desktop computer #1", bbox: null, categories: ["desktop-computers"], matches: pcs })).toBeNull();
  });

  it("but three listings of the model among the best eight do count (the live headphones came back 1st, 4th and 8th)", () => {
    const sony = (id: string, title: string) => prod(id, title, "Sony", [[`${id}.co.uk`, 21900, "new"]], ["headphones"]);
    const matches = [
      sony("a", "WH-1000XM4C Wireless Noise Cancelling Over-Ear Headphones with USB-C"),
      prod("b", "Wireless Headphones", "Typo", [["t.co.uk", 1000]], ["headphones"]),
      sony("c", "Sony WH-1000XM6 Wireless Noise Canceling Headphones"),
      sony("d", "WH-1000XM4C Noise Cancelling Wireless Bluetooth Headphones"),
      sony("e", "ULT Wear Wireless Bluetooth Headphones"),
      sony("f", "Sony WH-CH720 Over-Ear Headphones"),
      sony("g", "WH-1000XM6 Wireless Noise Cancelling Headphones"),
      sony("h", "WH-1000XM4C Noise Cancelling Wireless Headphones"),
    ];
    expect(confirmMatch({ thing: "over-ear headphones", bbox: null, categories: ["headphones"], matches })?.map((p) => p.id)).toEqual(["a", "d", "h"]);
    // Only two of them (1st and 4th) is not enough.
    expect(confirmMatch({ thing: "over-ear headphones", bbox: null, categories: ["headphones"], matches: matches.slice(0, 7) })).toBeNull();
  });

  it("refuses a confirmed model that is the wrong kind of thing for the box", () => {
    const t = { thing: "coffee mug", bbox: null, categories: ["mugs"], matches: HEADPHONES };
    expect(confirmMatch(t)).toBeNull();
  });

  it("falls back to the thing's words when there are no categories", () => {
    const strip = (p: Product): Product => ({ ...p, categories: undefined });
    expect(confirmMatch({ thing: "headphones #2", bbox: null, categories: [], matches: HEADPHONES.map(strip) })).not.toBeNull();
    expect(confirmMatch({ thing: "desk lamp", bbox: null, categories: [], matches: HEADPHONES.map(strip) })).toBeNull();
  });

  it("leaves out accessories unless the thing is one", () => {
    const cases = [prod("c1", "WH-1000XM4C replacement ear pads case", "Sony", [["x.co.uk", 900]], ["headphones"]), prod("c2", "WH-1000XM4C carry case", "Sony", [["y.co.uk", 1200]], ["headphones"])];
    expect(confirmMatch({ thing: "headphones", bbox: null, categories: ["headphones"], matches: cases })).toBeNull();
  });

  it("keeps a product that lists what comes with it (live title: 'Headphones with Mic/Remote')", () => {
    const withExtras = [
      HEADPHONES[0]!,
      prod("x", "WH-1000XM4C Noise Cancelling Wireless Bluetooth High Resolution Audio Over-Ear Headphones with Mic/Remote", "Sony", [["z.co.uk", 21900]], ["headphones"]),
    ];
    expect(confirmMatch({ thing: "over-ear headphones", bbox: null, categories: ["headphones"], matches: withExtras })).toHaveLength(2);
  });
});

describe("buildPhoto", () => {
  it("prices confirmed things from new offers when buying, and says plainly which it couldn't find", () => {
    const r = buildPhoto(scene(), "buy", "GBP", 4900);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ n: 1, thing: "Over ear headphones", found: true, low: 21900, high: 21999, typical: 21900, shops: 3, bbox: [86, 117, 217, 253] });
    expect(r.items[0]!.found && r.items[0]!.cheapest).toMatchObject({ domain: "currys.co.uk", price: 21900 });
    expect(r.items[1]).toMatchObject({ n: 2, thing: "Computer monitor", found: false });
    expect(r.total).toBe("Real shops: about £219 for the 1 thing Spotter could match. It couldn't find the other 1, so the real total is higher.");
    expect(r.quote).toBe("They're asking £49 for all of it.");
    expect(r.verdict).toMatch(/far below/);
  });

  it("writes the total for a whole set", () => {
    const s = scene();
    s.things = [s.things[0]!, { ...s.things[0]!, thing: "headphones" }];
    const r = buildPhoto(s, "buy", "GBP", null);
    expect(r.total).toBe("Real shops: about £438 for these.");
    expect(r.quote).toBeNull();
    expect(r.verdict).toBeNull();
  });

  it("lists the same kind of thing once, counted, with every box it was found in", () => {
    const s = scene();
    // Live (11 Oct 2026): the two curtains of one window came back as two "Patterned curtain" rows.
    s.things = [s.things[0]!, { ...s.things[0]!, thing: "Overear  Headphones ", bbox: [300, 117, 420, 253] }];
    const r = buildPhoto(s, "buy", "GBP", null);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ n: 1, thing: "Over ear headphones", count: 2, bbox: [86, 117, 217, 253], more: [[300, 117, 420, 253]] });
    // Both are still in the photo, so both count towards what real shops charge.
    expect(r.total).toBe("Real shops: about £438 for these.");
  });

  it("never merges a priced thing with an unpriced one of the same name", () => {
    const s = scene();
    s.things = [{ ...s.things[1]!, thing: "overear headphones" }, s.things[0]!];
    const r = buildPhoto(s, "buy", "GBP", null);
    expect(r.items.map((i) => [i.n, i.found, i.count])).toEqual([
      [1, false, undefined],
      [2, true, undefined],
    ]);
  });

  it("prices used offers when selling, and catches a lowball offer", () => {
    const used = (id: string, t: string, offers: Array<[string, number]>) => prod(id, t, "Sony", offers.map(([d, p]) => [d, p, "used"] as [string, number, Cond]), ["headphones"]);
    const s: Scene = {
      size: [960, 720],
      things: [{ thing: "headphones", bbox: null, categories: ["headphones"], matches: [used("u1", "Sony WH-1000XM4 headphones", [["resale.example", 12000]]), used("u2", "WH-1000XM4 Wireless Headphones", [["second.example", 15000]])] }],
    };
    const r = buildPhoto(s, "sell", "GBP", 4000);
    expect(r.items[0]).toMatchObject({ found: true, low: 12000, high: 15000 });
    expect(r.total).toBe("Used ones sell for about £120 to £150.");
    expect(r.quote).toBe("They offered £40.");
    expect(r.verdict).toMatch(/well under/);
  });

  it("never prices used offers as new, or new offers as used", () => {
    const s = scene();
    s.things = [{ ...s.things[0]!, matches: HEADPHONES.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o, condition: "used" as const })) })) }];
    expect(buildPhoto(s, "buy", "GBP", null).items[0]!.found).toBe(false);
    expect(buildPhoto(scene(), "sell", "GBP", null).items[0]!.found).toBe(false);
  });

  it("says when nothing could be matched, without a number", () => {
    const s = scene();
    s.things = [s.things[1]!];
    const r = buildPhoto(s, "buy", "GBP", 4900);
    expect(r.total).toBe("Spotter couldn't match any of these to real shop listings, so it can't say what they're worth.");
    expect(r.verdict).toBeNull();
  });

  it("the whole photo fallback names one closest match and never compares it with the price for everything", () => {
    const s: Scene = { size: null, fallback: true, things: [{ thing: "whole photo", bbox: null, categories: [], matches: HEADPHONES }] };
    const r = buildPhoto(s, "buy", "GBP", 4900);
    expect(r.total).toBe("Spotter could only search the photo as a whole. The closest match costs about £219 at real shops. The other things in the photo weren't checked.");
    expect(r.verdict).toBeNull();
    expect(r.quote).toBe("They're asking £49 for all of it.");
  });

  it("doesn't say 'well over' when Channel3 may have stopped at six things", () => {
    const s = scene();
    s.things = Array.from({ length: 6 }, () => s.things[0]!);
    expect(buildPhoto(s, "buy", "GBP", 900000).verdict).toBeNull();
  });

  it("only says 'well over' when every thing was matched", () => {
    expect(buildPhoto(scene(), "buy", "GBP", 90000).verdict).toBeNull();
    const s = scene();
    s.things = [s.things[0]!];
    expect(buildPhoto(s, "buy", "GBP", 90000).verdict).toMatch(/well over/);
  });
});

describe("similar ones (everyday things with no model number)", () => {
  // Shaped like the live answer for the example living room photo (11 Oct 2026): sofas of many makes, no model numbers.
  const sofa = (id: string, title: string, price: number) => prod(id, title, "Maker " + id, [[`${id}.co.uk`, price, "new"]], ["sofas", "furniture"]);
  const SOFAS = [
    sofa("s1", "Armitage Scatter Back Chenille 3 Seater Sofa", 48930),
    sofa("s2", "Newton Luxe Chenille Seater Sofa", 91920),
    sofa("s3", "2 Seater Sofa", 24900),
    sofa("s4", "Continuous Three Seat Sofa", 585400),
    sofa("s5", "Aspen Textured Faux Linen 3 Seater Sofa", 114900),
    sofa("s6", "Osaka sofa", 235900),
  ];
  const sofaThing = { thing: "blue sofa", bbox: [0, 439, 334, 854] as [number, number, number, number], categories: ["sofas"], matches: SOFAS };

  it("prices an everyday thing from similar listings of the same kind, says so, and gives the middle of the range", () => {
    const r = buildPhoto({ size: [1280, 854], things: [sofaThing] }, "buy", "GBP", null);
    const i = r.items[0]!;
    expect(i).toMatchObject({ found: true, match: "similar", offers: 6 });
    if (!i.found) throw new Error("not found");
    // The middle half of the listings, so one designer sofa can't stretch the range.
    expect(i.low).toBe(48930);
    expect(i.high).toBe(235900);
    expect(i.typical).toBe(103410);
    // The example shop is the cheapest inside the range shown, not the odd one below it.
    expect(i.cheapest).toMatchObject({ domain: "s1.co.uk", price: 48930 });
    expect(r.total).toBe("Similar ones at real shops: about £1,034 for these. These are similar things, not the exact ones in the photo.");
  });

  it("two listings of one model from the same shop aren't an exact match (live: a designer lamp and its twin)", () => {
    const lamp = (id: string, title: string, domain: string, price: number) => prod(id, title, "Maker", [[domain, price, "new"]], ["lamps"]);
    const matches = [
      lamp("l1", "Kaiser Idell 6580-F floor lamp", "designer.co.uk", 104900),
      lamp("l2", "Retro Task Floor Lamp", "a.co.uk", 9900),
      lamp("l3", "Kaiser Idell 6580-F Luxus floor lamp", "designer.co.uk", 104900),
      lamp("l4", "Finn Floor Lamp", "b.co.uk", 9900),
      lamp("l5", "Charlie Floor Lamp", "c.co.uk", 4399),
    ];
    const i = buildPhoto({ size: [100, 100], things: [{ thing: "white floor lamp", bbox: null, categories: ["lamps"], matches }] }, "buy", "GBP", null).items[0]!;
    expect(i).toMatchObject({ found: true, match: "similar", typical: 9900 });
  });

  it("cuts the designer tail like the market check does, so an everyday lamp isn't '£50 to £1,049' (live, 11 Oct)", () => {
    const lamp = (id: string, title: string, price: number) => prod(id, title, "Maker " + id, [[`${id}.co.uk`, price, "new"]], ["lamps"]);
    const matches = [
      lamp("a", "Traditional Arch Floor Lamp", 5000),
      lamp("b", "Retro Task Floor Lamp", 7900),
      lamp("c", "Finn Floor Lamp", 9900),
      lamp("d", "Charlie Floor Lamp", 12900),
      lamp("e", "Sculpted Brass Floor Lamp", 49900),
      lamp("f", "Arco Marble Floor Lamp", 89900),
      lamp("g", "Idell Floor Lamp", 104900),
      lamp("h", "Twin Arc Floor Lamp", 104900),
    ];
    const i = buildPhoto({ size: [100, 100], things: [{ thing: "floor lamp", bbox: null, categories: ["lamps"], matches }] }, "buy", "GBP", null).items[0]!;
    if (!i.found) throw new Error("not found");
    expect(i.match).toBe("similar");
    expect(i.high).toBeLessThan(20000);
    expect(i.low).toBe(5000);
    expect(i.offers).toBe(4);
  });

  it("keeps a confirmed model sold at one shop only (no similar ones to fall back on), as exact from one shop", () => {
    const one = HEADPHONES.slice(0, 2).map((p) => ({ ...p, offers: [{ ...p.offers[0]!, domain: "currys.co.uk" }] }));
    const i = buildPhoto({ size: [960, 720], things: [{ ...scene().things[0]!, matches: one }] }, "buy", "GBP", null).items[0]!;
    expect(i).toMatchObject({ found: true, match: "exact", shops: 1 });
  });

  it("an exact model match still wins, and is marked exact", () => {
    expect(buildPhoto(scene(), "buy", "GBP", null).items[0]).toMatchObject({ found: true, match: "exact" });
  });

  it("needs three listings of the right kind, so two odd matches price nothing", () => {
    expect(buildPhoto({ size: [1280, 854], things: [{ ...sofaThing, matches: SOFAS.slice(0, 2) }] }, "buy", "GBP", null).items[0]!.found).toBe(false);
    const wrongKind = SOFAS.map((p) => ({ ...p, categories: ["televisions"], title: p.title.replace(/sofa/i, "stand") }));
    expect(buildPhoto({ size: [1280, 854], things: [{ ...sofaThing, matches: wrongKind }] }, "buy", "GBP", null).items[0]!.found).toBe(false);
  });

  it("never prices model numbered things (monitors, TVs) from similar ones: there the exact model matters", () => {
    expect(confirmMatch(scene().things[1]!)).toBeNull();
    expect(buildPhoto(scene(), "buy", "GBP", null).items[1]!.found).toBe(false);
  });

  it("only says 'far below' against the low end of similar prices, and never 'well over'", () => {
    const s = { size: [1280, 854] as [number, number], things: [sofaThing] };
    expect(buildPhoto(s, "buy", "GBP", 4900).verdict).toMatch(/far below/);
    expect(buildPhoto(s, "buy", "GBP", 25000).verdict).toBeNull();
    expect(buildPhoto(s, "buy", "GBP", 900000).verdict).toBeNull();
  });

  it("writes 'over ear', not Channel3's 'overear'", () => {
    expect(buildPhoto(scene(), "buy", "GBP", null).items[0]!.thing).toBe("Over ear headphones");
  });
});

describe("parsing", () => {
  it("reads an amount in the family's currency", () => {
    expect(parseAmount("£49 for the whole room", "GBP")).toBe(4900);
    expect(parseAmount("they offered £1,250.50 for the lot", "GBP")).toBe(125050);
    expect(parseAmount("49", "GBP")).toBe(4900);
    expect(parseAmount("$40", "GBP")).toBeNull();
    expect(parseAmount("no money here", "GBP")).toBeNull();
    expect(parseAmount("£0", "GBP")).toBeNull();
    expect(parseAmount("", "GBP")).toBeNull();
  });

  it("reads a caption's amount only when it is clearly the price", () => {
    expect(captionAmount("2 chairs and a table for £40", "GBP")).toBe(4000);
    expect(captionAmount("iPhone 15, they want £300", "GBP")).toBe(30000);
    expect(captionAmount("I'm 72, he offered 40", "GBP")).toBe(4000);
    expect(captionAmount("asking 49 for the lot", "GBP")).toBe(4900);
    expect(captionAmount("49", "GBP")).toBe(4900);
    expect(captionAmount("3 lamps and 2 rugs", "GBP")).toBeNull();
    expect(captionAmount("iPhone 15 and 2 cases", "GBP")).toBeNull();
    expect(captionAmount(undefined, "GBP")).toBeNull();
  });

  it("works out buying or selling from a caption", () => {
    expect(photoMode("A man offered Gran £40 for all of this")).toBe("sell");
    expect(photoMode("Someone wants to buy my old stuff")).toBe("sell");
    expect(photoMode("Whole room set £49, collection only")).toBe("buy");
    expect(photoMode(undefined)).toBe("buy");
  });

  it("takes JPEG, PNG and WEBP pictures only, under the size limit", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(100)]);
    expect(imageFrom(jpeg)?.type).toBe("jpeg");
    expect(imageFrom(png)?.type).toBe("png");
    expect(imageFrom(webp)?.type).toBe("webp");
    expect(imageFrom(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(imageFrom(Buffer.from("GIF89a....."))).toBeNull();
    expect(imageFrom(Buffer.concat([jpeg, Buffer.alloc(5_000_000)]))).toBeNull();
    expect(imageFrom(Buffer.alloc(0))).toBeNull();
  });
});

describe("photoCheck", () => {
  let db: Db;
  let hh: string;
  let find: ReturnType<typeof vi.fn<PhotoDeps["find"]>>;
  let single: ReturnType<typeof vi.fn<PhotoDeps["single"]>>;
  let deps: PhotoDeps;
  const jpeg = (n = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 3)]);

  beforeEach(async () => {
    db = await pgliteDb();
    hh = (await createHousehold(db, { name: "T", spotterName: "Sam" })).id;
    find = vi.fn<PhotoDeps["find"]>(async () => scene());
    single = vi.fn<PhotoDeps["single"]>(async () => HEADPHONES);
    deps = { db, householdId: hh, find, single };
  });

  it("finds things in the photo with the right condition and builds the answer", async () => {
    const r = await photoCheck(deps, { bytes: jpeg(), mode: "sell", currency: "GBP", quoted: 4000 });
    expect(r.ok).toBe(true);
    expect(find).toHaveBeenCalledWith(jpeg().toString("base64"), "GBP", "used");
    expect(r.ok && r.result.items).toHaveLength(2);
  });

  it("falls back to one image search of the whole photo when finding things fails", async () => {
    find.mockResolvedValueOnce(null);
    const r = await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null });
    expect(single).toHaveBeenCalledWith({ base64: jpeg().toString("base64") }, "GBP", ["new"]);
    expect(r.ok && r.result.fallback).toBe(true);
    expect(r.ok && r.result.items).toEqual([expect.objectContaining({ n: 1, thing: "The whole photo", bbox: null, found: true })]);
  });

  it("says so when Channel3 can't be reached at all and caches nothing, but the attempt still counts (Channel3 may have charged)", async () => {
    find.mockResolvedValueOnce(null);
    single.mockResolvedValueOnce(null);
    const r = await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(await db.query("select 1 from photo_checks")).toHaveLength(1);
    expect(await db.query("select 1 from photo_cache")).toHaveLength(0);
  });

  it("keeps a paid answer when writing the cache fails", async () => {
    const flaky = { ...deps, db: { query: async (sql: string, params?: unknown[]) => (sql.includes("insert into photo_cache") ? Promise.reject(new Error("blip")) : db.query(sql, params)) } as Db };
    expect((await photoCheck(flaky, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null })).ok).toBe(true);
  });

  it("caches by picture hash and mode: the same photo costs one search", async () => {
    await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null });
    const again = await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: 9900 });
    expect(find).toHaveBeenCalledTimes(1);
    expect(again.ok && again.result.quote).toBe("They're asking £99 for all of it.");
    await photoCheck(deps, { bytes: jpeg(), mode: "sell", currency: "GBP", quoted: null });
    expect(find).toHaveBeenCalledTimes(2);
    expect(await db.query("select 1 from photo_checks")).toHaveLength(2);
  });

  it("caps photo checks per family per day and overall", async () => {
    deps.perHousehold = 1;
    expect((await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null })).ok).toBe(true);
    const r = await photoCheck(deps, { bytes: jpeg(300), mode: "buy", currency: "GBP", quoted: null });
    expect(r).toMatchObject({ ok: false, status: 429 });
    const other = (await createHousehold(db, { name: "U", spotterName: "Kim" })).id;
    const r2 = await photoCheck({ ...deps, householdId: other, perHousehold: 5, overall: 1 }, { bytes: jpeg(400), mode: "buy", currency: "GBP", quoted: null });
    expect(r2).toMatchObject({ ok: false, status: 429 });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("refuses something that isn't a picture before calling anyone", async () => {
    const r = await photoCheck(deps, { bytes: Buffer.from("<html>"), mode: "buy", currency: "GBP", quoted: null });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(find).not.toHaveBeenCalled();
  });

  it("treats a thrown search like an outage, never a crash", async () => {
    find.mockRejectedValueOnce(new Error("boom"));
    single.mockRejectedValueOnce(new Error("boom"));
    expect(await photoCheck(deps, { bytes: jpeg(), mode: "buy", currency: "GBP", quoted: null })).toMatchObject({ ok: false, status: 502 });
  });
});
