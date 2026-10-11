// Device mockups. Screens are laid out at a real iPhone's size (393 x 852 points) with iOS measurements, then
// the whole device is scaled down, so proportions, type and spacing match a real phone instead of a drawing.
import { BrandMark } from "@/ui/components";

const W = 393;
const H = 852;

function StatusBar({ dark = false }: { dark?: boolean }) {
  const c = dark ? "#fff" : "#000";
  return (
    <div className="ios-status" style={{ color: c }} aria-hidden="true">
      <span className="ios-time">9:41</span>
      <span className="ios-icons">
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.9" fill={c} />
          <rect x="5.2" y="5" width="3.2" height="7" rx="0.9" fill={c} />
          <rect x="10.4" y="2.5" width="3.2" height="9.5" rx="0.9" fill={c} />
          <rect x="15.6" y="0" width="3.2" height="12" rx="0.9" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 2.3c2.5 0 4.7.9 6.4 2.5l1.2-1.2A10.6 10.6 0 0 0 8.5.6 10.6 10.6 0 0 0 .9 3.6l1.2 1.2c1.7-1.6 3.9-2.5 6.4-2.5Z" fill={c} />
          <path d="M8.5 5.7c1.5 0 2.8.5 3.9 1.5l1.2-1.2A7.4 7.4 0 0 0 8.5 4a7.4 7.4 0 0 0-5.1 2l1.2 1.2c1-1 2.4-1.5 3.9-1.5Z" fill={c} />
          <path d="M8.5 9.1c.6 0 1.2.2 1.6.6L8.5 11.4 6.9 9.7c.4-.4 1-.6 1.6-.6Z" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke={c} strokeOpacity="0.35" fill="none" />
          <rect x="2" y="2" width="20" height="9" rx="2.4" fill={c} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill={c} fillOpacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

/** An iPhone 15 Pro: titanium rim, black bezel, side buttons, Dynamic Island, glass glare. */
export function Iphone({ children, dark = false, scale = 0.62, className = "", label }: { children: React.ReactNode; dark?: boolean; scale?: number; className?: string; label?: string }) {
  const outerW = W + 2 * 14;
  const outerH = H + 2 * 14;
  return (
    <div className={`device ${className}`} style={{ width: outerW * scale, height: outerH * scale }} role={label ? "img" : undefined} aria-label={label}>
      <div className="device-body" style={{ width: outerW, height: outerH, transform: `scale(${scale})` }}>
        <span className="device-btn device-btn-action" aria-hidden="true" />
        <span className="device-btn device-btn-up" aria-hidden="true" />
        <span className="device-btn device-btn-down" aria-hidden="true" />
        <span className="device-btn device-btn-power" aria-hidden="true" />
        <div className={dark ? "device-screen device-screen-dark" : "device-screen"} style={{ width: W, height: H }}>
          <span className="device-island" aria-hidden="true" />
          <StatusBar dark={dark} />
          {children}
          <span className="device-home" aria-hidden="true" />
          <span className="device-glare" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
      <path d="M10 2 2 10l8 8" stroke="#0a84ff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 50 50" width="50" height="50" aria-hidden="true">
      <defs>
        <linearGradient id="av" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a4abb6" />
          <stop offset="1" stopColor="#858c98" />
        </linearGradient>
      </defs>
      <circle cx="25" cy="25" r="25" fill="url(#av)" />
      <circle cx="25" cy="19.5" r="8" fill="#fff" />
      <path d="M10.5 41.5c2.6-6.6 8.2-10 14.5-10s11.9 3.4 14.5 10A24.9 24.9 0 0 1 25 50a24.9 24.9 0 0 1-14.5-8.5Z" fill="#fff" />
    </svg>
  );
}

/** Gran's phone in the hero: she forwarded the ask to Spotter on Telegram, and the money is on hold. */
export function GranPhone({ scale }: { scale?: number; text?: string }) {
  return (
    <Iphone scale={scale} className="iphone-gran" label="Gran's phone: she forwarded a scam asking for £250 to Spotter on Telegram, and Spotter put the payment on hold">
      <TelegramScreen step="held" />
    </Iphone>
  );
}

export function IosNotification({ title, body, when = "now" }: { title: string; body: string; when?: string }) {
  return (
    <div className="ios-notif">
      <span className="ios-notif-icon">
        <BrandMark />
      </span>
      <div className="ios-notif-text">
        <p className="ios-notif-top">
          <b>{title}</b>
          <span>{when}</span>
        </p>
        <p className="ios-notif-body">{body}</p>
      </div>
    </div>
  );
}

/** The menu iOS shows when you press and hold a notification. */
export function IosActions({ items }: { items: Array<{ label: string; tone?: "danger" }> }) {
  return (
    <div className="ios-actions">
      {items.map((i) => (
        <span key={i.label} className="ios-action" data-tone={i.tone}>
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** A lock screen with whatever sits under the clock. */
export function LockScreen({ children, date = "Thursday 12 November" }: { children?: React.ReactNode; date?: string }) {
  return (
    <div className="lock">
      <p className="lock-date">{date}</p>
      <p className="lock-time">9:41</p>
      <div className="lock-stack">{children}</div>
      <div className="lock-corners" aria-hidden="true">
        <span>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M9 2h6l-1 6h3l-6 14v-9H8l1-11Z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.5" fill="none" stroke="#fff" strokeWidth="1.8" />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** The spotter's phone: a lock screen notification, pressed and held to show the choices. */
export function SpotterPhone({ scale }: { scale?: number }) {
  return (
    <Iphone dark scale={scale} className="iphone-you" label="Your phone: a Spotter notification saying Gran wants to pay £250, with Approve and Deny">
      <LockScreen>
        <IosNotification title="Gran wants to pay £250" body="To jamie.k1994@mail.example, a first time payee. It looks like the Hi Mum scam. The money is on hold." />
        <IosActions items={[{ label: "Approve £250" }, { label: "Deny", tone: "danger" }, { label: "Open Spotter" }]} />
      </LockScreen>
    </Iphone>
  );
}

export function Browser({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="browser">
      <div className="browser-bar" aria-hidden="true">
        <span className="browser-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="browser-url">{url}</span>
      </div>
      <div className="browser-page">{children}</div>
    </div>
  );
}

export const SCAM = {
  sms: "Hi mum I'm texting you off a friends phone I've smashed mine. Message me on my new number please x",
  number: "+44 7700 900461",
  chat: [
    { me: false, text: "Hi mum its me, new number 🙂", at: "09:31" },
    { me: true, text: "Hello love, are you ok?", at: "09:33" },
    { me: false, text: "Not really, phones dead and I cant get into my banking on this one", at: "09:34" },
    { me: false, text: "I've got a bill that has to be paid today or I get a late fee. Can you send £250 to my mate Jamie's PayPal and I'll pay you back tomorrow", at: "09:34" },
    { me: false, text: "jamie.k1994@mail.example", at: "09:35" },
    { me: false, text: "Please hurry mum x", at: "09:35" },
  ],
} as const;

function WaTick() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" aria-hidden="true">
      <path d="M1 6l3 3 6-7M6 9l1 1 6-8" fill="none" stroke="#5d6b78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Messages: the opening text from a stranger's number. */
export function SmsScreen({ number = SCAM.number, text = SCAM.sms, at = "09:28" }: { number?: string; text?: string; at?: string } = {}) {
  return (
    <>
      <div className="imsg-nav">
        <span className="imsg-back">
          <Chevron />
        </span>
        <span className="imsg-contact">
          <PersonGlyph />
          <span className="imsg-num">
            {number} <i>›</i>
          </span>
        </span>
      </div>
      <div className="imsg-thread">
        <p className="imsg-meta">
          Text Message
          <br />
          Today {at}
        </p>
        <p className="imsg-bubble">{text}</p>
      </div>
    </>
  );
}

/** A chat app: the "new number" asks for the money and names who to pay. */
export function ChatScreen({ upto = SCAM.chat.length }: { upto?: number }) {
  return (
    <div className="wa">
      <div className="wa-bar">
        <Chevron />
        <span className="wa-av" aria-hidden="true" />
        <span className="wa-who">
          <b>{SCAM.number}</b>
          <i>online</i>
        </span>
      </div>
      <div className="wa-chat">
        <p className="wa-day">Today</p>
        {SCAM.chat.slice(0, upto).map((m, i) => (
          <p key={i} className={m.me ? "wa-msg wa-me" : "wa-msg"}>
            <span>{m.text}</span>
            <i>
              {m.at}
              {m.me && <WaTick />}
            </i>
          </p>
        ))}
      </div>
    </div>
  );
}

export type TgStep = "forwarded" | "checking" | "held" | "denied";

/** Telegram: Gran forwards the message to the Spotter bot, and Spotter answers in the same chat. */
export function TelegramScreen({ step }: { step: TgStep }) {
  return (
    <div className="tg">
      <div className="tg-bar">
        <Chevron />
        <span className="tg-av">
          <BrandMark />
        </span>
        <span className="tg-who">
          <b>Spotter</b>
          <i>bot</i>
        </span>
      </div>
      <div className="tg-chat">
        <div className="tg-msg tg-me tg-fwd">
          <span className="tg-fwd-from">Forwarded from {SCAM.number}</span>
          <span>{SCAM.chat[3].text}</span>
          <span className="tg-mail">{SCAM.chat[4].text}</span>
          <i>09:36 ✓✓</i>
        </div>
        <div className="tg-msg tg-me">
          <span>Is this alright to pay? It's from James</span>
          <i>09:36 ✓✓</i>
        </div>
        {step === "checking" && (
          <div className="tg-msg tg-bot tg-typing" aria-label="Spotter is checking">
            <span className="tg-dots">
              <b />
              <b />
              <b />
            </span>
          </div>
        )}
        {(step === "held" || step === "denied") && (
          <div className="tg-msg tg-bot">
            <span>
              <b>On hold, nothing has left your account.</b> £250 to jamie.k1994@mail.example is waiting for Sam. This looks like the &ldquo;Hi Mum&rdquo; scam: a new number, can&apos;t use their bank, pay a friend instead.
            </span>
            <i>09:36</i>
          </div>
        )}
        {step === "denied" && (
          <div className="tg-msg tg-bot tg-bot-ok">
            <span>
              <b>Sam said no, so nothing was paid.</b> If it might really be James, call him on the number you already have.
            </span>
            <i>09:41</i>
          </div>
        )}
        {step === "denied" && (
          <div className="tg-msg tg-me">
            <span>Thank you love x</span>
            <i>09:42 ✓✓</i>
          </div>
        )}
      </div>
    </div>
  );
}
