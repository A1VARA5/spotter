"use client";
// Starting a demo family switches the session to it. Someone already signed in gets asked first, so a
// click on /how never quietly swaps out the family they were looking at.
import { useRef } from "react";
import { Confirm } from "@/ui/Confirm";

export function NewDemo({ demo }: { demo: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <>
      {/* A sibling, not a wrapper: Confirm has its own <form method="dialog"> and forms can't nest. */}
      <form ref={form} action="/api/demo/start" method="post" hidden />
      <Confirm
        trigger="Start a new demo family"
        triggerClass="btn btn-ghost"
        title="Start a new demo family?"
        body={
          demo
            ? "You'll move to a fresh demo family. The one you're in now is left behind, along with its payments, and deleted within 48 hours."
            : "You'll be signed out of your family and moved to a separate demo family with fake money. Your family's payments stay as they are: log in with PayPal to come back."
        }
        confirmLabel="Start a new one"
        onConfirm={() => form.current?.requestSubmit()}
      />
    </>
  );
}
