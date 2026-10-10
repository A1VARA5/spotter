// Talking to Discord: checking that an interaction really came from Discord, and sending DMs as the bot.
import { createPublicKey, verify } from "node:crypto";

const API = "https://discord.com/api/v10";

/** Ed25519 over timestamp + the raw body, with the app's public key. Anything else is refused. */
export function verifyDiscord(raw: string, sig: string | null, ts: string | null): boolean {
  const pub = process.env.DISCORD_PUBLIC_KEY;
  if (!pub || !sig || !ts) return false;
  try {
    // The raw 32 byte key, wrapped in the SPKI header node:crypto expects.
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(ts + raw), key, Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

async function bot(method: string, path: string, body?: object): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN ?? ""}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

/** A DM from the bot. Throws when Discord refuses (for example the person has DMs from apps turned off). */
export async function sendDm(userId: string, content: string, components?: unknown[]): Promise<void> {
  const ch = await bot("POST", "/users/@me/channels", { recipient_id: userId });
  if (!ch.ok) throw new Error(`Discord wouldn't open a DM (${ch.status})`);
  const { id } = (await ch.json()) as { id: string };
  const res = await bot("POST", `/channels/${id}/messages`, { content: content.slice(0, 2000), components, allowed_mentions: { parse: [] } });
  if (!res.ok) throw new Error(`Discord refused the DM (${res.status})`);
}
