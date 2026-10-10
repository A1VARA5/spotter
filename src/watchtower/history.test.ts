import { describe, expect, it, vi } from "vitest";
import type { AgAiThread } from "ag-studio";
import { serverHistory } from "./history";

const thread = { summary: { threadId: "t1", agentId: "lead", updatedAt: 3 }, messages: [] } as unknown as AgAiThread;

function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    const r = routes[`${method} ${url}`] ?? { status: 404, body: { error: "nope" } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("watchtower chat history store", () => {
  it("lists, loads, saves and deletes through the server", async () => {
    const f = fakeFetch({
      "GET /api/watchtower/threads": { body: { threads: [thread.summary] } },
      "GET /api/watchtower/threads/t1": { body: { thread } },
      "PUT /api/watchtower/threads/t1": { body: { ok: true } },
      "DELETE /api/watchtower/threads/t1": { body: { ok: true } },
    });
    const h = serverHistory({ fetch: f.fn });
    expect(await h.listThreads()).toEqual([thread.summary]);
    expect(await h.loadThread("t1")).toEqual(thread);
    await h.saveThread(thread);
    expect(JSON.parse(f.calls.find((c) => c.method === "PUT")!.body!)).toEqual(thread);
    await h.deleteThread("t1");
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toContain("DELETE /api/watchtower/threads/t1");
  });

  it("treats a missing chat as undefined and an outage as an empty roster, saying so in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeFetch({ "GET /api/watchtower/threads": { status: 500, body: { error: "down" } } });
    const h = serverHistory({ fetch: f.fn });
    expect(await h.loadThread("t9")).toBeUndefined();
    expect(await h.listThreads()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("doesn't throw when a save is refused (too big), it warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeFetch({ "PUT /api/watchtower/threads/t1": { status: 413, body: { error: "That's too big to save." } } });
    await expect(serverHistory({ fetch: f.fn }).saveThread(thread)).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.join(" "))).toMatch(/too big/);
    warn.mockRestore();
  });

  it("escapes thread ids in the url", async () => {
    const f = fakeFetch({});
    await serverHistory({ fetch: f.fn }).loadThread("a/b");
    expect(f.calls[0]!.url).toBe("/api/watchtower/threads/a%2Fb");
  });
});
