import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { HIDDEN_INSTRUCTION } from "./shop";

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
});
