import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { pgliteDb, type Db } from "@/db";
import { createHousehold } from "@/core/households";
import { WATCHTOWER_FAST_MODEL as FAST, WATCHTOWER_MODEL, WATCHTOWER_MODEL as OPUS, makeLlmTurn, modelFor } from "./llm";
import type { ClaudeTurn } from "./claude";

const reply = { id: "msg_1", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Hi" }], usage: { input_tokens: 10, output_tokens: 2 } } as unknown as Anthropic.Message;
const body = (input: unknown[] = [{ id: "m1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Hello" }] }]) => ({
  request: { input, responseFormat: { type: "text" }, tools: [] },
});

let db: Db;
let hh: string;
beforeEach(async () => {
  db = await pgliteDb();
  hh = (await createHousehold(db, { name: "Fam", spotterName: "Sam" })).id;
});

describe("watchtower llm turn", () => {
  it("runs one turn and returns AG's response shape", async () => {
    const seen: ClaudeTurn[] = [];
    const turn = makeLlmTurn({ db, callModel: async (t) => (seen.push(t), reply) });
    const res = await turn(hh, body());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.response.output[0].content[0].text).toBe("Hi");
    expect(seen[0]!.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "Hello" }] });
  });

  it("refuses a body that isn't an AG request", async () => {
    const turn = makeLlmTurn({ db, callModel: async () => reply });
    expect((await turn(hh, { nope: 1 })).status).toBe(400);
    expect((await turn(hh, { request: { input: "x" } })).status).toBe(400);
  });

  it("doesn't count refused turns, so one family hammering the cap can't use up everyone's", async () => {
    const other = (await createHousehold(db, { name: "B", spotterName: "B" })).id;
    const turn = makeLlmTurn({ db, callModel: async () => reply, perHousehold: 1, overall: 3 });
    expect((await turn(hh, body())).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await turn(hh, body())).status).toBe(429);
    expect((await turn(other, body())).status).toBe(200);
  });

  it("calls a broken history a bad request, not a model outage", async () => {
    let calls = 0;
    const turn = makeLlmTurn({ db, callModel: async () => (calls++, reply) });
    const res = await turn(hh, body([{ id: "x", kind: "input", type: "message", role: "user" }]));
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("stops a family at its daily cap and says why", async () => {
    let calls = 0;
    const turn = makeLlmTurn({ db, callModel: async () => (calls++, reply), perHousehold: 2, overall: 100 });
    await turn(hh, body());
    await turn(hh, body());
    const res = await turn(hh, body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today/);
    expect(calls).toBe(2);
  });

  it("stops everyone at the overall cap", async () => {
    const other = (await createHousehold(db, { name: "B", spotterName: "B" })).id;
    const turn = makeLlmTurn({ db, callModel: async () => reply, perHousehold: 10, overall: 1 });
    expect((await turn(hh, body())).status).toBe(200);
    expect((await turn(other, body())).status).toBe(429);
  });

  it("answers the family's own agents (Spotter, the simple view) on the fast model and keeps Studio's builders on Opus", async () => {
    const used: string[] = [];
    const turn = makeLlmTurn({ db, callModel: async (_t, model) => (used.push(model), reply) });
    for (const agent of ["spotter", "gran", "data", "page", "widget", "planning", "lead", "brief"]) await turn(hh, { ...body(), agent });
    expect(used).toEqual([FAST, FAST, OPUS, OPUS, OPUS, OPUS, OPUS, OPUS]);
  });

  it("never lets the browser pick a model: an unknown, missing or odd agent name gets Opus", async () => {
    const used: string[] = [];
    const turn = makeLlmTurn({ db, callModel: async (_t, model) => (used.push(model), reply) });
    for (const agent of [undefined, "claude-haiku-5-5", 7, { id: "spotter" }, "Spotter"]) await turn(hh, { ...body(), agent });
    expect(used).toEqual([OPUS, OPUS, OPUS, OPUS, OPUS]);
    expect(modelFor("spotter")).toBe("claude-sonnet-5-5");
    expect(WATCHTOWER_MODEL).toBe("claude-opus-5-5");
  });

  // R7-N1: the lead's last turn came back with nothing to show (no text, no tool call), so the chat ended on
  // tool rows with no reply. One more try, asked for the reply in words, on the same slot.
  it("asks once more when a turn comes back empty, and returns the reply", async () => {
    const empty = { ...reply, content: [{ type: "thinking", thinking: "", signature: "s" }] } as unknown as Anthropic.Message;
    const seen: ClaudeTurn[] = [];
    const turn = makeLlmTurn({ db, callModel: async (t) => (seen.push(t), seen.length === 1 ? empty : reply) });
    const res = await turn(hh, body());
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: expect.stringMatching(/reply/i) }] });
    expect((await res.json()).response.output[0].content[0].text).toBe("Hi");
    const [n] = await db.query<{ n: string }>("select count(*)::text as n from llm_turns where household_id = $1", [hh]);
    expect(n!.n).toBe("1");
  });

  it("doesn't ask again when the turn had a tool call or text, or stopped for another reason", async () => {
    for (const r of [
      { ...reply, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      reply,
      { ...reply, stop_reason: "max_tokens", content: [] },
    ]) {
      let calls = 0;
      const turn = makeLlmTurn({ db, callModel: async () => (calls++, r as unknown as Anthropic.Message), perHousehold: 100 });
      await turn(hh, body());
      expect(calls).toBe(1);
    }
  });

  it("returns the empty turn as it was when the second try is empty too or fails", async () => {
    const empty = { ...reply, content: [] } as unknown as Anthropic.Message;
    let calls = 0;
    const turn = makeLlmTurn({ db, callModel: async () => (calls++, empty), perHousehold: 100 });
    const res = await turn(hh, body());
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    expect((await res.json()).response.output).toEqual([]);
    let tries = 0;
    const failing = makeLlmTurn({ db, perHousehold: 100, callModel: async () => { if (tries++) throw new Error("overloaded"); return empty; } });
    const r2 = await failing(hh, body());
    expect(r2.status).toBe(200);
  });

  it("reports a model failure as a JSON error instead of throwing", async () => {
    const turn = makeLlmTurn({ db, callModel: async () => { throw new Error("overloaded"); } });
    const res = await turn(hh, body());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/assistant/i);
  });
});
