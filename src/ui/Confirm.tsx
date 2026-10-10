"use client";
// A confirm step for things that can't be undone. Built on the native <dialog>, which handles focus,
// Escape and the backdrop for us.
import { useId, useRef } from "react";

export function Confirm({
  trigger,
  title,
  body,
  confirmLabel,
  onConfirm,
  triggerClass = "btn btn-quiet",
  triggerLabel,
  disabled,
}: {
  trigger: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  triggerClass?: string;
  triggerLabel?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // One id per dialog: pages with Sign out plus another confirm used to name both dialogs after the first.
  const titleId = useId();
  const bodyId = useId();
  return (
    <>
      <button type="button" className={triggerClass} aria-label={triggerLabel} disabled={disabled} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={ref} className="confirm" aria-labelledby={titleId} aria-describedby={bodyId}>
        <form method="dialog" className="confirm-box">
          <h2 id={titleId} className="confirm-title">
            {title}
          </h2>
          <p id={bodyId} className="confirm-body">{body}</p>
          <div className="confirm-actions">
            <button className="btn btn-quiet" value="cancel" autoFocus>
              Keep it
            </button>
            <button className="btn btn-deny" value="ok" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
