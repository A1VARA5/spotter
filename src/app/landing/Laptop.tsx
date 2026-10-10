// A MacBook Pro 14" with the spotter's own screen: Spotter's "Waiting for you" view, where the case agent's
// checks arrive one by one, then the spotter denies. The app is drawn at 1024 x 640 and scaled with the lid,
// so it keeps real proportions. Timings line up with Gran's phone in the hero (her held message lands at 1.9 s).
import { Check, CircleAlert, Hand, Users } from "lucide-react";
import { BrandMark } from "@/ui/components";

const CHECKS = [
  { icon: Users, tool: "Family history", text: "Gran has never paid jamie.k1994@gmail.com before." },
  { icon: CircleAlert, tool: "Spotter network", text: "Another Spotter family said no to this address this month." },
  { icon: Hand, tool: "PayPal", text: "£250 is on hold. If nobody approves it, nothing is paid." },
] as const;

function App() {
  return (
    <div className="lap-app">
      <aside className="lap-side">
        <p className="lap-brand">
          <BrandMark />
          Spotter
        </p>
        <p className="lap-house">
          Sam
          <span>PayPal sandbox</span>
        </p>
        <nav className="lap-nav">
          <span className="lap-link" data-on="true">
            Waiting for you <b className="num">1</b>
          </span>
          <span className="lap-link">Activity</span>
          <span className="lap-link">Try a payment</span>
          <span className="lap-link">Account</span>
        </nav>
        <p className="lap-heading">People</p>
        <span className="lap-person">
          <i data-kind="person">G</i>Gran
        </span>
        <span className="lap-person">
          <i data-kind="kid">L</i>Leo
        </span>
        <span className="lap-person">
          <i data-kind="agent">A</i>Shopping agent
        </span>
      </aside>

      <section className="lap-main">
        <h3 className="lap-title">Waiting for you</h3>
        <article className="lap-card">
          <header className="lap-card-head">
            <span className="lap-avatar" data-kind="person">
              G
            </span>
            <div>
              <p className="lap-ask">Gran wants to pay £250.00</p>
              <p className="lap-to">To jamie.k1994@gmail.com, forwarded from Telegram</p>
            </div>
            <span className="lap-pill">
              <span className="lap-pill-hold">On hold at PayPal</span>
              <span className="lap-pill-done">Denied</span>
            </span>
          </header>

          <div className="lap-case">
            <p className="lap-case-title">
              <span className="lap-spin" aria-hidden="true" />
              Spotter looked into it
            </p>
            <ul className="lap-checks">
              {CHECKS.map(({ icon: Icon, tool, text }) => (
                <li key={tool}>
                  <Icon size={18} strokeWidth={2} />
                  <span>
                    <b>{tool}</b> {text}
                  </span>
                </li>
              ))}
            </ul>
            <p className="lap-verdict">
              <b>This looks like the Hi Mum scam.</b> Call James on the number you already have for him before you decide.
            </p>
          </div>

          <footer className="lap-actions">
            <span className="lap-btn">Approve £250</span>
            <span className="lap-btn lap-deny">Deny</span>
            <span className="lap-done">
              <Check size={18} strokeWidth={2.4} /> Denied. PayPal released the hold, nothing was paid.
            </span>
          </footer>
          <span className="lap-cursor" aria-hidden="true" />
        </article>
      </section>
    </div>
  );
}

export function Laptop() {
  return (
    <div className="lap" role="img" aria-label="Your laptop: Spotter shows Gran's £250 payment on hold, the checks it ran, and you deny it">
      <div className="lap-lid">
        <span className="lap-notch" aria-hidden="true" />
        <div className="lap-screen">
          <App />
        </div>
      </div>
      <div className="lap-base" aria-hidden="true">
        <span className="lap-groove" />
      </div>
    </div>
  );
}
