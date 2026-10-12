import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGate } from "./hold";
import { HELD_PROMPT, JAR_PAYEE, JAR_SCAM, JAR_STARTS_ON, TRICK_COST, jarNext, runJar } from "./jar";
import { PLANTED_PAYEE } from "./sample";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("glass jar: a scripted test agent with fake tools", () => {
  it("protection off: both calls run (fake), money moved 0", async () => {
    const r = await runJar({ protect: false, scamText: JAR_SCAM, payee: JAR_PAYEE });
    expect(r.steps.map((s) => [s.tool, s.outcome])).toEqual([
      ["place_widget", "ran (fake)"],
      ["send_money", "ran (fake)"],
    ]);
    expect(r.steps[1]!.args).toEqual({ amount: 250, to: JAR_PAYEE });
    // the tile is titled with the scammer's own words
    expect(JAR_SCAM).toContain(String(r.steps[0]!.args.title));
    expect(r.recorded.map((x) => x.tool)).toEqual(["place_widget", "send_money"]);
    expect(r.moneyMoved).toBe(0);
  });

  it("protection on: both held, nothing runs until answered", async () => {
    const gate = createGate();
    const seen: string[][] = [];
    const done = runJar({ protect: true, scamText: JAR_SCAM, payee: JAR_PAYEE, gate, onStep: (s) => seen.push(s.map((x) => `${x.tool}:${x.outcome}`)) });
    await tick();
    expect(gate.pending().map((c) => c.name)).toEqual(["place_widget"]);
    expect(seen.at(-1)).toEqual(["place_widget:held"]);
    gate.respond(gate.pending()[0]!.toolCallId, { type: "approve" });
    await tick();
    expect(gate.pending().map((c) => c.name)).toEqual(["send_money"]);
    expect(seen.at(-1)).toEqual(["place_widget:allowed (fake)", "send_money:held"]);
    gate.respond(gate.pending()[0]!.toolCallId, { type: "approve" });
    const r = await done;
    expect(r.steps.map((s) => s.outcome)).toEqual(["allowed (fake)", "allowed (fake)"]);
    expect(r.recorded.map((x) => x.tool)).toEqual(["place_widget", "send_money"]);
    expect(r.moneyMoved).toBe(0);
  });

  it("refuse means the fake tool never records", async () => {
    const gate = createGate();
    const done = runJar({ protect: true, scamText: JAR_SCAM, payee: JAR_PAYEE, gate });
    await tick();
    gate.respond(gate.pending()[0]!.toolCallId, { type: "reject" });
    await tick();
    gate.respond(gate.pending()[0]!.toolCallId, { type: "reject" });
    const r = await done;
    expect(r.steps.map((s) => s.outcome)).toEqual(["refused", "refused"]);
    expect(r.recorded).toEqual([]);
    expect(r.moneyMoved).toBe(0);
  });

  it("stopping while a call waits refuses it and nothing records", async () => {
    const gate = createGate();
    const stop = new AbortController();
    const done = runJar({ protect: true, scamText: JAR_SCAM, payee: JAR_PAYEE, gate, signal: stop.signal });
    await tick();
    stop.abort();
    const r = await done;
    expect(r.steps.map((s) => s.outcome)).toEqual(["refused", "refused"]);
    expect(r.recorded).toEqual([]);
    expect(gate.pending()).toEqual([]);
  });

  it("the sample is labelled and its payee is long enough to be held", () => {
    expect(JAR_SCAM.startsWith("Sample")).toBe(true);
    expect(JAR_SCAM).toContain(JAR_PAYEE);
    expect(JAR_SCAM).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
  });

  it("jar.ts imports nothing from src/paypal or any network module", () => {
    const src = readFileSync(join(__dirname, "jar.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(["./hold", "ag-studio"]).toContain(i);
    expect(src).not.toMatch(/paypal\//i);
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:http|require\(/);
  });

  it("the jar's text is the fake tax office, not the crowded new number story", () => {
    expect(JAR_SCAM).not.toMatch(/new number/i);
    expect(JAR_SCAM).toMatch(/tax/i);
    expect(JAR_SCAM.startsWith("Sample.")).toBe(true);
  });

  it("the held call test asks about the planted £49.99 stop, so the assistant has scammer words to copy", () => {
    expect(HELD_PROMPT).toContain("£49.99");
    expect(PLANTED_PAYEE.length).toBeGreaterThanOrEqual(12);
  });

  it("opens with the harness off, so the first thing seen is what the agent does on its own", () => {
    expect(JAR_STARTS_ON).toBe(false);
  });

  it("after the harness off run, the next step says to turn Spotter's harness on", () => {
    const ran = [
      { tool: "place_widget", args: {}, outcome: "ran (fake)" as const },
      { tool: "send_money", args: {}, outcome: "ran (fake)" as const },
    ];
    expect(jarNext(false, ran, false)).toBeNull();
    expect(jarNext(false, ran, true)).toMatch(/^Now turn Spotter's harness on/);
    // harness on: the held calls ask for an answer themselves, there is no next step line
    expect(jarNext(true, [{ tool: "place_widget", args: {}, outcome: "held" }], false)).toBeNull();
  });

  it("each Try to trick it item says whether it is free or uses the real AI", () => {
    expect(TRICK_COST.jar).toMatch(/^Free/);
    expect(TRICK_COST.held).toMatch(/real AI/);
    expect(TRICK_COST.held).toMatch(/one question/);
    expect(TRICK_COST.gran).toMatch(/^Free to open/);
    expect(TRICK_COST.gran).toMatch(/real AI/);
    for (const t of Object.values(TRICK_COST)) expect(t).not.toMatch(/[–—‘’“”]/);
  });
});
