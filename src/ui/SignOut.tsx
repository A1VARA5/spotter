"use client";
// Sign out. For a demo family it asks first, because signing out deletes the family for good.
import { useRef } from "react";
import { Confirm } from "./Confirm";

export function SignOut({ demo, className, label = "Sign out" }: { demo: boolean; className: string; label?: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action="/api/auth/logout" method="post">
      {demo ? (
        <Confirm
          trigger={label}
          triggerClass={className}
          title="Leave the demo family?"
          body="Signing out ends this demo. Its people and payments are deleted, and you can start a fresh demo any time."
          confirmLabel="Sign out"
          onConfirm={() => form.current?.requestSubmit()}
        />
      ) : (
        <button className={className}>{label}</button>
      )}
    </form>
  );
}
