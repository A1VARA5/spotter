// Held tool calls: Spotter's harness on AG Studio's own approval surface. Watchtower's assistant reads text
// scammers wrote (payee names, case notes), so a board change whose arguments carry a run of those words
// (a tile titled with the scammer's instruction, say) doesn't run until the spotter says so. The gate sits
// inside the wrapped tool (execute is async, so it can wait), and holdingHarness makes the chat show it the
// way AG's types describe: the session reports `awaiting_input`, the call `awaiting_approval`, and
// `session.respond` answers it. AG's own harness never pauses, so nothing in AG reports these states itself.
// Reads are never gated, and no tool here can move money.
import type { AgAiChatMessage, AgAiChatSession, AgAiHarness, AgAiTool, AgAiToolCallResponse, AgAiToolContext, AgAiToolRunContext } from "ag-studio";
import { OUTCOME_WORDS } from "@/ui/labels";

/** A shared run this long (after normalising) counts as the scammer's words. Shorter runs ("the", "£5") never do. */
export const RUN = 12;
const MAX_QUOTE = 120;
/** What the agent is told when the spotter refuses (or the run stops while the call waits). */
export const REFUSED = "The spotter refused: this used words a scammer wrote.";

export type Taint = { readonly texts: readonly string[]; readonly grams: ReadonlySet<string> };

/** Lower case, invisible characters gone, punctuation and runs of spaces as one space. */
export function normalise(s: string): string {
  return s.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The attacker-written texts, normalised, with every RUN-long slice indexed so a lookup is cheap. */
export function taintIndex(texts: readonly string[]): Taint {
  const kept = [...new Set(texts.filter((t) => typeof t === "string").map(normalise).filter((t) => t.length >= RUN))];
  const grams = new Set<string>();
  for (const t of kept) for (let i = 0; i + RUN <= t.length; i++) grams.add(t.slice(i, i + RUN));
  return { texts: kept, grams };
}

/** Outcomes (data.ts row labels) where Spotter stepped in: held, stopped or blocked, denied, or moved to a protected method. */
const FLAGGED_OUTCOMES = new Set([OUTCOME_WORDS.held.short, OUTCOME_WORDS.blocked.short, OUTCOME_WORDS.returned.short, OUTCOME_WORDS.protected.short]);

/**
 * The words on the board a scammer could have written: payee names and the item a shop listed, from payments
 * Spotter stepped in on or found a scam sign in (an ordinary paid payee like a supermarket is no reason to
 * wait), plus scam signs' payees and the case note text (reasons and findings can quote the message).
 * Spotter's own fixed labels (outcome, top sign, verdict) are left out: they are ours, and a tile titled
 * "Pressure to hurry" is no reason to wait.
 */
export function scammerTexts(o: {
  payments: Iterable<{ payee: string; marketItem?: string; outcome: string; signs?: number }>;
  signs?: Iterable<{ payee: string }>;
  notes: Iterable<{ reasons: string[]; signs: Array<{ why: string }>; caseHeadline?: string; caseFindings?: string[] }>;
}): string[] {
  const out: string[] = [];
  for (const p of o.payments) if (FLAGGED_OUTCOMES.has(p.outcome) || (p.signs ?? 0) > 0) out.push(p.payee, p.marketItem ?? "");
  for (const s of o.signs ?? []) out.push(s.payee);
  for (const n of o.notes) out.push(...n.reasons, ...n.signs.map((s) => s.why), n.caseHeadline ?? "", ...(n.caseFindings ?? []));
  return out.filter((t) => typeof t === "string" && t !== "");
}

const strings = (v: unknown, depth = 0): string[] =>
  depth > 8 ? [] : typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap((x) => strings(x, depth + 1)) : v && typeof v === "object" ? Object.values(v).flatMap((x) => strings(x, depth + 1)) : [];

/** Whether any string in the call's arguments shares a RUN-long run with a scammer's text; `quote` is the longest such run. */
export function carries(t: Taint, args: unknown): { hit: boolean; quote?: string } {
  let best = "";
  for (const raw of strings(args)) {
    const s = normalise(raw);
    for (let i = 0; i + RUN <= s.length; i++) {
      if (!t.grams.has(s.slice(i, i + RUN))) continue;
      let j = i + RUN;
      while (j < s.length && t.texts.some((x) => x.includes(s.slice(i, j + 1)))) j++;
      const run = s.slice(i, j).trim();
      if (run.length > best.length) best = run;
      i = j - 1;
    }
  }
  return best.length >= RUN ? { hit: true, quote: best.length > MAX_QUOTE ? `${best.slice(0, MAX_QUOTE - 3).trimEnd()}...` : best } : { hit: false };
}

// ---------- the gate ----------

export type HeldCall = { toolCallId: string; name: string; quote: string; threadId?: string; args?: unknown };
export type HoldOutcome = "authorised" | "allowed" | "refused";
export type Gate = {
  /** Waits for the spotter. Settles "reject" if the signal aborts or cancelAll catches it. */
  ask(call: HeldCall & { signal?: AbortSignal }): Promise<"approve" | "reject">;
  /** Answers one waiting call. False when nothing is waiting under that id. */
  respond(toolCallId: string, response: AgAiToolCallResponse): boolean;
  pending(): HeldCall[];
  /** Refuses every waiting call, or those `where` picks. */
  cancelAll(where?: (c: HeldCall) => boolean): void;
  subscribe(cb: () => void): () => void;
};

export function createGate(): Gate {
  const waiting = new Map<string, { call: HeldCall; settle: (a: "approve" | "reject") => void }>();
  const subs = new Set<() => void>();
  // One array per change: React's useSyncExternalStore loops forever if every read is a new array.
  let snapshot: HeldCall[] = [];
  const emit = () => {
    snapshot = [...waiting.values()].map((w) => w.call);
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (e) {
        console.error("[watchtower] a held call listener failed:", e);
      }
    }
  };
  const answer = (id: string, a: "approve" | "reject") => {
    const w = waiting.get(id);
    if (!w) return false;
    waiting.delete(id);
    w.settle(a);
    emit();
    return true;
  };
  return {
    ask({ signal, ...call }) {
      // Already stopped, or the same id twice: refused, never run.
      if (signal?.aborted || waiting.has(call.toolCallId)) return Promise.resolve("reject");
      return new Promise((resolve) => {
        const onAbort = () => answer(call.toolCallId, "reject");
        signal?.addEventListener("abort", onAbort, { once: true });
        waiting.set(call.toolCallId, {
          call,
          settle: (a) => {
            signal?.removeEventListener("abort", onAbort);
            resolve(a);
          },
        });
        emit();
      });
    },
    respond: (id, response) => answer(id, response.type === "approve" ? "approve" : "reject"),
    pending: () => snapshot,
    cancelAll(where) {
      for (const [id, w] of [...waiting]) if (!where || where(w.call)) answer(id, "reject");
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const same = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  } catch {
    return false;
  }
};
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v;

/**
 * The waiting call a tool card is showing. AG hands a card the call's name and args but not its id, so the
 * card finds it by name and args; if those don't match exactly, the only waiting call of that name.
 */
export function findHeld(from: Gate | readonly HeldCall[], name: string, args: unknown): HeldCall | undefined {
  const mine = (Array.isArray(from) ? (from as readonly HeldCall[]) : (from as Gate).pending()).filter((c) => c.name === name);
  return mine.find((c) => same(c.args, args)) ?? (mine.length === 1 ? mine[0] : undefined);
}

/**
 * The tool with the gate in front: a call carrying a scammer's words waits for the spotter; refused, the agent
 * is told why and nothing runs; allowed, the original runs once. A clean call runs straight away ("authorised").
 */
export function gated(tool: AgAiTool, gate: Gate, taint: () => Taint, onOutcome?: (run: AgAiToolRunContext | undefined, outcome: HoldOutcome) => void): AgAiTool {
  const note = (run: AgAiToolRunContext | undefined, o: HoldOutcome) => {
    try {
      onOutcome?.(run, o);
    } catch (e) {
      console.error("[watchtower] couldn't note a held call on the receipt:", e);
    }
  };
  const execute: AgAiTool["execute"] = async (call, ctx: AgAiToolContext) => {
    const run = tool.execute!.bind(tool);
    // If the scammer's words can't be read, every board change waits: never fail open.
    let hit: { hit: boolean; quote?: string };
    try {
      hit = carries(taint(), call.args);
    } catch (e) {
      console.error("[watchtower] couldn't check a board change for a scammer's words, so it waits for the spotter:", e);
      hit = { hit: true, quote: "Spotter couldn't check this change." };
    }
    if (!hit.hit) {
      note(ctx.run, "authorised");
      return run(call, ctx);
    }
    const a = await gate.ask({ toolCallId: call.toolCallId, name: call.name || tool.name, quote: hit.quote!, threadId: ctx.run?.threadId, args: call.args, signal: ctx.signal });
    if (a !== "approve") {
      note(ctx.run, "refused");
      return ctx.error(REFUSED);
    }
    note(ctx.run, "allowed");
    const r = await run(call, ctx);
    // Marked so the card can say "Allowed by you", in replayed chats too.
    return r.success ? { ...r, data: { ...(r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}), allowedByYou: true } } : r;
  };
  if (!tool.execute) {
    // A server or provided tool runs outside the page, so the gate can't stand in front of it (the receipt flags those).
    console.warn(`[watchtower] ${tool.name} doesn't run in the page, so it can't be held for the spotter.`);
    return tool;
  }
  return new Proxy(tool, {
    get(target, prop) {
      if (prop === "execute") return execute;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// ---------- the harness ----------

type Listener = (e: { type: "changed" }) => void;

/**
 * AG's harness with held calls shown on its approval surface: while a call in a chat waits, that chat's session
 * reports `awaiting_input` and the call `awaiting_approval`; `respond` answers it; Stop, closing the chat and
 * dispose refuse it. Everything else passes straight through (like focusable and notable).
 */
export function holdingHarness(inner: AgAiHarness, gate: Gate): AgAiHarness {
  const listeners = new Map<string, Set<Listener>>();
  const wrapped = new WeakMap<AgAiChatSession, AgAiChatSession>();
  const shown = new WeakMap<AgAiChatSession, { from: readonly AgAiChatMessage[]; version: number; list: readonly AgAiChatMessage[] }>();
  let version = 0;
  const off = gate.subscribe(() => {
    version++;
    for (const ls of listeners.values()) for (const l of [...ls]) l({ type: "changed" });
  });
  const heldIn = (threadId: string) => new Set(gate.pending().filter((c) => c.threadId === threadId).map((c) => c.toolCallId));

  const messagesOf = (s: AgAiChatSession): readonly AgAiChatMessage[] => {
    const base = s.messages;
    const held = heldIn(s.threadId);
    if (!held.size) return base;
    const hit = shown.get(s);
    if (hit && hit.from === base && hit.version === version) return hit.list;
    const list = base.map((m) =>
      m.parts.some((p) => p.type === "tool_call" && held.has(p.toolCall.toolCallId))
        ? { ...m, parts: m.parts.map((p) => (p.type === "tool_call" && held.has(p.toolCall.toolCallId) ? { ...p, toolCall: { ...p.toolCall, status: "awaiting_approval" as const } } : p)) }
        : m,
    );
    shown.set(s, { from: base, version, list });
    return list;
  };

  const wrap = (s: AgAiChatSession): AgAiChatSession => {
    let w = wrapped.get(s);
    if (w) return w;
    const refuseHere = () => gate.cancelAll((c) => c.threadId === s.threadId);
    w = new Proxy(s, {
      get(target, prop) {
        if (prop === "messages") return messagesOf(target);
        if (prop === "status") return target.status === "running" && heldIn(target.threadId).size ? "awaiting_input" : target.status;
        if (prop === "respond")
          return (toolCallId: string, response: AgAiToolCallResponse) => {
            if (gate.respond(toolCallId, response)) return;
            // Not one of ours: AG's own session may be holding it.
            if (target.respond) target.respond(toolCallId, response);
            else console.warn(`[watchtower] an answer for a call nothing is holding (${toolCallId}); nothing ran.`);
          };
        if (prop === "cancel")
          return () => {
            refuseHere();
            target.cancel();
          };
        if (prop === "close")
          return () => {
            refuseHere();
            listeners.delete(target.threadId);
            target.close();
          };
        if (prop === "addEventListener")
          return (type: "changed", l: Listener) => {
            target.addEventListener(type, l);
            let set = listeners.get(target.threadId);
            if (!set) listeners.set(target.threadId, (set = new Set()));
            set.add(l);
          };
        if (prop === "removeEventListener")
          return (type: "changed", l: Listener) => {
            target.removeEventListener(type, l);
            listeners.get(target.threadId)?.delete(l);
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    wrapped.set(s, w);
    return w;
  };

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "openThread") return async (id: string) => wrap(await target.openThread(id));
      if (prop === "createThread") return async (opts: Parameters<AgAiHarness["createThread"]>[0]) => wrap(await target.createThread(opts));
      if (prop === "getSession") {
        return (id: string) => {
          const s = target.getSession?.(id);
          return s ? wrap(s) : undefined;
        };
      }
      // A deleted chat's waiting call is refused, so Allow can't run it for a chat that's gone.
      if (prop === "deleteThread")
        return async (id: string) => {
          gate.cancelAll((c) => c.threadId === id);
          await target.deleteThread(id);
        };
      if (prop === "dispose") {
        return () => {
          off();
          gate.cancelAll();
          listeners.clear();
          target.dispose?.();
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
