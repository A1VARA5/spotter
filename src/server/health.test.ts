import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { badgeFor, clientIp, createHealth, overallStatus, probeHealth, rateLimiter, type Check, type HealthDeps, type HealthReport, type Status } from "./health";

const KEYS = {
  ANTHROPIC_API_KEY: "sk-ant-primary-SECRET1",
  ANTHROPIC_API_KEY_BACKUP: "sk-ant-backup-SECRET2",
  OPENAI_API_KEY: "sk-openai-SECRET3",
  KERNEL_API_KEY: "kernel-SECRET4",
  CHANNEL3_API_KEY: "c3-SECRET5",
  PAYPAL_CLIENT_ID: "paypal-id-SECRET6",
  PAYPAL_CLIENT_SECRET: "paypal-secret-SECRET7",
  PAYPAL_WEBHOOK_ID: "WH-SECRET8",
};

let db: Db;
beforeAll(async () => {
  db = await pgliteDb();
});
beforeEach(async () => {
  for (const t of ["paypal_events", "shared_watches", "market_cache", "peeks", "events", "payments", "spenders", "households"]) await db.query(`delete from ${t}`);
});

function deps(over: Partial<HealthDeps> = {}): HealthDeps {
  return {
    db: async () => db,
    env: { ...KEYS },
    paypalToken: async () => "token",
    claudeKey: async () => "ok",
    primaryOut: () => false,
    log: { error: () => {} },
    ...over,
  };
}

const find = (r: HealthReport, id: string) => r.checks.find((c) => c.id === id)!;

async function seedPayment(id: string, caseFile: unknown, eventAt: string) {
  await db.query("insert into households (id, name, spotter_name) values ('h1', 'Fam', 'Ann') on conflict do nothing");
  await db.query(
    "insert into spenders (id, household_id, name, kind, spotter_name, allowance) values ('s1', 'h1', 'Agent', 'agent', 'Ann', '{}'::jsonb) on conflict do nothing",
  );
  await db.query("insert into payments (id, spender_id, request, status, amount, currency, case_file) values ($1, 's1', '{}'::jsonb, 'needs_approval', 100, 'GBP', $2)", [
    id,
    JSON.stringify(caseFile),
  ]);
  await db.query("insert into events (payment_id, type, data, at) values ($1, 'case_built', '{}'::jsonb, $2)", [id, eventAt]);
}

describe("overallStatus", () => {
  it("is ok only when every check is ok", () => {
    expect(overallStatus([{ id: "database", status: "ok" }, { id: "ai", status: "ok" }])).toBe("ok");
  });
  it("is degraded when an optional part is off or down, or anything is degraded", () => {
    expect(overallStatus([{ id: "database", status: "ok" }, { id: "kernel", status: "off" }])).toBe("degraded");
    expect(overallStatus([{ id: "database", status: "ok" }, { id: "channel3", status: "down" }])).toBe("degraded");
    expect(overallStatus([{ id: "ai", status: "degraded" }])).toBe("degraded");
  });
  it("is down when the database, PayPal or the AI check is down", () => {
    for (const id of ["database", "paypal", "ai"]) expect(overallStatus([{ id, status: "down" }, { id: "kernel", status: "ok" }])).toBe("down");
  });
});

describe("probeHealth", () => {
  it("reports every dependency, all ok when everything answers", async () => {
    const r = await probeHealth(deps());
    expect(r.checks.map((c) => c.id)).toEqual(["database", "paypal", "ai", "kernel", "channel3", "webhooks"]);
    expect(find(r, "database").status).toBe("ok");
    expect(find(r, "paypal").status).toBe("ok");
    expect(find(r, "ai")).toMatchObject({ status: "ok", slot: "primary" });
    expect(find(r, "ai").summary).toMatch(/main key/i);
    expect(find(r, "kernel").status).toBe("ok");
    // No shared watch row yet: it must not claim the watch is tracking.
    expect(find(r, "channel3").summary).not.toMatch(/is tracking/);
  });

  it("never puts a key, id or error body in the report", async () => {
    const r = await probeHealth(
      deps({
        paypalToken: async () => {
          throw new Error(`PayPal said: invalid client ${KEYS.PAYPAL_CLIENT_ID} body {"error":"x"}`);
        },
        claudeKey: async () => {
          throw new Error(`boom ${KEYS.ANTHROPIC_API_KEY}`);
        },
      }),
    );
    const text = JSON.stringify(r);
    for (const v of Object.values(KEYS)) expect(text).not.toContain(v);
    expect(text).not.toContain("invalid client");
    expect(text).not.toContain("boom");
    expect(find(r, "paypal").status).toBe("down");
  });

  it("logs a failure without the error's message", async () => {
    const error = vi.fn();
    await probeHealth(
      deps({
        log: { error },
        paypalToken: async () => {
          throw new Error(`leak ${KEYS.PAYPAL_CLIENT_SECRET}`);
        },
      }),
    );
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEYS.PAYPAL_CLIENT_SECRET);
  });

  it("says plainly when the AI check is on the backup key", async () => {
    const r = await probeHealth(deps({ claudeKey: async (slot) => (slot === "primary" ? "rejected" : "ok") }));
    expect(find(r, "ai")).toMatchObject({ status: "degraded", slot: "backup" });
    expect(find(r, "ai").summary).toMatch(/backup key/i);
  });

  it("uses the backup when this server already set the main key aside", async () => {
    const r = await probeHealth(deps({ primaryOut: () => true }));
    expect(find(r, "ai")).toMatchObject({ status: "degraded", slot: "backup" });
  });

  it("falls to the OpenAI backup when no Claude key works, and down when there is none", async () => {
    const r = await probeHealth(deps({ claudeKey: async () => "rejected" }));
    expect(find(r, "ai")).toMatchObject({ status: "degraded", slot: "openai_backup" });
    const env = { ...KEYS, OPENAI_API_KEY: "" };
    const down = await probeHealth(deps({ env, claudeKey: async () => "rejected" }));
    expect(find(down, "ai")).toMatchObject({ status: "down", slot: "none" });
  });

  it("doesn't probe a key slot that isn't set", async () => {
    const claudeKey = vi.fn(async () => "ok" as const);
    await probeHealth(deps({ env: { ...KEYS, ANTHROPIC_API_KEY_BACKUP: "" }, claudeKey }));
    expect(claudeKey).toHaveBeenCalledTimes(1);
    expect(claudeKey).toHaveBeenCalledWith("primary", KEYS.ANTHROPIC_API_KEY);
  });

  it("marks optional parts off when their key is missing", async () => {
    const env = { ...KEYS, KERNEL_API_KEY: "", CHANNEL3_API_KEY: "", PAYPAL_WEBHOOK_ID: "" };
    const r = await probeHealth(deps({ env }));
    expect(find(r, "kernel").status).toBe("off");
    expect(find(r, "channel3").status).toBe("off");
    expect(find(r, "webhooks").status).toBe("off");
  });

  it("finds KERNEL's last real visit from case files, skipping the example and visits that never opened", async () => {
    await seedPayment("p_real", { page: { url: "https://a.test" } }, "2026-10-11T10:00:00Z");
    await seedPayment("p_example", { page: { url: "https://b.test" }, example: true }, "2026-10-12T10:00:00Z");
    await seedPayment("p_nopage", { headline: "x" }, "2026-10-12T11:00:00Z");
    const r = await probeHealth(deps());
    expect(find(r, "kernel").lastSuccessAt).toBe("2026-10-11T10:00:00.000Z");
  });

  it("reads Channel3's last answer and the shared watch, and says when the watch can't reach Channel3", async () => {
    await db.query("insert into market_cache (key, offers, fetched_at) values ('c5:GBP:x', '[]'::jsonb, '2026-10-12T08:00:00Z')");
    await db.query(
      "insert into shared_watches (key, product_id, item, currency, last_checked_at) values ('demo', 'p', 'Headphones', 'GBP', '2026-10-12T09:00:00Z')",
    );
    let r = await probeHealth(deps());
    expect(find(r, "channel3").summary).toMatch(/is tracking/);
    expect(find(r, "channel3")).toMatchObject({ status: "ok", lastSuccessAt: "2026-10-12T09:00:00.000Z", watchCheckedAt: "2026-10-12T09:00:00.000Z" });
    await db.query("update shared_watches set unreachable_at = '2026-10-12T09:30:00Z' where key = 'demo'");
    r = await probeHealth(deps());
    expect(find(r, "channel3").status).toBe("degraded");
  });

  it("reads the last PayPal webhook event", async () => {
    await db.query("insert into paypal_events (id, event_type, received_at) values ('WH-1', 'PAYMENT.AUTHORIZATION.CREATED', '2026-10-12T07:00:00Z')");
    const r = await probeHealth(deps());
    expect(find(r, "webhooks")).toMatchObject({ status: "ok", lastSuccessAt: "2026-10-12T07:00:00.000Z" });
  });

  it("doesn't wait forever on a database that hangs", async () => {
    const hung = { query: () => new Promise<never>(() => {}) };
    const r = await probeHealth(deps({ db: async () => hung, timeoutMs: 50 }));
    expect(find(r, "database").status).toBe("down");
    expect(r.status).toBe("down");
  });

  it("says when it couldn't read a part's record, instead of 'none on record'", async () => {
    const flaky: Db = {
      query: async <T,>(sql: string) => {
        if (/paypal_events|peeks|market_cache/.test(sql)) throw new Error("relation missing");
        return db.query<T>(sql);
      },
    };
    const r = await probeHealth(deps({ db: async () => flaky }));
    for (const id of ["kernel", "channel3", "webhooks"]) {
      expect(find(r, id)).toMatchObject({ status: "degraded" });
      expect(find(r, id).summary).toMatch(/couldn't read/i);
    }
  });

  it("names why the main key isn't used, and logs it", async () => {
    const error = vi.fn();
    const rejected = await probeHealth(deps({ log: { error }, claudeKey: async (slot) => (slot === "primary" ? "rejected" : "ok") }));
    expect(find(rejected, "ai").summary).toMatch(/main key was turned down/i);
    expect(JSON.stringify(error.mock.calls)).toMatch(/primary key rejected/);
    const resting = await probeHealth(deps({ primaryOut: () => true }));
    expect(find(resting, "ai").summary).toMatch(/set the main key aside/i);
    const missing = await probeHealth(deps({ env: { ...KEYS, ANTHROPIC_API_KEY: "" } }));
    expect(find(missing, "ai").summary).toMatch(/no main key/i);
  });

  it("says the OpenAI backup isn't checked live", async () => {
    const r = await probeHealth(deps({ claudeKey: async () => "rejected" }));
    expect(find(r, "ai").summary).toMatch(/not checked live/i);
  });

  it("doesn't claim webhook events arrive when none ever has", async () => {
    const r = await probeHealth(deps());
    expect(find(r, "webhooks").summary).toMatch(/no event has arrived yet/i);
  });

  it("is down for the database when it can't be opened, and the rest still answer", async () => {
    const r = await probeHealth(
      deps({
        db: async () => {
          throw new Error("postgres://user:pw@host/db refused");
        },
      }),
    );
    expect(find(r, "database").status).toBe("down");
    expect(find(r, "paypal").status).toBe("ok");
    expect(r.status).toBe("down");
    expect(JSON.stringify(r)).not.toContain("postgres://");
  });
});

describe("createHealth cache", () => {
  it("probes at most once a minute, and once for callers arriving together", async () => {
    let t = 1_000_000;
    const paypalToken = vi.fn(async () => "token");
    const h = createHealth(() => deps({ paypalToken }), { now: () => t });
    await Promise.all([h.get(), h.get(), h.get()]);
    expect(paypalToken).toHaveBeenCalledTimes(1);
    t += 59_000;
    await h.get();
    expect(paypalToken).toHaveBeenCalledTimes(1);
    t += 2_000;
    await h.get();
    expect(paypalToken).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failed probe run, so the next caller tries again", async () => {
    let first = true;
    const h = createHealth(
      () => {
        if (first) {
          first = false;
          throw new Error("deps broke");
        }
        return deps();
      },
      { now: () => 5 },
    );
    await expect(h.get()).rejects.toThrow();
    await expect(h.get()).resolves.toMatchObject({ status: "ok" });
  });
});

describe("rateLimiter", () => {
  it("lets an address through a set number of times a minute, each address on its own", () => {
    let t = 0;
    const allow = rateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([allow("1.1.1.1"), allow("1.1.1.1"), allow("1.1.1.1"), allow("1.1.1.1")]).toEqual([true, true, true, false]);
    expect(allow("2.2.2.2")).toBe(true);
    t += 60_001;
    expect(allow("1.1.1.1")).toBe(true);
  });

  it("keeps its memory bounded", () => {
    let t = 0;
    const allow = rateLimiter({ limit: 1, windowMs: 60_000, now: () => t, maxKeys: 10 });
    for (let i = 0; i < 50; i++) allow(`10.0.0.${i}`);
    t += 1;
    // the oldest addresses were forgotten, so memory never grows past maxKeys
    expect(allow("10.0.0.0")).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first address Vercel forwarded, then x-real-ip, then a shared bucket", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("badgeFor", () => {
  const report = (checks: Array<Partial<Check> & { id: Check["id"]; status: Status }>): HealthReport => ({
    status: overallStatus(checks),
    checkedAt: "2026-10-12T00:00:00.000Z",
    cachedFor: 60,
    checks: checks.map((c) => ({ name: c.id, summary: "s", ...c })),
  });

  it("is green with a count when everything is up", () => {
    const b = badgeFor(
      report([
        { id: "database", status: "ok" },
        { id: "paypal", status: "ok" },
        { id: "ai", status: "ok", slot: "primary" },
        { id: "kernel", status: "ok" },
      ]),
    );
    expect(b).toEqual({ schemaVersion: 1, label: "live checks", message: "all 4 up", color: "green", cacheSeconds: 300 });
  });

  it("is yellow and names the AI backup or a degraded part", () => {
    const b = badgeFor(
      report([
        { id: "database", status: "ok" },
        { id: "ai", status: "degraded", slot: "backup" },
        { id: "channel3", status: "degraded" },
      ]),
    );
    expect(b.color).toBe("yellow");
    expect(b.message).toBe("AI on backup, Channel3 degraded");
  });

  it("is red when a core part is down, and lists only names and states", async () => {
    const b = badgeFor(
      report([
        { id: "database", status: "ok" },
        { id: "paypal", status: "down" },
        { id: "kernel", status: "off" },
      ]),
    );
    expect(b).toMatchObject({ color: "red", message: "PayPal down, KERNEL off" });
    const full = badgeFor(
      await probeHealth(
        deps({
          paypalToken: async () => {
            throw new Error(`x ${KEYS.PAYPAL_CLIENT_ID}`);
          },
        }),
      ),
    );
    expect(full.message).toBe("PayPal down");
    expect(JSON.stringify(full)).not.toMatch(/SECRET|WH-|Error/);
  });
});
