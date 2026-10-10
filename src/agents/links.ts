// Link forensics for the case agent, ported from my earlier project Red Flag (src/lib/links.ts). Deterministic:
// address tricks, borrowed brand names, look-alike domains, redirects (followed with HEAD only, through a lookup that
// refuses private addresses) and domain age from RDAP. Red Flag's paid scanners and blocklist feeds are left out.
import { parse } from "tldts";
import { domainToUnicode } from "node:url";
import { lookup } from "node:dns/promises";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as guardedFetch } from "undici";
import { BlockList, isIP } from "node:net";
import brands from "@/data/brands.json";

export type Severity = "high" | "medium" | "low" | "info";
export type LinkFlag = { code: string; severity: Severity; detail: string };

export type LinkReport = {
  input: string;
  url: string;
  host: string;
  domain: string | null;
  finalUrl: string | null;
  hops: string[];
  ageDays: number | null;
  registered: string | null;
  brand: string | null;
  official: boolean;
  flags: LinkFlag[];
};

type Brand = { brand: string; domains: string[]; keywords: string[] };
const BRANDS = brands as Brand[];

const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "tiny.cc",
  "bl.ink",
  "lnkd.in",
  "s.id",
  "v.gd",
  "qrco.de",
  "shorturl.gg",
  "urlz.fr",
  "surl.li",
]);

// TLDs that show up far more in phishing than in real brand mail. Weak signal on its own.
const RISKY_TLDS = new Set([
  "top",
  "xyz",
  "icu",
  "cfd",
  "sbs",
  "click",
  "live",
  "shop",
  "rest",
  "bond",
  "cyou",
  "buzz",
  "monster",
  "quest",
  "zip",
  "mov",
  "lol",
  "online",
  "site",
  "support",
  "help",
  "vip",
  "win",
  "loan",
  "work",
  "gq",
  "tk",
  "ml",
  "cf",
  "ga",
]);

// Characters people use to fake letters. Folded before comparing against brand names.
const CONFUSABLE: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  $: "s",
  "@": "a",
  "|": "l",
  "!": "i",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ј: "j",
  ԁ: "d",
  ɡ: "g",
  ո: "n",
  ӏ: "l",
  ѕ: "s",
  ԛ: "q",
  ԝ: "w",
  ı: "i",
  ł: "l",
  ö: "o",
  ü: "u",
  é: "e",
  á: "a",
};

function skeleton(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) out += CONFUSABLE[ch] ?? ch;
  return out
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/cl/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp!;
    }
  }
  return row[b.length]!;
}

// Finds links in a message, including defanged ones (hxxps://, [.], (dot)) and bare domains.
export function extractUrls(text: string): string[] {
  const refanged = text
    .replace(/hxxp/gi, "http")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\s?\[dot\]\s?|\s?\(dot\)\s?/gi, ".")
    .replace(/\[:\]/g, ":");
  const found = new Set<string>();
  const withScheme = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
  for (const m of refanged.matchAll(withScheme)) found.add(trimUrl(m[0]));
  // Unicode letters too, so a look-alike like "аррle.com" (Cyrillic) is read whole, not as "le.com".
  // A capitalised ending (Secure-PayPal.Com) needs a path or a hyphen, so "phone.New number" (a missing space) is not a link.
  const bare =
    /(?<![\p{L}\p{N}-])(?:[\p{L}\p{N}-]+\.)+(?:[a-z]{2,24}|[A-Z]{2,24}|[A-Z][a-z]{1,23})(?![\p{L}\p{N}])(?:\/[^\s<>"'`)\]]*)?/gu;
  const stripped = refanged.replace(withScheme, " ");
  for (const m of stripped.matchAll(bare)) {
    const candidate = trimUrl(m[0]);
    const [host = "", ...path] = candidate.split("/");
    const p = parse(host.toLowerCase());
    // Only keep bare tokens that end in a real public suffix, so "e.g" and "file.txt" stay out.
    if (
      !p.domain ||
      !p.isIcann ||
      /\.(txt|png|jpe?g|pdf|docx?|zip|exe)$/i.test(candidate)
    )
      continue;
    // An all capitals ending only counts when the whole address is in capitals (WWW.EXAMPLE.COM).
    if (/[A-Z]$/.test(host) && /[a-z]/.test(host)) continue;
    const label = (p.domainWithoutSuffix ?? "").toLowerCase();
    if (/\.[A-Z][a-z]+$/.test(host) && !path.length && !/[-\d]/.test(label))
      continue;
    // Endings that are also everyday words (.live, .love, .fun, .me) need something link-like around them.
    // On the cheap endings scammers use, a name of four letters or more is enough (hmrc.help, but not fun.live).
    const risky = RISKY_TLDS.has(p.publicSuffix ?? "") && label.length >= 4;
    const linkLike =
      risky ||
      /^www\./i.test(host) ||
      path.length > 0 ||
      /[-\d]/.test(label) ||
      COMMON_TLDS.has(p.publicSuffix ?? "") ||
      host.split(".").length > 2;
    if (linkLike) found.add("https://" + candidate);
  }
  // Scammers pad messages with decoy links. With more than MAX_LINKS, the most suspicious looking ones are
  // checked first (no brand's real domain, cheap ending, a brand name, hyphens, encoded letters).
  const all = [...found];
  if (all.length <= MAX_LINKS) return all;
  const keep = new Set(
    all
      .map((u, i) => ({ u, i, s: suspicion(u) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, MAX_LINKS)
      .map((x) => x.u),
  );
  return all.filter((u) => keep.has(u));
}

// Common endings that are rarely an ordinary word, so a bare "name.com" counts as a link on its own.
const COMMON_TLDS = new Set([
  "com",
  "net",
  "org",
  "info",
  "biz",
  "io",
  "co",
  "co.uk",
  "org.uk",
  "uk",
  "us",
  "eu",
  "de",
  "fr",
  "nl",
  "es",
  "lt",
  "pl",
  "ie",
  "ca",
  "au",
  "ru",
  "cn",
  "xyz",
  "top",
  "shop",
  "site",
  "online",
  "click",
  "store",
  "app",
  "dev",
  "ly",
  "gd",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "icu",
  "cyou",
  "buzz",
  "sbs",
  "rest",
  "bond",
]);

function suspicion(u: string): number {
  if (isOfficialUrl(u)) return 0;
  let host = "";
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return 1;
  }
  const p = parse(host);
  let s = 1;
  if (p.publicSuffix && RISKY_TLDS.has(p.publicSuffix)) s += 2;
  if (host.includes("xn--")) s += 3;
  if ((p.domainWithoutSuffix ?? "").includes("-")) s += 1;
  if (
    BRANDS.some((b) =>
      b.keywords.some((k) => k.length > 3 && host.includes(k.toLowerCase())),
    )
  )
    s += 3;
  return s;
}

export const MAX_LINKS = 12;

function isOfficialUrl(u: string) {
  try {
    const host = new URL(u).hostname.toLowerCase().replace(/\.$/, "");
    return BRANDS.some((b) =>
      b.domains.some((d) => host === d || host.endsWith("." + d)),
    );
  } catch {
    return false;
  }
}

function trimUrl(u: string) {
  return u.replace(/[.,;:!?)'"\]]+$/, "");
}

const GLUE = new Set(
  [
    "my",
    "parcel",
    "parcels",
    "delivery",
    "redelivery",
    "deliveries",
    "refund",
    "refunds",
    "fine",
    "fines",
    "pay",
    "payment",
    "payments",
    "secure",
    "security",
    "login",
    "signin",
    "verify",
    "verification",
    "support",
    "help",
    "account",
    "accounts",
    "track",
    "tracking",
    "uk",
    "gov",
    "tax",
    "online",
    "service",
    "services",
    "update",
    "billing",
    "alert",
    "claim",
    "post",
    "fee",
    "fees",
    "customs",
  ].map(skeleton),
);

export const brandOfHost = (host: string) =>
  brandFor(host, parse(host).domain ?? null).brand?.brand ?? null;

function brandFor(
  host: string,
  domain: string | null,
): { brand: Brand | null; official: boolean; flags: LinkFlag[] } {
  const flags: LinkFlag[] = [];
  const lowHost = host.toLowerCase();
  for (const b of BRANDS) {
    if (b.domains.some((d) => lowHost === d || lowHost.endsWith("." + d)))
      return { brand: b, official: true, flags };
  }
  if (!domain) return { brand: null, official: false, flags };
  const label = domain.split(".")[0]!;
  const skel = skeleton(label);
  // Brand names must start at a word boundary: "royal-mail-fees.com" and "secure-paypal.net" match,
  // "purchase.com" does not match "chase" and "pineapple.com" does not match "apple".
  const tokens = lowHost
    .split(/[.\-_]/)
    .filter(Boolean)
    .map(skeleton);
  const starts = tokens.map((_, i) => tokens.slice(i).join(""));
  for (const b of BRANDS) {
    for (const kw of b.keywords) {
      const k = skeleton(kw);
      if (k.length < 3) continue;
      // Short names (ups, meta, apple) must be a whole word, or "metal.com" and "applebees.com" would match,
      // unless they're glued to a word scams use (evriparcel, hmrcrefund, parcelevri).
      const glued = (t: string) =>
        (t.startsWith(k) && GLUE.has(t.slice(k.length))) ||
        (t.endsWith(k) && GLUE.has(t.slice(0, -k.length)));
      const hit =
        k.length <= 5
          ? tokens.includes(k) || tokens.some(glued)
          : starts.some((s) => s.startsWith(k));
      if (hit) {
        flags.push({
          code: "brand-not-official",
          severity: "high",
          detail: `Uses the name "${b.brand}" but ${domain} is not one of ${b.brand}'s real domains (${b.domains.slice(0, 3).join(", ")}).`,
        });
        return { brand: b, official: false, flags };
      }
    }
    for (const d of b.domains) {
      const realLabel = skeleton(d.split(".")[0]!);
      if (
        realLabel.length >= 5 &&
        skel !== realLabel &&
        levenshtein(skel, realLabel) <= (realLabel.length >= 8 ? 2 : 1)
      ) {
        flags.push({
          code: "lookalike-domain",
          severity: "high",
          detail: `${domain} is one or two letters off ${d}. That is how fake sites hide.`,
        });
        return { brand: b, official: false, flags };
      }
    }
  }
  return { brand: null, official: false, flags };
}

// Private, local and carrier ranges. BlockList also matches IPv4 written as IPv6 (::ffff:7f00:1 is 127.0.0.1).
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

// Refuses hosts that resolve to a private or local address, so a link can't be used to probe our own network.
async function safeToFetch(host: string): Promise<boolean> {
  host = host.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return false;
  if (isIP(host)) return !isPrivate(host);
  // The timer only exists for a real lookup, and is always cleared, so it can't reject with nobody listening.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("dns timeout")), 3000);
    });
    const ips = (await Promise.race([lookup(host, { all: true }), timeout])).map((a) => a.address);
    return ips.length > 0 && ips.every((ip) => !isPrivate(ip));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const isPrivate = (ip: string) =>
  PRIVATE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

// The check above and the connection would each look the name up. A DNS server that answers a public address
// first and a private one second (DNS rebinding) would slip between them, so the connection itself only uses
// addresses that pass the same check, from the lookup it actually connects with.
export function guardedLookup(
  hostname: string,
  opts: { all?: boolean; family?: number } | null,
  cb: (
    err: Error | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) {
  dnsLookup(
    hostname,
    { all: true, family: opts?.family ?? 0 },
    (err, addrs) => {
      if (err) return cb(err, []);
      if (!addrs.length || addrs.some((a) => isPrivate(a.address)))
        return cb(
          Object.assign(new Error(`${hostname} points at a private address`), {
            code: "EPRIVATE",
          }),
          [],
        );
      // Node asks for every address when it races IPv4 and IPv6 (autoSelectFamily), otherwise for one.
      if (opts?.all) cb(null, addrs);
      else cb(null, addrs[0]!.address, addrs[0]!.family);
    },
  );
}
const guarded = new Agent({ connect: { lookup: guardedLookup as never } });

// Follows redirects by hand with HEAD (then GET if refused), never reads bodies, max 5 hops.
async function unwrap(
  url: string,
): Promise<{ finalUrl: string | null; hops: string[]; error: string | null }> {
  const hops: string[] = [];
  let current = url;
  // A site that answers each hop slowly must not use up the whole time budget, so the walk has its own limit.
  const deadline = Date.now() + 8000;
  for (let i = 0; i < 5; i++) {
    if (Date.now() > deadline)
      return { finalUrl: current, hops, error: "too slow" };
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return { finalUrl: null, hops, error: "bad url" };
    }
    if (!(await safeToFetch(u.hostname)))
      return { finalUrl: current, hops, error: "host not resolvable" };
    let res: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      res = await guardedFetch(current, {
        dispatcher: guarded,
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(3500),
        headers: { "user-agent": "Mozilla/5.0 (Spotter link check)" },
      });
      if (res.status === 405 || res.status === 403) {
        res = await guardedFetch(current, {
          dispatcher: guarded,
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(3500),
          headers: { "user-agent": "Mozilla/5.0 (Spotter link check)" },
        });
        res.body?.cancel().catch(() => {});
      }
    } catch {
      return {
        finalUrl: current,
        hops,
        error: i === 0 ? "site did not answer" : null,
      };
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return { finalUrl: current, hops, error: "bad redirect" };
      }
      hops.push(next);
      current = next;
      continue;
    }
    return { finalUrl: current, hops, error: null };
  }
  return { finalUrl: current, hops, error: "too many redirects" };
}

// Domain registration date from RDAP (the modern WHOIS), asked straight from the registry for that ending.
// IANA publishes which registry serves which TLD; the rdap.org proxy refuses server requests, so we skip it.
let bootstrap: { at: number; map: Map<string, string> } | null = null;
async function rdapBase(tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > 86_400_000) {
    try {
      const res = await fetch("https://data.iana.org/rdap/dns.json", {
        signal: AbortSignal.timeout(5000),
      });
      const data = (await res.json()) as { services: [string[], string[]][] };
      const map = new Map<string, string>();
      for (const [tlds, urls] of data.services)
        for (const t of tlds)
          map.set(t, urls.find((u) => u.startsWith("https")) ?? urls[0]!);
      bootstrap = { at: Date.now(), map };
    } catch {
      return null;
    }
  }
  return bootstrap.map.get(tld) ?? null;
}

async function domainAge(
  domain: string,
): Promise<{ ageDays: number | null; registered: string | null }> {
  try {
    const base = await rdapBase(domain.split(".").pop()!);
    if (!base) return { ageDays: null, registered: null };
    const res = await fetch(
      `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`,
      {
        signal: AbortSignal.timeout(4000),
        headers: {
          accept: "application/rdap+json",
          "user-agent": "Spotter/1.0 (+https://spotter-pay.vercel.app)",
        },
      },
    );
    if (!res.ok) return { ageDays: null, registered: null };
    const data = (await res.json()) as {
      events?: { eventAction: string; eventDate: string }[];
    };
    const reg = data.events?.find(
      (e) => e.eventAction === "registration",
    )?.eventDate;
    if (!reg) return { ageDays: null, registered: null };
    return {
      ageDays: Math.floor((Date.now() - Date.parse(reg)) / 86_400_000),
      registered: reg.slice(0, 10),
    };
  } catch {
    return { ageDays: null, registered: null };
  }
}

// What can be told from the address alone, with no network: tricks in the address and a borrowed brand name.
// These never depend on a site answering, so a slow site can't make them disappear.
function addressChecks(url: URL) {
  const flags: LinkFlag[] = [];
  // "evil.com." is the same site as evil.com, so the trailing dot goes before any comparison.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const unicodeHost = domainToUnicode(host);
  if (host.startsWith("xn--") || host.includes(".xn--")) {
    flags.push({
      code: "punycode",
      severity: "high",
      detail: `The address is encoded (${host}) and displays as "${unicodeHost}". Look-alike letters from other alphabets.`,
    });
  }
  if (isIP(host))
    flags.push({
      code: "raw-ip",
      severity: "high",
      detail:
        "Link goes to a bare IP address, not a named website. Real companies do not do this.",
    });
  if (
    url.username ||
    url.password ||
    /@/.test(
      url.href
        .split("?")[0]!
        .replace(/^https?:\/\//, "")
        .split("/")[0]!,
    )
  ) {
    flags.push({
      code: "userinfo-trick",
      severity: "high",
      detail: 'The link hides its real destination after an "@" sign.',
    });
  }
  if (url.protocol === "http:")
    flags.push({
      code: "no-https",
      severity: "low",
      detail: "Not encrypted (http, not https).",
    });

  const p = parse(host);
  const domain = p.domain ?? null;
  if (p.publicSuffix && RISKY_TLDS.has(p.publicSuffix)) {
    flags.push({
      code: "risky-tld",
      severity: "medium",
      detail: `Ends in .${p.publicSuffix}, a cheap ending scammers use a lot.`,
    });
  }
  if ((p.subdomain ?? "").split(".").length >= 3) {
    flags.push({
      code: "deep-subdomain",
      severity: "medium",
      detail: `Long chain of subdomains (${host}). Often used to push a brand name to the front.`,
    });
  }
  const isShort = domain
    ? SHORTENERS.has(domain) || SHORTENERS.has(host)
    : false;
  if (isShort)
    flags.push({
      code: "shortener",
      severity: "medium",
      detail: `Shortened link (${host}) hides where it really goes.`,
    });
  const brand = brandFor(host, domain);
  flags.push(...brand.flags);
  return { host, domain, isShort, brand, flags };
}

// A look-alike name on a domain that has existed for years (model.com vs Yodel, post.de vs bpost) is a coincidence,
// not a fresh fake. Keep the note, drop the alarm. New and young domains are flagged unless they are a brand's own.
function ageFlags(
  flags: LinkFlag[],
  age: { ageDays: number | null; registered: string | null },
  official: boolean,
  host: string,
  named: boolean,
) {
  if (age.ageDays === null) return;
  if (age.ageDays > 3 * 365) {
    for (const f of flags) {
      if (f.code === "lookalike-domain") {
        f.severity = "low";
        f.detail = `${f.detail.replace(" That is how fake sites hide.", "")} But this domain has existed since ${age.registered?.slice(0, 4)}, so it is probably just a similar name.`;
      }
    }
  }
  if (official) return;
  const which = named ? `${host} was registered` : "Registered";
  if (age.ageDays < 30)
    flags.push({
      code: "new-domain",
      severity: "high",
      detail: `${which} ${age.ageDays} days ago (${age.registered}). Real companies' sites are years old.`,
    });
  else if (age.ageDays < 180)
    flags.push({
      code: "young-domain",
      severity: "medium",
      detail: `${which} ${age.ageDays} days ago (${age.registered}).`,
    });
}

const noAge = { ageDays: null, registered: null };

export async function inspectUrl(input: string): Promise<LinkReport> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      input,
      url: input,
      host: "",
      domain: null,
      finalUrl: null,
      hops: [],
      ageDays: null,
      registered: null,
      brand: null,
      official: false,
      flags: [
        {
          code: "unparseable",
          severity: "low",
          detail: "Could not read this link.",
        },
      ],
    };
  }
  const { host, domain, isShort, brand: start, flags } = addressChecks(url);

  const [{ finalUrl, hops, error }, age] = await Promise.all([
    unwrap(url.toString()),
    domain ? domainAge(domain) : Promise.resolve(noAge),
  ]);

  let finalHost = host;
  let finalDomain = domain;
  if (finalUrl && finalUrl !== url.toString()) {
    try {
      finalHost = new URL(finalUrl).hostname.toLowerCase().replace(/\.$/, "");
      finalDomain = parse(finalHost).domain ?? null;
      if (finalDomain && finalDomain !== domain)
        flags.push({
          code: "redirects-elsewhere",
          severity: isShort ? "info" : "low",
          detail: `Redirects to a different site: ${finalHost}.`,
        });
    } catch {}
  }
  // A check that couldn't run must say so, or "no flags" would read as "nothing wrong".
  if (error && error !== "host not resolvable")
    flags.push({ code: "unchecked", severity: "low", detail: `Couldn't follow where this link leads (${error}).` });
  if (domain && age.ageDays === null && !start.official)
    flags.push({ code: "age-unknown", severity: "low", detail: `Couldn't check how old ${domain} is.` });
  if (error === "host not resolvable")
    flags.push({
      code: "dead-domain",
      severity: "low",
      detail:
        "This address doesn't load right now. Scam sites are often taken down within days, but it could also just be offline.",
    });

  // Both ends of a redirect are judged. A scam domain that forwards to the real paypal.com (often only for
  // checkers like this one) is still a scam domain, so only a brand's own address, or a shortener that
  // leads to one, counts as official.
  const moved = finalDomain !== domain && finalDomain !== null;
  const end = moved ? brandFor(finalHost, finalDomain) : start;
  const official = start.official || (isShort && end.official);
  ageFlags(flags, age, start.official, host, moved);
  if (moved) {
    const endFlags = [...end.flags];
    ageFlags(
      endFlags,
      await domainAge(finalDomain!),
      end.official,
      finalHost,
      true,
    );
    flags.push(...endFlags);
  }
  const b = start.brand ? start : end;

  if (official && flags.every((f) => f.severity !== "high")) {
    flags.push({
      code: "official-domain",
      severity: "info",
      detail: `${finalHost} really belongs to ${b.brand?.brand}.`,
    });
  }

  return {
    input,
    url: url.toString(),
    host,
    domain,
    finalUrl,
    hops,
    ageDays: age.ageDays,
    registered: age.registered,
    brand: b.brand?.brand ?? null,
    official,
    flags,
  };
}

// A slow or stalling site must not hold up the case, so each link gets a fixed time budget. When it runs out,
// the address checks still count; only the checks that needed the site are skipped.
const LINK_BUDGET_MS = 9_000;

export function inspectWithBudget(u: string): Promise<LinkReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<LinkReport>((resolve) => {
    timer = setTimeout(() => {
      let url: URL;
      try {
        url = new URL(u);
      } catch {
        return resolve({
          input: u,
          url: u,
          host: "",
          domain: null,
          finalUrl: null,
          hops: [],
          ageDays: null,
          registered: null,
          brand: null,
          official: false,
          flags: [
            {
              code: "unparseable",
              severity: "low",
              detail: "Could not read this link.",
            },
          ],
        });
      }
      const { host, domain, brand, flags } = addressChecks(url);
      flags.push({
        code: "slow",
        severity: "low",
        detail:
          "This site was too slow to check in time, so some checks were skipped.",
      });
      resolve({
        input: u,
        url: url.toString(),
        host,
        domain,
        finalUrl: null,
        hops: [],
        ageDays: null,
        registered: null,
        brand: brand.brand?.brand ?? null,
        official: brand.official,
        flags,
      });
    }, LINK_BUDGET_MS);
  });
  return Promise.race([inspectUrl(u), slow]).finally(() => clearTimeout(timer));
}
