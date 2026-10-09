// Agentboxd webhook (message.received). Answers 200 straight away and does the work after the response,
// because Agentboxd times out at 10 seconds and a check can take longer.
import { after } from "next/server";
import { getDeps } from "@/server/deps";
import { extractPayment } from "@/ai/extract";
import { getMessage, reply, verifyMailroom, type MailEvent } from "@/email/agentboxd";
import { handleInboundEmail } from "@/email/inbound";

export const maxDuration = 60;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyMailroom(raw, request.headers.get("x-mailroom-timestamp"), request.headers.get("x-mailroom-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  let evt: MailEvent;
  try {
    evt = JSON.parse(raw) as MailEvent;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  after(async () => {
    try {
      const outcome = await handleInboundEmail({ deps: await getDeps(), site, getMessage, reply, extract: (t) => extractPayment(t) }, evt);
      console.log("[spotter] email", evt.data?.message?.id ?? "?", outcome);
    } catch (e) {
      console.error("[spotter] email handling failed:", e);
    }
  });
  return new Response("ok");
}
