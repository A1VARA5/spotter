// Log in with PayPal (sandbox, OpenID Connect). PayPal proves who you are; Spotter keys your household on
// PayPal's stable user id, never on the email, and stores no password.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/db";
import { newId, type Household } from "@/core/households";
import { householdCookie } from "@/server/auth";

const CONNECT = "https://www.sandbox.paypal.com/connect";
const API = "https://api-m.sandbox.paypal.com";
export const STATE_COOKIE = "spotter_oauth_state";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set.`);
  return v;
};

export function loginUrl(state: string): string {
  const q = new URLSearchParams({
    flowEntry: "static",
    client_id: env("PAYPAL_CLIENT_ID"),
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: env("PAYPAL_LOGIN_REDIRECT_URI"),
    state,
  });
  return `${CONNECT}?${q}`;
}

type PayPalUser = { userId: string; email?: string; name?: string };

async function exchangeCode(f: typeof fetch, code: string): Promise<string> {
  const basic = Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64");
  const r = await f(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`PayPal token exchange failed: ${r.status} ${j.error ?? ""}`.trim());
  return j.access_token;
}

async function userInfo(f: typeof fetch, accessToken: string): Promise<PayPalUser> {
  const r = await f(`${API}/v1/identity/openidconnect/userinfo?schema=openid`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as {
    user_id?: string;
    sub?: string;
    name?: string;
    email?: string;
    emails?: Array<{ value?: string; primary?: boolean }>;
  };
  const userId = j.user_id ?? j.sub;
  if (!r.ok || !userId) {
    const e = j as { name?: string; message?: string; error?: string; error_description?: string; debug_id?: string };
    throw new Error(`PayPal userinfo failed: ${r.status} ${e.name ?? e.error ?? ""} ${e.message ?? e.error_description ?? ""} debug_id=${e.debug_id ?? "none"}`);
  }
  const email = j.emails?.find((e) => e.primary)?.value ?? j.emails?.[0]?.value ?? j.email;
  return { userId, email, name: j.name };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
const clearState = () => `${STATE_COOKIE}=; Path=/api/auth/paypal; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

function cookieValue(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

/** One household per PayPal user. "on conflict do nothing" plus a re-read handles two logins racing. */
async function findOrCreate(db: Db, u: PayPalUser): Promise<Household> {
  const byUser = () => db.query<Household>("select * from households where paypal_user_id = $1", [u.userId]);
  const found = (await byUser())[0];
  if (found) return found;
  const first = u.name?.trim().split(/\s+/)[0] || "You";
  const created = await db.query<Household>(
    "insert into households (id, name, spotter_name, paypal_user_id, email) values ($1, $2, $3, $4, $5) on conflict (paypal_user_id) do nothing returning *",
    [newId("hh"), `${first}'s household`, first, u.userId, u.email ?? null],
  );
  return created[0] ?? (await byUser())[0]!;
}

export function makeLoginHandlers(deps: { db: Db; fetch?: typeof fetch }) {
  const f = deps.fetch ?? fetch;
  return {
    start(): Response {
      const state = randomBytes(32).toString("base64url");
      return redirect(loginUrl(state), [`${STATE_COOKIE}=${state}; Path=/api/auth/paypal; HttpOnly; SameSite=Lax; Max-Age=600${secure()}`]);
    },

    async callback(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const origin = url.origin;
      const expected = cookieValue(request, STATE_COOKIE);
      const state = url.searchParams.get("state") ?? "";
      if (!expected || !same(state, expected)) {
        return Response.json({ error: "This sign in link has expired. Start again from the front page." }, { status: 400, headers: { "set-cookie": clearState() } });
      }
      if (url.searchParams.get("error")) return redirect(`${origin}/?login=cancelled`, [clearState()]);
      const code = url.searchParams.get("code");
      if (!code) return redirect(`${origin}/?login=failed`, [clearState()]);
      try {
        const user = await userInfo(f, await exchangeCode(f, code));
        const hh = await findOrCreate(deps.db, user);
        return redirect(`${origin}${hh.pin_hash ? "/dashboard" : "/setup"}`, [clearState(), householdCookie(hh.id)]);
      } catch (e) {
        console.error("[spotter] PayPal login failed:", e instanceof Error ? e.message : e);
        return redirect(`${origin}/?login=failed`, [clearState()]);
      }
    },
  };
}
