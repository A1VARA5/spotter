import { clearCookies } from "@/server/auth";

export async function POST(request: Request) {
  const headers = new Headers({ location: `${new URL(request.url).origin}/` });
  for (const c of clearCookies()) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
