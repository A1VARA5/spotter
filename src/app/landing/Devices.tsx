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

/** iMessage: a text from an unknown number. */
export function IMessage({ text }: { text: string }) {
  return (
    <>
      <div className="imsg-nav">
        <span className="imsg-back">
          <Chevron />
        </span>
        <span className="imsg-contact">
          <PersonGlyph />
          <span className="imsg-num">
            +44 7700 900461 <i>›</i>
          </span>
        </span>
      </div>
      <div className="imsg-thread">
        <p className="imsg-meta">
          Text Message
          <br />
          Today 09:38
        </p>
        <p className="imsg-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </p>
        <p className="imsg-bubble">{text}</p>
      </div>
    </>
  );
}

export type SheetState = "pay" | "checking" | "held" | "released";

/** PayPal's send sheet, as Spotter sees it through: about to pay, being checked, held, or released. */
export function PayPalSheet({ state = "held" }: { state?: SheetState }) {
  return (
    <div className="ios-sheet" data-state={state}>
      <span className="ios-grabber" aria-hidden="true" />
      <div className="pp-head">
        <span className="pp-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M7.6 21.4H4.1L6.9 3.1h6.3c3.9 0 6.2 2 5.5 5.6-.7 3.9-3.4 5.8-7.3 5.8H9.1l-1.5 6.9Z" fill="#003087" />
            <path d="M19.3 8.1c-.8 4-3.6 6.2-7.6 6.2h-1.3l-1.1 7.1H6.6l.3-1.6h1.9l1.1-6.6h1.9c3.6 0 6.2-1.8 6.9-5.5l.6.4Z" fill="#0079c1" />
          </svg>
        </span>
        <span className="pp-to">
          Send to <b>mate.payments</b>
        </span>
      </div>
      <p className="pp-amount num">£250.00</p>
      <p className="pp-method">Friends and Family, no purchase protection</p>
      {state === "pay" && <span className="pp-send">Send £250.00</span>}
      {state === "checking" && (
        <div className="pp-held pp-checking">
          <span className="pp-spin" aria-hidden="true" />
          <span>
            <b>Spotter is checking</b> before anything moves.
          </span>
        </div>
      )}
      {state === "held" && (
        <div className="pp-held">
          <BrandMark />
          <span>
            <b>Held by Spotter.</b> Sam has been asked to look first.
          </span>
        </div>
      )}
      {state === "released" && (
        <div className="pp-held pp-released">
          <BrandMark />
          <span>
            <b>Not sent.</b> Sam said no, so PayPal released the hold. Nothing left your account.
          </span>
        </div>
      )}
    </div>
  );
}

/** Gran's phone: a text from a new number, then PayPal's send sheet, held by Spotter. */
export function GranPhone({ text, scale }: { text: string; scale?: number }) {
  return (
    <Iphone scale={scale} className="iphone-gran" label="Gran's phone: a text from a new number asking for £250 by Friends and Family, and the PayPal payment held by Spotter">
      <IMessage text={text} />
      <PayPalSheet state="held" />
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
        <IosNotification title="Gran wants to pay £250" body="A new number asked her for Friends and Family. The money is on hold until you decide." />
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
