// AG Studio's chat history, kept on our server per family (AgAiHistoryStore). The harness debounces saves.
// A failed save or list is logged and never thrown: the chat on screen carries on, it just isn't kept.
import type { AgAiHistoryStore, AgAiHistoryStoreEventListener, AgAiThread, AgAiThreadSummary } from "ag-studio";

/** `onProblem` gets a sentence to show the family when a chat can't be kept or listed. */
export function serverHistory(opts: { base?: string; fetch?: typeof fetch; onProblem?: (message: string) => void } = {}): AgAiHistoryStore {
  const tell = (m: string) => opts.onProblem?.(m);
  const base = opts.base ?? "/api/watchtower/threads";
  const call = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = (id?: string) => (id === undefined ? base : `${base}/${encodeURIComponent(id)}`);
  const listeners = new Set<AgAiHistoryStoreEventListener>();
  const problem = async (res: Response) => ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `status ${res.status}`;

  return {
    async listThreads(): Promise<AgAiThreadSummary[]> {
      try {
        const res = await call(url());
        if (!res.ok) {
          console.warn("[watchtower] couldn't list saved chats:", await problem(res));
          tell("Couldn't load your saved chats. Refresh the page to try again.");
          return [];
        }
        return ((await res.json()) as { threads: AgAiThreadSummary[] }).threads;
      } catch (e) {
        console.warn("[watchtower] couldn't list saved chats:", e);
        return [];
      }
    },
    async loadThread(threadId: string): Promise<AgAiThread | undefined> {
      try {
        const res = await call(url(threadId));
        if (res.status === 404) return undefined;
        if (!res.ok) {
          console.warn(`[watchtower] couldn't load chat ${threadId}:`, await problem(res));
          return undefined;
        }
        return ((await res.json()) as { thread: AgAiThread }).thread;
      } catch (e) {
        console.warn(`[watchtower] couldn't load chat ${threadId}:`, e);
        return undefined;
      }
    },
    async saveThread(thread: AgAiThread): Promise<void> {
      try {
        const res = await call(url(thread.summary.threadId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(thread) });
        if (!res.ok) {
          console.warn(`[watchtower] chat ${thread.summary.threadId} wasn't saved:`, await problem(res));
          tell(res.status === 413 ? "This chat is too long to keep. Start a new chat." : "This chat wasn't saved. It stays on screen until you leave.");
        }
      } catch (e) {
        console.warn(`[watchtower] chat ${thread.summary.threadId} wasn't saved:`, e);
      }
    },
    async deleteThread(threadId: string): Promise<void> {
      try {
        const res = await call(url(threadId), { method: "DELETE" });
        if (!res.ok) console.warn(`[watchtower] chat ${threadId} wasn't deleted:`, await problem(res));
      } catch (e) {
        console.warn(`[watchtower] chat ${threadId} wasn't deleted:`, e);
      }
    },
    // Only this tab writes, so nothing external to report; kept so AG can subscribe.
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
}
