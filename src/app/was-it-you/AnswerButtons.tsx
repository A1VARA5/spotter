"use client";
import { useEffect, useRef, useState } from "react";
import { plainError, readJson } from "@/ui/http";

export function AnswerButtons({ token, answered }: { token: string; answered: "not_me" | "it_was_me" | null }) {
  const [busy, setBusy] = useState<"not_me" | "it_was_me" | null>(null);
  const [reply, setReply] = useState<string | null>(answered ? `You already answered "${answered === "not_me" ? "Not me" : "Yes, it's me"}".` : null);
  const [error, setError] = useState<string | null>(null);
  const out = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (reply && !answered) out.current?.focus();
  }, [reply, answered]);

  async function send(answer: "not_me" | "it_was_me") {
    if (busy) return;
    setBusy(answer);
    setError(null);
    try {
      const r = await fetch("/api/was-it-you", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, answer }) });
      const j = await readJson(r);
      if (!j.reply) throw new Error(j.error ?? `That didn't go through (${r.status}).`);
      setReply(j.reply);
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wiy-answer">
      {reply ? (
        <p ref={out} tabIndex={-1} className="dash-notice" role="status">
          {reply}
        </p>
      ) : (
        <div className="held-actions">
          <button className="btn btn-stop" aria-disabled={busy !== null || undefined} onClick={() => send("not_me")}>
            {busy === "not_me" ? "Releasing" : "Not me"}
          </button>
          <button className="btn btn-quiet" aria-disabled={busy !== null || undefined} onClick={() => send("it_was_me")}>
            {busy === "it_was_me" ? "Saving" : "Yes, it's me"}
          </button>
        </div>
      )}
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
