// Recording mode switch: ?rec=1 on any page turns it on for this browser, ?rec=0 turns it off (src/core/recording.ts).
// The browser is sent straight back to the same page without the switch, so the address bar in a video stays clean.
// Runs only for requests that carry ?rec (see config), so every other page load skips it.
import { NextResponse, type NextRequest } from "next/server";
import { REC_COOKIE, recToggle } from "@/core/recording";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

export function proxy(request: NextRequest) {
  const on = recToggle(request.nextUrl.searchParams);
  if (on === null) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.searchParams.delete("rec");
  const res = NextResponse.redirect(url, 307);
  const secure = request.nextUrl.protocol === "https:";
  if (on) res.cookies.set(REC_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: THIRTY_DAYS });
  else res.cookies.set(REC_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 0 });
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image).*)", has: [{ type: "query", key: "rec" }] }],
};
