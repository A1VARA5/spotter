// Registers Spotter's Discord commands and points the app at the interactions endpoint.
// npx tsx --env-file=.env.local scripts/register-discord.mts https://spotter-pay.vercel.app
const app = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const site = process.argv[2] ?? "https://spotter-pay.vercel.app";
if (!app || !token) throw new Error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN");

const call = async (method: string, path: string, body: object) => {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(method, path, res.status, (await res.text()).slice(0, 300));
};

// integration_types 0 = server install, 1 = user install; contexts 0 servers, 1 bot DM, 2 other DMs.
const everywhere = { integration_types: [0, 1], contexts: [0, 1, 2] };
await call("PUT", `/applications/${app}/commands`, [
  { name: "Check with Spotter", type: 3, ...everywhere },
  {
    name: "spotter",
    type: 1,
    description: "Spotter: connect your account or see your payments",
    ...everywhere,
    options: [
      { type: 1, name: "connect", description: "Connect with the code your spotter gave you", options: [{ type: 3, name: "code", description: "The code, like SPOT-7KQ2XM", required: true, max_length: 20 }] },
      { type: 1, name: "status", description: "Your recent payments and anything on hold" },
    ],
  },
]);
// Discord pings the URL with good and bad signatures before it accepts it.
await call("PATCH", "/applications/@me", { interactions_endpoint_url: `${site}/api/discord` });
