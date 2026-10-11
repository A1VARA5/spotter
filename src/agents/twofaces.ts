// "Two faces" (anti cloaking). Scam kits show a harmless page to scanners and datacentre visitors and the real trap
// only to real phones in the country they target. Spotter opens the same link at the same moment twice in KERNEL:
// once as a plain desktop (the usual visit) and once as Gran's phone (phone screen, phone browser, UK language and
// time zone, and a UK mobile network when the plan allows it). This file compares what the two visits saw.
// Pure code: no network, so it is tested on its own. Everything in a FaceSnap was written by the page: data only.
import { inflateSync } from "node:zlib";
import { getDomain } from "tldts";

export type FaceAsks = { card: boolean; bank: boolean; login: boolean; giftCard: boolean };
export type FaceSnap = {
  finalUrl: string;
  title: string;
  /** The text a person can see on the page (seen.ts), up to a few thousand characters. Undefined when that check failed. */
  text?: string;
  visibleChars: number;
  asks: FaceAsks;
  /** A 64 bin colour histogram of a tiny screenshot (palette()), when one was taken. */
  palette?: number[];
};
/** How the phone visit reached the page: through a UK mobile or home network, or straight from KERNEL's machine. */
export type PhoneNetwork = "uk_mobile" | "uk_residential" | "direct";
export type FaceDiff = {
  kind: "final_site" | "asks_money" | "asks_login" | "asks_gift_card" | "text" | "title" | "look";
  desktop: string;
  phone: string;
  /** Strong differences make the call; weak ones (title, picture) only support it. */
  strong: boolean;
};
export type FacesResult =
  | { compared: true; differs: boolean; verdict: string; differences: FaceDiff[]; textOverlap: number | null; lookSimilarity: number | null }
  | { compared: false; verdict: string };

const words = (s: string) => new Set((s.toLowerCase().match(/\p{L}{3,}/gu) ?? []).slice(0, 2000));

/**
 * How much of the shorter page's wording is also on the other page (0 to 1). Overlap of the smaller set, so a phone
 * layout that hides a menu still counts as the same page. Null when either side has too little text to judge.
 */
export function textOverlap(a: string, b: string): number | null {
  const x = words(a);
  const y = words(b);
  if (x.size < 5 || y.size < 5) return null;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

/** Histogram intersection of two palettes (1 = the same colours in the same amounts). */
export function lookSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < 64; i++) s += Math.min(a[i] ?? 0, b[i] ?? 0);
  return s;
}

/**
 * A 64 bin colour histogram (4 levels per channel) of an 8 bit, non interlaced RGB or RGBA PNG, which is what
 * Chrome's Page.captureScreenshot returns. Null for anything else, so a strange image is "no picture", not a guess.
 */
export function palette(buf: Buffer): number[] | null {
  try {
    if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    let w = 0;
    let h = 0;
    let type = -1;
    const idat: Buffer[] = [];
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const name = buf.toString("ascii", off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (name === "IHDR") {
        w = data.readUInt32BE(0);
        h = data.readUInt32BE(4);
        if (data[8] !== 8 || data[12] !== 0) return null;
        type = data[9]!;
      } else if (name === "IDAT") idat.push(data);
      else if (name === "IEND") break;
      off += 12 + len;
    }
    const bpp = type === 2 ? 3 : type === 6 ? 4 : 0;
    if (!bpp || !w || !h || w * h > 40_000) return null;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * bpp;
    if (raw.length < (stride + 1) * h) return null;
    const bins = new Array<number>(64).fill(0);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)]!;
      const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const add = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
        if (f > 4) return null;
        row[i] = (row[i]! + add) & 0xff;
      }
      for (let x = 0; x < w; x++) bins[(row[x * bpp]! >> 6) * 16 + (row[x * bpp + 1]! >> 6) * 4 + (row[x * bpp + 2]! >> 6)]!++;
      prev = row;
    }
    return bins.map((n) => n / (w * h));
  } catch {
    return null;
  }
}

const site = (u: string) => {
  try {
    const host = new URL(u).hostname;
    return getDomain(host) ?? host;
  } catch {
    return u.slice(0, 80);
  }
};

const moneyWords = (a: FaceAsks) => (a.card && a.bank ? "Asks for card and bank details" : a.card ? "Asks for card details" : a.bank ? "Asks for bank details" : "No card or bank form");

/** Compares the desktop visit with the phone visit. Either missing means "couldn't compare", never "the same". */
export function compareFaces(desktop: FaceSnap | null, phone: FaceSnap | null, network: PhoneNetwork): FacesResult {
  if (!desktop || !phone) {
    return { compared: false, verdict: "Spotter couldn't open it both ways, so it can't say whether this page hides from scanners." };
  }
  const differences: FaceDiff[] = [];
  const d = site(desktop.finalUrl);
  const p = site(phone.finalUrl);
  if (d !== p) differences.push({ kind: "final_site", desktop: d, phone: p, strong: true });

  const dMoney = desktop.asks.card || desktop.asks.bank;
  const pMoney = phone.asks.card || phone.asks.bank;
  if (dMoney !== pMoney || desktop.asks.card !== phone.asks.card || desktop.asks.bank !== phone.asks.bank) {
    differences.push({ kind: "asks_money", desktop: moneyWords(desktop.asks), phone: moneyWords(phone.asks), strong: true });
  }
  if (desktop.asks.login !== phone.asks.login) {
    differences.push({ kind: "asks_login", desktop: desktop.asks.login ? "Asks you to log in" : "No log in", phone: phone.asks.login ? "Asks you to log in" : "No log in", strong: true });
  }
  if (desktop.asks.giftCard !== phone.asks.giftCard) {
    differences.push({ kind: "asks_gift_card", desktop: desktop.asks.giftCard ? "Asks for a gift card" : "No gift card", phone: phone.asks.giftCard ? "Asks for a gift card" : "No gift card", strong: true });
  }

  // Text is only compared when both visits could read it: a check that failed is not a blank page.
  const textRead = desktop.text !== undefined && phone.text !== undefined;
  const overlap = textRead ? textOverlap(desktop.text!, phone.text!) : null;
  const blank = (f: FaceSnap) => words(f.text ?? "").size < 3;
  const chars = (f: FaceSnap) => (blank(f) ? "Almost no text" : `${f.visibleChars} characters of text`);
  if (textRead && blank(desktop) !== blank(phone)) differences.push({ kind: "text", desktop: chars(desktop), phone: chars(phone), strong: true });
  else if (overlap !== null && overlap < 0.6) {
    differences.push({ kind: "text", desktop: "Different wording", phone: `Only ${Math.round(overlap * 100)}% of the words match`, strong: overlap < 0.35 });
  }

  const titleOverlap = (() => {
    const x = words(desktop.title);
    const y = words(phone.title);
    if (!x.size || !y.size) return null;
    let both = 0;
    for (const w of x) if (y.has(w)) both++;
    return both / new Set([...x, ...y]).size;
  })();
  if (titleOverlap !== null && titleOverlap < 0.2) differences.push({ kind: "title", desktop: desktop.title.slice(0, 80), phone: phone.title.slice(0, 80), strong: false });

  const look = desktop.palette && phone.palette ? lookSimilarity(desktop.palette, phone.palette) : null;
  if (look !== null && look < 0.5) differences.push({ kind: "look", desktop: "One look", phone: `Only ${Math.round(look * 100)}% of the colours match`, strong: false });

  const differs = differences.some((x) => x.strong);
  // "The same" needs something to have been the same: wording on both pages, or a picture of both.
  if (!differs && overlap === null && look === null) {
    return { compared: false, verdict: "Spotter opened it both ways, but there wasn't enough on the pages to say whether they match." };
  }
  const who = network === "direct" ? "phones" : "phones in the UK";
  const why = !dMoney && pMoney ? `: only the phone was asked for ${moneyWords(phone.asks).replace("Asks for ", "")}` : d !== p ? `: the phone was sent on to ${p}` : "";
  const verdict = differs
    ? `This page shows something different to ${who} than to security scanners${why}.`
    : `The page looked the same on ${network === "direct" ? "a phone" : "a UK phone"} and on a desktop scanner.`;
  return { compared: true, differs, verdict, differences, textOverlap: overlap, lookSimilarity: look };
}
