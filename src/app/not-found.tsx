// Any address Spotter doesn't have: the same public header and footer as every other page, what happened in one
// line, and two ways on (home, or straight into the demo). Synchronous on purpose, so it can't fail on a session read.
import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/ui/PublicChrome";
import { DemoStart } from "@/ui/DemoStart";
import { BrandMark } from "@/ui/components";

export const metadata = { title: "Page not found | Spotter" };

export default function NotFound() {
  return (
    <>
      <PublicHeader band signedIn={false} />
      <main className="shell nf">
        <p className="nf-code" aria-hidden="true">
          <BrandMark />
          404
        </p>
        <h1 className="page-title">There&apos;s no page here.</h1>
        <p className="lede nf-lede">The link may be old, or the address has a typo. Everything else on Spotter is where it was.</p>
        <div className="nf-actions">
          <DemoStart />
          <Link className="btn btn-quiet" href="/">
            Home
          </Link>
        </div>
        <p className="nf-more">
          Looking for something else? <Link href="/how">How Spotter works</Link> or <Link href="/status">what&apos;s working right now</Link>.
        </p>
      </main>
      <PublicFooter band />
    </>
  );
}
