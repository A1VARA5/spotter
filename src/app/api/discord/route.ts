// Discord interactions endpoint. Signature first; then answer within Discord's 3 seconds with a private
// "thinking", do the work after the response, and edit that reply with the result (or a readable error).
import { after } from "next/server";
import { getDeps } from "@/server/deps";
import { extractPayment } from "@/ai/extract";
import { verifyDiscord } from "@/discord/api";
import { runInteraction, type Interaction } from "@/discord/inbound";

export const maxDuration = 120;
const EPHEMERAL = 64;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyDiscord(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
    return new Response("bad signature", { status: 401 });
  }
  const i = JSON.parse(raw) as Interaction & { application_id?: string; token?: string };
  if (i.type === 1) return Response.json({ type: 1 });

  const appId = String(i.application_id ?? "");
  const token = String(i.token ?? "");
  if (appId !== process.env.DISCORD_APPLICATION_ID || !/^[\w.:=-]{20,1000}$/.test(token)) return new Response("bad interaction", { status: 400 });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  after(async () => {
    const edit = async (body: object) => {
      const res = await fetch(`https://discord.com/api/v10/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/@original`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
      });
      if (!res.ok) console.error("[spotter] discord edit failed:", res.status, (await res.text()).slice(0, 200));
    };
    try {
      const reply = await runInteraction({ deps: await getDeps(), site, extract: (t) => extractPayment(t) }, i);
      await edit(reply);
    } catch (e) {
      console.error("[spotter] discord interaction failed:", e instanceof Error ? e.message : e);
      await edit({ content: "Spotter couldn't check that right now. Nothing was paid. Try again in a few minutes." });
    }
  });
  return Response.json({ type: 5, data: { flags: EPHEMERAL } });
}
