import { TopBar } from "@/ui/components";
import { getDeps } from "@/server/deps";
import { askLines, findAsk } from "@/core/was-it-you";
import { getSpender } from "@/core/lifecycle";
import { AnswerButtons } from "./AnswerButtons";

export const dynamic = "force-dynamic";
// The token is in the address: never pass it on to another site.
export const metadata = { title: "Was it you? | Spotter", referrer: "no-referrer" as const, robots: { index: false } };

/** Why there are no buttons: answered already, the payment is settled, or the question ran out. */
function closedLine(state: string, status: string): string {
  const answered = state === "not_me" ? "You answered: not me. " : state === "it_was_me" ? "You answered: it was me. " : "";
  const what =
    status === "captured" || status === "capturing"
      ? "The payment was approved and paid."
      : status === "voided" || status === "voiding"
        ? "The payment was stopped. Nothing was paid."
        : status === "needs_approval"
          ? state === "asked"
            ? "This question has run out. Nothing changed. If something looks wrong, ring the family on a number you already have."
            : "It's still on hold for the spotter to decide."
          : "Nothing was paid.";
  return answered + what;
}

// Opening this page changes nothing (mail scanners open links). Only the buttons answer.
export default async function WasItYouPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const { db } = await getDeps();
  const found = t ? await findAsk(db, t) : null;
  const payer = found ? await getSpender(db, found.p.spender_id) : null;
  return (
    <main className="shell legal wiy-page">
      <TopBar />
      {!found || !payer ? (
        <>
          <h1 className="page-title">This link isn&apos;t valid</h1>
          <p className="lede">It may be mistyped or for someone else. Nothing changed. If a message asked your family for money, ring them on a number you already have.</p>
        </>
      ) : (
        <>
          <h1 className="page-title">{askLines(found.p, payer, found.w)[0]}</h1>
          <p className="lede">{askLines(found.p, payer, found.w)[1]}</p>
          {found.w.state === "asked" && found.p.status === "needs_approval" && new Date(found.w.expiresAt).getTime() > Date.now() ? (
            <>
              <p>
                PayPal is holding {payer.name}&apos;s money while we check. If it wasn&apos;t you, Not me releases it straight away. Yes, it&apos;s me doesn&apos;t pay
                anything: {payer.spotter_name} still decides with their PIN.
              </p>
              <AnswerButtons token={t!} answered={null} />
            </>
          ) : (
            <p className="dash-notice">{closedLine(found.w.state, found.p.status)}</p>
          )}
        </>
      )}
    </main>
  );
}
