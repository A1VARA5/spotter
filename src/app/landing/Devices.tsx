// Realistic device frames for the landing page. Built in HTML and CSS so the content is real text.
import { BrandMark } from "@/ui/components";

function StatusBar({ dark = false }: { dark?: boolean }) {
  const c = dark ? "#fff" : "#000";
  return (
    <div className="ios-status" style={{ color: c }} aria-hidden="true">
      <span className="ios-time">9:41</span>
      <span className="ios-icons">
        <svg width="18" height="11" viewBox="0 0 18 11">
          <rect x="0" y="7" width="3" height="4" rx="1" fill={c} />
          <rect x="5" y="5" width="3" height="6" rx="1" fill={c} />
          <rect x="10" y="2.5" width="3" height="8.5" rx="1" fill={c} />
          <rect x="15" y="0" width="3" height="11" rx="1" fill={c} />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11">
          <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.1A9.9 9.9 0 0 0 8 .6 9.9 9.9 0 0 0 .9 3.5L2 4.6c1.6-1.5 3.7-2.4 6-2.4Z" fill={c} />
          <path d="M8 5.4c1.4 0 2.7.5 3.7 1.4l1.1-1.1A7 7 0 0 0 8 3.8a7 7 0 0 0-4.8 1.9l1.1 1.1c1-.9 2.3-1.4 3.7-1.4Z" fill={c} />
          <circle cx="8" cy="9.3" r="1.6" fill={c} />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" stroke={c} strokeOpacity="0.4" fill="none" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill={c} />
          <rect x="23.5" y="4" width="1.8" height="4" rx="0.9" fill={c} fillOpacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

export function Iphone({ children, dark = false, className = "" }: { children: React.ReactNode; dark?: boolean; className?: string }) {
  return (
    <div className={`iphone ${className}`}>
      <div className={dark ? "iphone-screen iphone-screen-dark" : "iphone-screen"}>
        <span className="iphone-island" aria-hidden="true" />
        <StatusBar dark={dark} />
        {children}
      </div>
    </div>
  );
}

/** Gran's phone: a text from a new number, then PayPal's send sheet, held by Spotter. */
export function GranPhone({ text }: { text: string }) {
  return (
    <Iphone className="iphone-gran">
      <div className="imsg-head">
        <span className="imsg-back" aria-hidden="true">
          ‹
        </span>
        <span className="imsg-avatar" aria-hidden="true" />
        <span className="imsg-name">+44 7700 900461</span>
      </div>
      <div className="imsg-body">
        <p className="imsg-when">Today 09:38</p>
        <p className="imsg-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </p>
        <p className="imsg-bubble">{text}</p>
      </div>
      <div className="pp-sheet">
        <div className="pp-row">
          <span className="pp-logo" aria-hidden="true">
            P
          </span>
          <span className="pp-title">Send to mate.payments</span>
        </div>
        <p className="pp-amount num">£250.00</p>
        <p className="pp-method">Friends and Family</p>
        <div className="pp-held">
          <BrandMark />
          <span>
            <strong>Held by Spotter.</strong> Sam has been asked.
          </span>
        </div>
      </div>
    </Iphone>
  );
}

/** The spotter's phone: a lock screen notification with the two choices. */
export function SpotterPhone() {
  return (
    <Iphone dark className="iphone-you">
      <div className="lock">
        <p className="lock-date">Thursday 12 November</p>
        <p className="lock-time num">9:41</p>
        <div className="notif">
          <div className="notif-top">
            <span className="notif-app">
              <BrandMark />
            </span>
            <span className="notif-name">Spotter</span>
            <span className="notif-when">now</span>
          </div>
          <p className="notif-title">Gran wants to pay £250</p>
          <p className="notif-body">A new number asked her for Friends and Family. The money is on hold.</p>
          <div className="notif-actions">
            <span>Deny</span>
            <span>Approve</span>
          </div>
        </div>
      </div>
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
