// /api/health and /status: is each part of Spotter working right now, in plain words.
// Public, so it is built to be boring to abuse: every answer is cached for a minute (one probe run per server
// instance per minute, however many people ask), each address gets a few asks a minute, and the only outside calls
// are free ones (a PayPal sandbox token, which is cached for hours anyway, and Anthropic's model list per key slot).
// It never runs a Claude completion. Nothing in the answer comes from an error: no keys, no ids, no error bodies.
// Failures are logged with the error's class name only, since some providers quote part of the key in messages.
import type { Db } from "@/db";

export type Status = "ok" | "degraded" | "down" | "off";
export type AiSlot = "primary" | "backup" | "openai_backup" | "none";
export type KeyProbe = "ok" | "rejected" | "unreachable";

export type Check = {
  id: "database" | "paypal" | "ai" | "kernel" | "channel3" | "webhooks";
  name: string;
  status: Status;
  /** One plain sentence for the status page. */
  summary: string;
  /** When this part last did its job for real (ISO), when Spotter keeps a record of it. */
  lastSuccessAt?: string | null;
  /** What lastSuccessAt counts, for the page: "Last visit", "Last event". */
  lastLabel?: string;
  slot?: AiSlot;
  watchCheckedAt?: string | null;
};

export type HealthReport = {
  status: Exclude<Status, "off">;
  checkedAt: string;
  /** Seconds this answer is reused for. */
  cachedFor: number;
  checks: Check[];
};

export type HealthDeps = {
  db: () => Promise<Db>;
  env: Record<string, string | undefined>;
  paypalToken: () => Promise<string>;
  /** Is this Anthropic key usable? A free call (the model list), never a completion. */
  claudeKey: (slot: "primary" | "backup", key: string) => Promise<KeyProbe>;
  /** This server instance set the primary key aside after it failed. */
  primaryOut: () => boolean;
  log?: Pick<Console, "error">;
  /** Longest any one database step may take before it counts as down. */
  timeoutMs?: number;
};

export const CACHE_MS = 60_000;
const STEP_MS = 4_000;

class HealthTimeout extends Error {
  name = "HealthTimeout";
}
/** A step that hangs (a stuck connection) must not hold every later caller on the shared run. */
function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new HealthTimeout()), ms)))]).finally(() => clearTimeout(timer));
}
const CORE = new Set(["database", "paypal", "ai"]);

export function overallStatus(checks: Array<{ id: string; status: Status }>): HealthReport["status"] {
  if (checks.some((c) => c.status === "down" && CORE.has(c.id))) return "down";
  return checks.every((c) => c.status === "ok") ? "ok" : "degraded";
}

const has = (env: HealthDeps["env"], name: string) => !!env[name]?.trim();
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** The class name only: some providers put part of the key or their response body in the message. */
const kind = (e: unknown) => (e instanceof Error ? e.name : typeof e);

async function first<T>(db: Db, sql: string): Promise<T | undefined> {
  return (await db.query<T>(sql))[0];
}

/** Runs every check once. Each one fails on its own, so one dead part never hides the others. */
export async function probeHealth(deps: HealthDeps, now = Date.now()): Promise<HealthReport> {
  const { env } = deps;
  const log = deps.log ?? console;
  const failed = (what: string, e: unknown) => log.error(`[spotter] health: ${what} failed (${kind(e)})`);
  const stepMs = deps.timeoutMs ?? STEP_MS;

  let db: Db | null = null;
  const database = async (): Promise<Check> => {
    const base = { id: "database", name: "Database" } as const;
    try {
      const opened = await within(stepMs, deps.db());
      await within(stepMs, opened.query("select 1"));
      db = opened;
      return { ...base, status: "ok", summary: "The database is answering." };
    } catch (e) {
      db = null;
      failed("database", e);
      return { ...base, status: "down", summary: "The database isn't answering, so nothing new can be checked or saved." };
    }
  };

  const paypal = async (): Promise<Check> => {
    const base = { id: "paypal", name: "PayPal sandbox" } as const;
    if (!has(env, "PAYPAL_CLIENT_ID") || !has(env, "PAYPAL_CLIENT_SECRET")) {
      return { ...base, status: "down", summary: "PayPal sandbox isn't set up on this server, so no money can be held." };
    }
    try {
      await deps.paypalToken();
      // The token is cached for hours, so this says the last sign in worked, not that PayPal answered this second.
      return { ...base, status: "ok", summary: "Signed in to the PayPal sandbox. Holds, payments and releases can go through." };
    } catch (e) {
      failed("paypal token", e);
      return { ...base, status: "down", summary: "Spotter can't sign in to the PayPal sandbox right now, so no money can be held or released." };
    }
  };

  const ai = async (): Promise<Check> => {
    const base = { id: "ai", name: "AI check" } as const;
    const probe = async (slot: "primary" | "backup", name: string): Promise<KeyProbe | "missing"> => {
      const key = env[name]?.trim();
      if (!key) return "missing";
      let result: KeyProbe;
      try {
        result = await deps.claudeKey(slot, key);
      } catch (e) {
        failed(`anthropic ${slot} key`, e);
        return "unreachable";
      }
      if (result !== "ok") log.error(`[spotter] health: anthropic ${slot} key ${result}`);
      return result;
    };
    const [primary, backup] = await Promise.all([probe("primary", "ANTHROPIC_API_KEY"), probe("backup", "ANTHROPIC_API_KEY_BACKUP")]);
    const out = deps.primaryOut();
    if (primary === "ok" && !out) {
      return { ...base, status: "ok", slot: "primary", summary: "The AI check is up on its main key." };
    }
    const why =
      primary === "missing"
        ? "there's no main key on this server"
        : primary === "rejected"
          ? "the main key was turned down"
          : primary === "unreachable"
            ? "Anthropic didn't answer on the main key"
            : "this server set the main key aside after it failed a few minutes ago";
    if (backup === "ok") {
      return { ...base, status: "degraded", slot: "backup", summary: `The AI check is on the backup key, because ${why}. Checks work the same.` };
    }
    if (has(env, "OPENAI_API_KEY")) {
      return {
        ...base,
        status: "degraded",
        slot: "openai_backup",
        summary: `No Claude key works (${why}), so the scam check runs on the backup model, which is set up but not checked live. Anything it checks waits for a person to say yes.`,
      };
    }
    return { ...base, status: "down", slot: "none", summary: "The AI check is down. Payments still stop and wait for a person, with Deny first." };
  };

  const [dbCheck, paypalCheck, aiCheck] = await Promise.all([database(), paypal(), ai()]);

  // The rest read Spotter's own records, so they need the database.
  const read = async <T,>(what: string, sql: string): Promise<T | undefined | "failed"> => {
    if (!db) return "failed";
    try {
      return await within(stepMs, first<T>(db, sql));
    } catch (e) {
      failed(what, e);
      return "failed";
    }
  };

  const kernelRow = await read<{ at: unknown }>(
    "kernel record",
    `select greatest(
       (select max(e.at) from events e join payments p on p.id = e.payment_id
         where e.type = 'case_built' and p.case_file -> 'page' is not null and coalesce(p.case_file ->> 'example', 'false') <> 'true'),
       (select max(last_frame_at) from peeks)
     ) as at`,
  );
  const kernel: Check = { id: "kernel", name: "KERNEL cloud browser", lastLabel: "Last page visit", status: "ok", summary: "" };
  kernel.lastSuccessAt = kernelRow === "failed" ? null : iso(kernelRow?.at);
  if (!has(env, "KERNEL_API_KEY")) {
    kernel.status = "off";
    kernel.summary = "KERNEL isn't set up here, so suspicious links aren't opened for you.";
  } else {
    kernel.summary = "Ready to open a suspicious link in a throwaway browser, so nobody in the family has to click it.";
  }

  const c3Row = await read<{ search_at: unknown; watch_at: unknown; watch_down_at: unknown }>(
    "channel3 record",
    `select greatest(
       (select max(fetched_at) from market_cache),
       (select max(fetched_at) from image_search_cache),
       (select max(fetched_at) from photo_cache),
       (select max(last_checked_at) from shared_watches)
     ) as search_at,
     (select last_checked_at from shared_watches where key = 'demo') as watch_at,
     (select unreachable_at from shared_watches where key = 'demo') as watch_down_at`,
  );
  const c3 = c3Row === "failed" ? undefined : c3Row;
  const channel3: Check = {
    id: "channel3",
    name: "Channel3 real prices",
    lastLabel: "Last price answer",
    status: "ok",
    summary: "",
    lastSuccessAt: iso(c3?.search_at),
    watchCheckedAt: iso(c3?.watch_at),
  };
  if (!has(env, "CHANNEL3_API_KEY")) {
    channel3.status = "off";
    channel3.summary = "Channel3 isn't set up here, so prices aren't compared with real shops.";
  } else if (c3?.watch_down_at) {
    channel3.status = "degraded";
    channel3.summary = "Channel3 didn't answer the shared price watch's last check. Price checks may be slow or missing.";
  } else {
    channel3.summary = c3?.watch_at
      ? "Comparing prices with real shops, and the shared price watch is tracking."
      : "Comparing prices with real shops. The shared price watch hasn't checked in yet.";
  }

  const whRow = await read<{ at: unknown }>("webhook record", "select max(received_at) as at from paypal_events");
  const webhooks: Check = {
    id: "webhooks",
    name: "PayPal webhooks",
    lastLabel: "Last event from PayPal",
    status: "ok",
    summary: "",
    lastSuccessAt: whRow === "failed" ? null : iso(whRow?.at),
  };
  if (!has(env, "PAYPAL_WEBHOOK_ID")) {
    webhooks.status = "off";
    webhooks.summary = "PayPal webhooks aren't set up here. The daily check still settles anything PayPal changed.";
  } else {
    webhooks.summary = webhooks.lastSuccessAt
      ? "Listening for PayPal to confirm holds, payments and releases. Each event is verified with PayPal first."
      : "Set up and listening, but no event has arrived yet. Each event is verified with PayPal first.";
  }

  // A part whose record couldn't be read (no database, or the query failed) can't say when it last worked, so it
  // doesn't get to say "ok" or "none on record yet" either.
  const unread: Array<[Check, unknown]> = [
    [kernel, kernelRow],
    [channel3, c3Row],
    [webhooks, whRow],
  ];
  for (const [c, row] of unread) {
    if (row !== "failed" || c.status === "off") continue;
    c.status = "degraded";
    c.summary = `Set up, but Spotter couldn't read its record just now, so it can't say when it last worked.`;
    delete c.lastLabel;
  }

  const checks = [dbCheck, paypalCheck, aiCheck, kernel, channel3, webhooks];
  return { status: overallStatus(checks), checkedAt: new Date(now).toISOString(), cachedFor: CACHE_MS / 1000, checks };
}

const SHORT: Record<Check["id"], string> = { database: "database", paypal: "PayPal", ai: "AI", kernel: "KERNEL", channel3: "Channel3", webhooks: "webhooks" };

/** A shields.io endpoint badge from the same report: names and states only, never a reason or an error. */
export function badgeFor(report: HealthReport) {
  const up = report.checks.filter((c) => c.status === "ok");
  const notes = report.checks
    .filter((c) => c.status !== "ok")
    .map((c) => (c.id === "ai" && c.status === "degraded" ? (c.slot === "backup" ? "AI on backup" : "AI on backup model") : `${SHORT[c.id]} ${c.status}`));
  const message = notes.length ? notes.join(", ") : `all ${up.length} up`;
  const color = report.status === "ok" ? "green" : report.status === "degraded" ? "yellow" : "red";
  return { schemaVersion: 1 as const, label: "live checks", message, color, cacheSeconds: 300 };
}

/** One probe run per minute per server instance; people arriving together share the run in flight. */
export function createHealth(makeDeps: () => HealthDeps, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  let cached: { at: number; report: HealthReport } | null = null;
  let running: Promise<HealthReport> | null = null;
  return {
    get(): Promise<HealthReport> {
      if (cached && now() - cached.at < CACHE_MS) return Promise.resolve(cached.report);
      if (!running) {
        const run = (async () => {
          const at = now();
          const report = await probeHealth(makeDeps(), at);
          cached = { at, report };
          return report;
        })();
        // Cleared after the run settles (not inside it), so a run that fails at once can't leave itself behind.
        running = run;
        run.then(
          () => (running = null),
          () => (running = null),
        );
      }
      return running;
    },
  };
}

/**
 * A fixed window per address, in this server instance's memory. On Vercel each instance counts on its own, which is
 * fine here: the answer is cached anyway, so the limit only stops one address hammering the function.
 */
export function rateLimiter(opts: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 5_000;
  const seen = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    const hit = seen.get(key);
    if (hit && t - hit.start < opts.windowMs) {
      hit.count += 1;
      return hit.count <= opts.limit;
    }
    seen.delete(key);
    // Maps keep insertion order, so the first keys are the oldest windows.
    while (seen.size >= maxKeys) seen.delete(seen.keys().next().value!);
    seen.set(key, { start: t, count: 1 });
    return true;
  };
}

/** The caller's address as Vercel forwards it. Anything without one shares a single bucket. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Anthropic's model list with one key: free, and it says whether the key is accepted. Never a completion. */
export async function anthropicKeyProbe(_slot: "primary" | "backup", key: string): Promise<KeyProbe> {
  const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(5_000),
  });
  // The body is never read: only the status matters, and it can't leak into the report.
  await r.body?.cancel().catch(() => {});
  if (r.ok) return "ok";
  return r.status === 401 || r.status === 403 ? "rejected" : "unreachable";
}
