"use client";
// Sign out. For a demo family it asks first, because signing out deletes the family for good.
import { useRef } from "react";
import { Confirm } from "./Confirm";

export function SignOut({ demo, className, label = "Sign out" }: { demo: boolean; className: string; label?: string }) {
  const form = useRef<HTMLFormElement>(null);
  if (!demo)
    return (
      <form action="/api/auth/logout" method="post">
        <button className={className}>{label}</button>
      </form>
    );
  // The confirm dialog has its own form, so it sits beside the sign out form, not inside it.
  return (
    <>
      <form ref={form} action="/api/auth/logout" method="post" hidden />
      <Confirm
        trigger={label}
        triggerClass={className}
        title="Leave the demo family?"
        body="Signing out ends this demo. Its people and payments are deleted, and you can start a fresh demo any time."
        confirmLabel="Sign out"
        onConfirm={() => form.current?.requestSubmit()}
      />
    </>
  );
}
