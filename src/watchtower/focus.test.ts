import { describe, expect, it } from "vitest";
import type { AgAiHarness, AgAiThreadSummary } from "ag-studio";
import { focusable } from "./focus";

// A stand in for AG's harness and the chat panel's rule: keep the active thread while getThread knows
// it, otherwise open the newest. createThread tells listeners synchronously, as AG's does.
function fakeHarness() {
  let threads: AgAiThreadSummary[] = [{ threadId: "old", agentId: "lead", updatedAt: 1 }];
  const listeners = new Set<() => void>();
  const inner = {
    get threads() {
      return threads;
    },
    agents: [],
    getAgent: () => undefined,
    getThread: (id: string) => threads.find((t) => t.threadId === id),
    openThread: async (id: string) => ({ threadId: id }) as never,
    createThread: async (opts: { agentId: string; title?: string }) => {
      const t = { threadId: `t${threads.length}`, agentId: opts.agentId, title: opts.title, updatedAt: threads.length + 1 };
      threads = [...threads, t];
      for (const l of listeners) l();
      return { threadId: t.threadId, sendMessage() {} } as never;
    },
    deleteThread: async () => {},
    addEventListener: (_: "changed", l: () => void) => listeners.add(l),
    removeEventListener: (_: "changed", l: () => void) => listeners.delete(l),
  } as unknown as AgAiHarness;
  return inner;
}

function panel(h: AgAiHarness) {
  let active = "old";
  h.addEventListener("changed", () => {
    if (h.getThread(active)) return;
    active = h.threads.at(-1)!.threadId;
    void h.openThread(active);
  });
  return { active: () => active };
}

describe("focusable harness", () => {
  it("passes everything through untouched", async () => {
    const h = focusable(fakeHarness());
    expect(h.getThread("old")?.threadId).toBe("old");
    expect(h.threads).toHaveLength(1);
    const s = await h.createThread({ agentId: "lead" });
    expect(s.threadId).toBe("t1");
  });

  it("makes the chat panel switch to a thread opened from a widget, then behaves normally again", async () => {
    const h = focusable(fakeHarness());
    const p = panel(h);
    await h.createThread({ agentId: "lead" });
    expect(p.active()).toBe("old");
    const s = await h.createFocusedThread({ agentId: "lead", title: "Look into: Gran" });
    expect(p.active()).toBe(s.threadId);
    expect(h.getThread("old")?.threadId).toBe("old");
  });
});
