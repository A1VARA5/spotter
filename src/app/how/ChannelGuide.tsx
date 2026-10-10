"use client";
// How each person reaches Spotter, channel by channel: the one time connect, then the everyday habit,
// each shown on the screen where it happens.
import { useState } from "react";
import { Bot, Gamepad2, Mail, Send } from "lucide-react";
import { BrandMark } from "@/ui/components";
import { Iphone, SCAM } from "@/app/landing/Devices";

type Guide = {
  key: string;
  icon: typeof Send;
  name: string;
  who: string;
  connect: string[];
  everyday: string[];
};

const GUIDES: Guide[] = [
  {
    key: "telegram",
    icon: Send,
    name: "Telegram",
    who: "Best for Gran: one tap to connect, then she just forwards things.",
    connect: ["You open Gran's page in Spotter and press Connect Telegram.", "You send her the link it makes (text it, or show her the QR).", "She taps it and presses Start. That's it, she's paired."],
    everyday: ["Something asks her for money? She forwards it to the Spotter chat.", "If it came as a text, she copies the words and shares them there.", "Spotter answers in the same chat, and asks you if it needs to."],
  },
  {
    key: "email",
    icon: Mail,
    name: "Email",
    who: "For anyone who lives in their inbox: invoices, parcel fees, \"your account is locked\".",
    connect: ["You press Connect email on their page and get a code.", "They send one email to spotter@homingbox.net with the code in the subject.", "Spotter replies to confirm. Only connected addresses ever get an answer."],
    everyday: ["They forward the suspicious email to spotter@homingbox.net.", "Spotter checks who really sent it and what it asks for.", "The answer comes back in the same thread."],
  },
  {
    key: "discord",
    icon: Gamepad2,
    name: "Discord",
    who: "For Leo: game chats are where gift card and \"cheap coins\" scams live.",
    connect: ["You open Leo's page and press Connect Discord.", "He adds the Spotter app to his account from the link (no server needed).", "He sends the pairing code to Spotter once."],
    everyday: ["Someone offers him a deal in a server or a DM.", "He right clicks the message, then Apps, then Check with Spotter.", "Only Leo sees the answer. You're asked if money is involved."],
  },
  {
    key: "agent",
    icon: Bot,
    name: "AI agent",
    who: "For Claude, Claude Code or any agent that shops for you.",
    connect: ["You add an AI agent and press Make a key on its page.", "You paste one line into Claude Code, or the config into Claude Desktop.", "The agent now has Spotter's four tools. There's no approve tool."],
    everyday: ["The agent finds something to buy and asks Spotter to pay.", "Spotter checks it and replies in words the agent passes on to you.", "Anything over your limit waits on your dashboard."],
  },
];

function TelegramShot() {
  return (
    <Iphone scale={0.7} className="guide-phone">
      <div className="share">
        <div className="share-shot">
          <p className="share-shot-cap">Copied text</p>
          <p className="share-shot-msg">{SCAM.chat[3].text}</p>
        </div>
        <div className="share-sheet">
          <p className="share-title">Share</p>
          <div className="share-row">
            {[
              ["Messages", "#7b8794"],
              ["Mail", "#7b8794"],
              ["Notes", "#7b8794"],
              ["Telegram", "#2c55c9"],
            ].map(([n, c]) => (
              <span key={n} className="share-app" data-on={n === "Telegram"}>
                <i style={{ background: c }} />
                {n}
              </span>
            ))}
          </div>
          <div className="share-target">
            <span className="share-target-av">
              <BrandMark />
            </span>
            <span>
              <b>Spotter</b>
              <i>Send to the Spotter chat</i>
            </span>
          </div>
        </div>
      </div>
    </Iphone>
  );
}

function EmailShot() {
  return (
    <Iphone scale={0.7} className="guide-phone">
      <div className="gfwd">
        <p className="gfwd-bar">
          <span>Cancel</span>
          <b>Forward</b>
          <span className="gfwd-send">Send</span>
        </p>
        <p className="gfwd-field">
          <i>To</i> <span className="gfwd-chip">spotter@homingbox.net</span>
        </p>
        <p className="gfwd-field">
          <i>Subject</i> Fwd: Your parcel is waiting
        </p>
        <div className="gfwd-quote">
          <p>---------- Forwarded message ---------</p>
          <p>From: Parcel Delivery &lt;notice@parcel-redelivery.top&gt;</p>
          <p>We were unable to deliver your parcel due to an unpaid shipping fee of £2.99...</p>
        </div>
      </div>
    </Iphone>
  );
}

function DiscordShot() {
  return (
    <div className="dshot">
      <p className="dshot-ch"># trading</p>
      <div className="dshot-msg">
        <span className="dshot-av" aria-hidden="true" />
        <div>
          <p className="dshot-user">
            xX_cheapcoins_Xx <span>Today at 16:02</span>
          </p>
          <p>selling 2000 BlockWorld coins for £8!! pay with a £8 gift card, send me the code in dms</p>
        </div>
      </div>
      <div className="dshot-menu">
        <p>Reply</p>
        <p>Copy Text</p>
        <p className="dshot-apps">
          Apps <span>›</span>
        </p>
        <div className="dshot-sub">
          <p className="dshot-pick">
            <BrandMark /> Check with Spotter
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentShot() {
  return (
    <div className="term">
      <p className="term-bar">
        <i />
        <i />
        <i />
        <span>Terminal</span>
      </p>
      <p>
        <b>$</b> claude mcp add --transport http spotter https://spotter-pay.vercel.app/api/mcp --header &quot;Authorization: Bearer spt_••••&quot;
      </p>
      <p className="term-ok">Added HTTP MCP server spotter</p>
      <p>
        <b>$</b> claude
      </p>
      <p className="term-me">&gt; buy me the wireless earbuds Leo wants, at the best price you can find</p>
      <p className="term-tool">● spotter · find_products(&quot;wireless earbuds&quot;)</p>
      <p>£179.99 at Everything Store, £184.00 at Sound Shack</p>
      <p className="term-tool">● spotter · request_payment(£179.99, Everything Store)</p>
      <p className="term-hold">Held, not paid yet: Sam has to approve £179.99 to Everything Store.</p>
    </div>
  );
}

const SHOT: Record<string, () => React.ReactElement> = { telegram: TelegramShot, email: EmailShot, discord: DiscordShot, agent: AgentShot };

export function ChannelGuide() {
  const [i, setI] = useState(0);
  const g = GUIDES[i]!;
  const Shot = SHOT[g.key]!;
  return (
    <div className="guide">
      <div className="guide-tabs" role="tablist" aria-label="Ways to reach Spotter">
        {GUIDES.map((x, n) => (
          <button key={x.key} role="tab" aria-selected={n === i} className="guide-tab" onClick={() => setI(n)}>
            <x.icon size={17} strokeWidth={1.9} aria-hidden="true" />
            {x.name}
          </button>
        ))}
      </div>
      <div className="guide-body" role="tabpanel" key={g.key}>
        <div className="guide-text">
          <p className="guide-who">{g.who}</p>
          <div className="guide-cols">
            <div>
              <h3 className="guide-h">Once, to connect</h3>
              <ol className="guide-steps">
                {g.connect.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="guide-h">Every day after</h3>
              <ol className="guide-steps">
                {g.everyday.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
        <div className="guide-shot">
          <Shot />
        </div>
      </div>
    </div>
  );
}
