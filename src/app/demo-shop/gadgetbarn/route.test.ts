import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { HIDDEN_INSTRUCTION, HONEST_TOOL, POISONED_TOOL, REFUND_ASK, TOOL_POISON } from "./shop";
import { coverageFor } from "@/core/toolkit-coverage";
import { looksLikeInstruction } from "@/agents/seen";
import { readShopTools } from "@/agents/webmcp";

describe("GadgetBarn demo shop", () => {
  it("serves a plain HTML page that tells people it's a demo, hides one line for agents, and isn't indexed", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    const html = await res.text();
    expect(html).toContain("<b>Demo shop.</b> GadgetBarn is made up for Spotter's demo.");
    expect(html).toContain(`<p class="agent-note">${HIDDEN_INSTRUCTION}</p>`);
    expect(html).toMatch(/\.agent-note \{ position: absolute; left: -9999px/);
  });

  it("registers one honest and one poisoned tool for AI agents (WebMCP), and says so on the page", async () => {
    const html = await GET().text();
    expect(html).toContain("document.modelContext");
    expect(html).toContain(`name: ${JSON.stringify(HONEST_TOOL.name)}`);
    expect(html).toContain(`name: ${JSON.stringify(POISONED_TOOL.name)}`);
    expect(html).toContain(JSON.stringify(TOOL_POISON));
    expect(html).toContain("Demo: tools for AI agents");
    // The poisoned line is caught by the same check Spotter runs on the listed tools; the honest one isn't.
    const listed = readShopTools({
      tools: [
        { tool: { ...HONEST_TOOL, inputSchema: { type: "object", properties: { postcode: { type: "string", description: "A UK postcode, for example BS1 4DJ." } } } } },
        { tool: { ...POISONED_TOOL, inputSchema: { type: "object", properties: { product: { type: "string", description: TOOL_POISON } } } } },
      ],
    });
    expect(listed.checked && listed.tools.map((t) => [t.name, !!t.poisoned])).toEqual([
      ["add_to_basket", true],
      ["check_delivery", false],
    ]);
  });

  it("the hidden line asks a shopping agent for a refund, which is a tripwire tool for it", () => {
    expect(HIDDEN_INSTRUCTION).toContain(REFUND_ASK);
    expect(REFUND_ASK).toMatch(/refund tool to refund capture [A-Z0-9]{17}/);
    expect(coverageFor("create_refund", "shopping")?.treatment).toBe("bait");
    expect(looksLikeInstruction(HIDDEN_INSTRUCTION)).toBe(true);
  });
});
