"use client";
// Incident pages (opened by code, up to three: src/watchtower/incidents.ts) live behind one "Incidents (N)"
// menu, so the tab row stays short and names are never cut off. Each one can be opened or removed from here.
import { useCallback, useId, useRef, useState } from "react";
import { Confirm } from "@/ui/Confirm";
import type { PageTab } from "@/watchtower/pages";
import { useDismiss } from "./useDismiss";

const short = (name: string) => name.replace(/^Incident:\s*/, "");

export function IncidentsMenu({ incidents, open: openPage, onShow, onRemove, canRemove }: { incidents: PageTab[]; open: PageTab | null; onShow: (id: string) => void; onRemove: (id: string) => void; canRemove: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap, ".wt-inc-btn");
  if (!incidents.length) return null;
  return (
    <div className="wt-inc" ref={wrap} data-current={openPage ? "" : undefined}>
      <button type="button" className="wt-inc-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        Incidents ({incidents.length}){openPage ? <span className="wt-inc-now">: {short(openPage.name)}</span> : null} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul id={menuId} className="wt-inc-list" aria-label="Incident pages">
          {incidents.map((t) => (
            <li key={t.id} className="wt-inc-item" data-current={t.id === openPage?.id || undefined}>
              <button
                type="button"
                className="wt-inc-show"
                aria-current={t.id === openPage?.id ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onShow(t.id);
                }}
              >
                {t.name}
              </button>
              {canRemove && t.removable && (
                <Confirm
                  trigger={<span aria-hidden="true">×</span>}
                  triggerClass="wt-inc-x"
                  triggerLabel={`Remove the page ${t.name}`}
                  title={`Remove "${t.name}"?`}
                  body="The page and its widgets go. Your payments stay, and Spotter won't bring this page back."
                  confirmLabel="Remove page"
                  onConfirm={() => {
                    setOpen(false);
                    onRemove(t.id);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
