// Points the Telegram bot at the app and sets its profile text and commands. Run after deploying:
// npx tsx --env-file=.env.local scripts/register-telegram.mts https://spotter-pay.vercel.app
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = process.argv[2] ?? "https://spotter-pay.vercel.app";
if (!token || !secret) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET");

const call = async (method: string, body: object) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(method, res.status, (await res.text()).slice(0, 300));
};

await call("setWebhook", { url: `${site}/api/telegram`, secret_token: secret, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: true });
await call("setMyCommands", {
  commands: [
    { command: "start", description: "Connect with the code your spotter gave you" },
    { command: "help", description: "How to send me something to check" },
  ],
});
await call("setMyShortDescription", { short_description: "Forward Spotter anything that asks you for money. It checks it, and PayPal holds it if it looks off." });
await call("setMyDescription", {
  description:
    "Got a text, email or WhatsApp asking you to pay someone? Forward it here first.\n\nSpotter checks it against the rules your family set up with you, and reads the message for the usual scam signs. If something looks off, PayPal holds the money and the person who looks out for you gets asked. Nothing is paid until they say yes.\n\nPress Start, then send the code they gave you.",
});
await call("getWebhookInfo", {});
