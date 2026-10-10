"use client";
// "Nobody installs anything new": pick a channel and see the real message going in, Spotter's real reply coming back,
// and where the money is meanwhile. The replies use the wording the bots, emails and tools actually send.
import { useState } from "react";
import { Bot, Gamepad2, Mail, ReceiptText, Send, Terminal } from "lucide-react";
import { BrandMark, Evidence } from "@/ui/components";
import type { Flag } from "@/core/grounding";

type Tone = "held" | "stop" | "protect";
type Channel = {
  key: string;
  tab: string;
  Icon: typeof Mail;
  who: string;
  inCap: string;
  In: () => React.ReactNode;
  outCap: string;
  Out: () => React.ReactNode;
  checks: string;
  money: { tone: Tone; state: string; text: string };
  how: string;
};

const PARCEL = "We were unable to deliver your parcel due to an unpaid shipping fee of £2.99. Pay within 24 hours or it will be returned to the sender.";
const HI_MUM = "Can you send £250 to my mate Jamie's PayPal and I'll pay you back tomorrow";
const COINS = "selling 2000 BlockWorld coins for £8!! pay with a gift card, send me the code in dms";
const INVOICE = "Please note our bank details have changed, so pay the new account below by bank transfer. Pay today or we stop deliveries tomorrow.";

const f = (quote: string, severity: Flag["severity"], kind: Flag["kind"] = "other"): Flag => ({ kind, severity, quote, why: "" });

const CHANNELS: Channel[] = [
  {
    key: "email",
    tab: "Email",
    Icon: Mail,
    who: "Gran",
    inCap: "Gran forwards an email",
    In: () => (
      <div className="snip snip-mail">
        <span className="snip-mail-meta">
          To <b>spotter@homingbox.net</b>
          <br />
          Fwd: Your parcel is waiting
        </span>
        <Evidence text={PARCEL} flags={[f("Pay within 24 hours or it will be returned", "medium", "pressure")]} />
      </div>
    ),
    outCap: "Spotter replies in the same thread",
    Out: () => (
      <div className="snip snip-mail">
        <span className="snip-mail-meta">
          From <b>Spotter</b>, On hold
        </span>
        <span>Not paid yet. £2.99 to Parcel Delivery is on hold until Sam says yes. The money is reserved, nothing has left.</span>
      </div>
    ),
    checks: "The link isn't a delivery company's site.",
    money: { tone: "held", state: "On hold", text: "£2.99 reserved at PayPal, nothing taken" },
    how: "Forward anything that asks for money. Only addresses you connected get an answer.",
  },
  {
    key: "telegram",
    tab: "Telegram",
    Icon: Send,
    who: "Gran",
    inCap: "Gran forwards a chat message",
    In: () => (
      <div className="snip snip-tg">
        <span className="snip-me">
          <span className="snip-from">Forwarded from +44 7700 900461</span>
          {HI_MUM}
        </span>
        <span className="snip-me">Is this alright to pay? It&apos;s from James</span>
      </div>
    ),
    outCap: "Spotter answers in the chat",
    Out: () => (
      <div className="snip snip-tg">
        <span>
          <b>On hold, nothing has left your account.</b> £250 to jamie.k1994@inbox.example is waiting for Sam. This looks like the &quot;Hi Mum&quot; scam.
        </span>
      </div>
    ),
    checks: "A new number, can't use their bank, pay a friend instead.",
    money: { tone: "held", state: "On hold", text: "£250 reserved at PayPal until Sam decides" },
    how: "One tap pairs Gran's phone. You get a one tap Deny in yours.",
  },
  {
    key: "discord",
    tab: "Discord",
    Icon: Gamepad2,
    who: "Leo",
    inCap: "Leo right clicks a message",
    In: () => (
      <div className="snip snip-dc">
        <span className="snip-dc-user">
          xX_cheapcoins_Xx <span>Today at 16:02</span>
        </span>
        <span>{COINS}</span>
        <span className="snip-dc-menu">
          Apps › <b>Check with Spotter</b>
        </span>
      </div>
    ),
    outCap: "Leo gets a private answer",
    Out: () => (
      <div className="snip snip-dc">
        <span className="snip-dc-only">Only you can see this</span>
        <span>
          <b>Stopped.</b> Gift card codes can&apos;t be undone, so this one is never allowed. Ask Sam if you want game credit.
        </span>
      </div>
    ),
    checks: "Paying with a gift card code is never allowed.",
    money: { tone: "stop", state: "Stopped", text: "£8 never sent, nothing reached PayPal" },
    how: "Right click any message, in a server or a DM. Leo's answer is private.",
  },
  {
    key: "agent",
    tab: "AI agent",
    Icon: Bot,
    who: "Shopping agent",
    inCap: "The agent calls Spotter's tool",
    In: () => (
      <pre className="snip snip-term">
        <span className="t-fn">request_payment</span>
        {"({\n  item: "}
        <span className="t-str">&quot;wireless earbuds&quot;</span>
        {",\n  amount_pence: 4999,\n  currency: "}
        <span className="t-str">&quot;GBP&quot;</span>
        {",\n  payee: "}
        <span className="t-str">&quot;GadgetBarn&quot;</span>
        {",\n  page_text: "}
        <span className="t-dim">&quot;the whole page, as the agent saw it&quot;</span>
        {"\n})"}
      </pre>
    ),
    outCap: "The tool answers the agent",
    Out: () => (
      <pre className="snip snip-term">
        <span className="t-ok">Held, not paid yet:</span>
        {" Sam has to approve £49.99 to GadgetBarn. The money is reserved meanwhile. Tell the user, then check later with payment_status."}
      </pre>
    ),
    checks: "First time at this shop, over the agent's £30 limit.",
    money: { tone: "held", state: "On hold", text: "£49.99 reserved at PayPal until Sam decides" },
    how: "Each agent gets its own key. It can ask to pay. It has no tool to approve.",
  },
  {
    key: "toolkit",
    tab: "PayPal Agent Toolkit",
    Icon: Terminal,
    who: "Any agent",
    inCap: "PayPal's own create_order tool",
    In: () => (
      <pre className="snip snip-term">
        <span className="t-fn">create_order</span>
        {"({\n  currencyCode: "}
        <span className="t-str">&quot;USD&quot;</span>
        {",\n  items: [{ name: "}
        <span className="t-str">&quot;Noise cancelling earbuds&quot;</span>
        {",\n    itemCost: 119, quantity: 1 }]\n})"}
      </pre>
    ),
    outCap: "Spotter answers in PayPal's format",
    Out: () => (
      <pre className="snip snip-term">
        {"status: "}
        <span className="t-fn">&quot;HELD_FOR_APPROVAL&quot;</span>
        {"\namount: { value: "}
        <span className="t-str">&quot;119.00&quot;</span>
        {" }\n"}
        <span className="t-dim">Over the US$30.00 &quot;ask me first&quot; limit.</span>
      </pre>
    ),
    checks: "PayPal's tools have no limits of their own. Spotter adds them.",
    money: { tone: "held", state: "On hold", text: "$119 reserved at PayPal, pay_order can't capture it" },
    how: "Point the toolkit at Spotter's address with the agent's key. Same tools, with a spotter.",
  },
  {
    key: "invoice",
    tab: "Supplier invoice",
    Icon: ReceiptText,
    who: "A business",
    inCap: "Tom forwards an invoice",
    In: () => (
      <div className="snip snip-mail">
        <span className="snip-mail-meta">
          Fwd: <b>Invoice HP-4471 OVERDUE</b>, £286.40
        </span>
        <Evidence text={INVOICE} flags={[f("our bank details have changed", "high", "changed_bank_details"), f("Pay today or we stop deliveries tomorrow", "medium", "pressure")]} />
      </div>
    ),
    outCap: "Spotter tells Tom what to do instead",
    Out: () => (
      <div className="snip snip-mail">
        <span className="snip-mail-meta">
          From <b>Spotter</b>, Not paid
        </span>
        <span>The bank details changed. Don&apos;t pay by bank transfer: pay with a protected PayPal payment, and ring the supplier on a number you already have.</span>
      </div>
    ),
    checks: "New bank details on an invoice, with a deadline.",
    money: { tone: "protect", state: "Not sent", text: "The bank transfer never goes out. Pay it through PayPal instead." },
    how: "Same Spotter for a business: whoever pays the suppliers forwards invoices.",
  },
];

export function ChannelHub({ cta }: { cta: React.ReactNode }) {
  const [i, setI] = useState(0);
  const [run, setRun] = useState(0);
  const c = CHANNELS[i]!;

  const pick = (n: number) => {
    const next = (n + CHANNELS.length) % CHANNELS.length;
    setI(next);
    setRun((r) => r + 1);
    return next;
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
    e.preventDefault();
    const next = pick(k === "Home" ? 0 : k === "End" ? CHANNELS.length - 1 : i + (k === "ArrowRight" ? 1 : -1));
    document.getElementById(`hub2-tab-${CHANNELS[next]!.key}`)?.focus();
  };

  return (
    <section className="hub2" aria-labelledby="hub2-title">
      <div className="shell">
        <h2 id="hub2-title" className="sec-title">
          Nobody installs anything new
        </h2>
        <p className="sec-lede">Gran keeps her email and Telegram, Leo keeps Discord, your agent keeps its tools. Pick one and see what goes in, what comes back, and where the money is.</p>

        <div className="hub2-picker" role="tablist" aria-label="Channels" onKeyDown={onKey}>
          {CHANNELS.map((x, n) => (
            <button
              key={x.key}
              id={`hub2-tab-${x.key}`}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-controls="hub2-panel"
              tabIndex={n === i ? 0 : -1}
              className="hub2-tab"
              onClick={() => pick(n)}
            >
              <x.Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              {x.tab}
            </button>
          ))}
        </div>

        <div id="hub2-panel" role="tabpanel" aria-labelledby={`hub2-tab-${c.key}`} className="hub2-flow" data-run={run > 0 || undefined} key={`${c.key}-${run}`}>
          <div className="hub2-col">
            <p className="hub2-cap">{c.inCap}</p>
            <div className="hub2-card">
              <c.In />
              <p className="hub2-note">{c.how}</p>
            </div>
          </div>

          <span className="hub2-wire hub2-wire-a" aria-hidden="true">
            <i />
          </span>

          <div className="hub2-core">
            <span className="hub2-pill">
              <BrandMark />
              <span>
                <b>Spotter checks</b> rules, AI evidence, real prices
              </span>
            </span>
            <p className="hub2-checks">{c.checks}</p>
            <span className="hub2-wire hub2-wire-c" aria-hidden="true">
              <i />
            </span>
            <p className="hub2-money">
              <span className="hub2-money-top">
                <span className="hub-pp">PayPal</span>
                <span className="hub2-state" data-tone={c.money.tone}>
                  <i aria-hidden="true" />
                  {c.money.state}
                </span>
              </span>
              <span>{c.money.text}</span>
            </p>
          </div>

          <span className="hub2-wire hub2-wire-b" aria-hidden="true">
            <i />
          </span>

          <div className="hub2-col hub2-reply">
            <p className="hub2-cap">{c.outCap}</p>
            <div className="hub2-card">
              <c.Out />
            </div>
          </div>
        </div>

        <div className="hub2-end">{cta}</div>
      </div>
    </section>
  );
}
