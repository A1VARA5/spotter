import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgliteDb, type Db } from "@/db";
import { loginUrl, makeLoginHandlers, STATE_COOKIE } from "./identity";

let db: Db;
let fetchFn: ReturnType<typeof vi.fn>;
let h: ReturnType<typeof makeLoginHandlers>;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
  process.env.PAYPAL_CLIENT_ID = "cid";
  process.env.PAYPAL_CLIENT_SECRET = "csecret";
  process.env.PAYPAL_LOGIN_REDIRECT_URI = "http://localhost:3417/api/auth/paypal/callback";
  db = await pgliteDb();
  fetchFn = vi.fn(async (url: string) =>
    String(url).includes("/oauth2/token")
      ? ok({ access_token: "AT", token_type: "Bearer" })
      : ok({ user_id: "https://www.paypal.com/webapps/auth/identity/user/abc123", name: "Gran Smith", emails: [{ value: "g@example.com", primary: true }] }),
  );
  h = makeLoginHandlers({ db, fetch: fetchFn as unknown as typeof fetch });
});

const callback = (qs: string, state?: string) =>
  new Request(`http://localhost:3417/api/auth/paypal/callback?${qs}`, { headers: state ? { cookie: `${STATE_COOKIE}=${state}` } : {} });
const cookies = (r: Response) => r.headers.getSetCookie().join("\n");

describe("log in with PayPal", () => {
  it("builds the sandbox consent URL with state and the exact redirect", () => {
    const u = new URL(loginUrl("S1"));
    expect(u.origin + u.pathname).toBe("https://www.sandbox.paypal.com/connect");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile email");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3417/api/auth/paypal/callback");
    expect(u.searchParams.get("state")).toBe("S1");
  });

  it("start sets a random state cookie and redirects to PayPal", async () => {
    const r = h.start();
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/connect\?/);
    const state = /spotter_oauth_state=([^;]+)/.exec(cookies(r))![1]!;
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(new URL(r.headers.get("location")!).searchParams.get("state")).toBe(state);
  });

  it("refuses a missing or wrong state without creating anything", async () => {
    for (const r of [await h.callback(callback("code=C&state=S1")), await h.callback(callback("code=C&state=S1", "S2"))]) {
      expect(r.status).toBe(400);
      expect(cookies(r)).not.toMatch(/spotter_hh=[^;]/);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await db.query("select * from households")).toHaveLength(0);
  });

  it("the same PayPal user signing in twice gets the same household", async () => {
    const r1 = await h.callback(callback("code=C&state=S1", "S1"));
    const r2 = await h.callback(callback("code=C&state=S2", "S2"));
    expect(r1.status).toBe(303);
    expect(r1.headers.get("location")).toMatch(/\/setup$/);
    expect(cookies(r1)).toMatch(/spotter_hh=hh_/);
    expect(cookies(r1)).toMatch(/spotter_oauth_state=;/);
    const rows = await db.query<{ email: string; spotter_name: string }>("select email, spotter_name from households");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "g@example.com", spotter_name: "Gran" });
    expect(r2.headers.get("location")).toMatch(/\/setup$/); // still no PIN
  });

  it("reads the profile from PayPal's OpenID Connect userinfo endpoint", async () => {
    await h.callback(callback("code=C&state=S1", "S1"));
    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls[1]).toBe("https://api-m.sandbox.paypal.com/v1/identity/openidconnect/userinfo?schema=openid");
  });

  it("understands the OpenID shape (sub and a plain email)", async () => {
    fetchFn.mockImplementation(async (url: string) =>
      String(url).includes("/oauth2/token") ? ok({ access_token: "AT" }) : ok({ sub: "user-xyz", name: "Sam Lee", email: "sam@example.com" }),
    );
    await h.callback(callback("code=C&state=S1", "S1"));
    const rows = await db.query<{ email: string; paypal_user_id: string }>("select email, paypal_user_id from households");
    expect(rows[0]).toMatchObject({ email: "sam@example.com", paypal_user_id: "user-xyz" });
  });

  it("a PayPal error sends them back to the front door, nothing created", async () => {
    fetchFn.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const r = await h.callback(callback("code=C&state=S1", "S1"));
    expect(r.headers.get("location")).toMatch(/\/\?login=failed$/);
    expect(await db.query("select * from households")).toHaveLength(0);
  });

  it("a person who cancels at PayPal comes back to the front door", async () => {
    const r = await h.callback(callback("error=access_denied&state=S1", "S1"));
    expect(r.headers.get("location")).toMatch(/\/\?login=cancelled$/);
  });

  it("coming back with no code is logged with the parameter names, never their values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await h.callback(callback("scope=openid&secret_thing=XYZ123&state=S1", "S1"));
    expect(r.headers.get("location")).toMatch(/\/\?login=failed$/);
    const line = log.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(line).toContain("no code");
    expect(line).toContain("secret_thing");
    expect(line).not.toContain("XYZ123");
    log.mockRestore();
  });
});
