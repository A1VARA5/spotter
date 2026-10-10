// AG's chat panel keeps whichever thread is open and only moves to the newest one when the open thread
// disappears from the harness. Studio has no public "show this thread" call, so to open a fresh chat from
// a widget ("Look into this"), the harness briefly reports the older threads as unknown while the new one
// is created. The panel then opens the newest: ours. Everything else passes straight through.
import type { AgAiChatSession, AgAiHarness, AgAiNewThreadOptions } from "ag-studio";

export type FocusableHarness = AgAiHarness & { createFocusedThread(opts: AgAiNewThreadOptions): Promise<AgAiChatSession> };

export function focusable(inner: AgAiHarness): FocusableHarness {
  let hidden: Set<string> | null = null;
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "getThread") return (id: string) => (hidden?.has(id) ? undefined : target.getThread(id));
      if (prop === "createFocusedThread") {
        return async (opts: AgAiNewThreadOptions) => {
          hidden = new Set(target.threads.map((t) => t.threadId));
          try {
            return await target.createThread(opts);
          } finally {
            hidden = null;
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as FocusableHarness;
}
