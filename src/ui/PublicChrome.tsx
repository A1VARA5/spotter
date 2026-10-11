// The one header and footer every public page uses: the landing, /how, /privacy, /terms, /was-it-you and the agent
// lab before sign in. Same links, same order, same dark band, so moving between them never feels like another site.
// On the landing and /how the header sits inside their dark hero; elsewhere `band` gives it a dark strip of its own.
import Link from "next/link";
import { BrandMark } from "./components";

type Page = "home" | "how" | "privacy" | "terms" | "lab" | "other";

export function PublicHeader({ signedIn, current = "other", band = false }: { signedIn: boolean; current?: Page; band?: boolean }) {
  const header = (
    <header className="lnav">
      <Link href="/" className="brand brand-light" aria-label="Spotter home" aria-current={current === "home" ? "page" : undefined}>
        <BrandMark />
        Spotter
      </Link>
      <nav className="lnav-links" aria-label="Main">
        <Link href="/how" aria-current={current === "how" ? "page" : undefined}>
          How it works
        </Link>
        <Link href="/how#faq">FAQ</Link>
        <Link href="/agent-lab" aria-current={current === "lab" ? "page" : undefined}>
          Agent lab
        </Link>
        {signedIn ? (
          <Link href="/dashboard" className="lnav-login">
            Dashboard
          </Link>
        ) : (
          <a href="/api/auth/paypal/start" className="lnav-login">
            Log in
          </a>
        )}
      </nav>
    </header>
  );
  if (!band) return header;
  return (
    <div className="pub-band pub-band-top">
      <div className="shell">{header}</div>
    </div>
  );
}

export function PublicFooter({ band = false }: { band?: boolean }) {
  const footer = (
    <footer className="lfoot" data-band={band || undefined}>
      <Link href="/" className="brand brand-light" aria-label="Spotter home">
        <BrandMark />
        Spotter
      </Link>
      <nav className="lfoot-links" aria-label="Footer">
        <Link href="/how">How it works</Link>
        <Link href="/how#faq">FAQ</Link>
        <Link href="/agent-lab">Agent lab</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <p className="lfoot-fine">Built for the PayPal AI Hackathon. Sandbox only: no real money moves.</p>
    </footer>
  );
  if (!band) return footer;
  return (
    <div className="pub-band pub-band-foot">
      <div className="shell">{footer}</div>
    </div>
  );
}
