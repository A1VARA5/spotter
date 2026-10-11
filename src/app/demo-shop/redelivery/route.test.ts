import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { COLLECTOR, isTargetPhone } from "./kit";
import { scriptSendTargets } from "@/agents/trail";

const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const get = (ua: string, lang = "en-GB,en;q=0.9") => GET(new Request("https://spotter.example/demo-shop/redelivery", { headers: { "user-agent": ua, "accept-language": lang } }));

describe("the two faced redelivery demo page", () => {
  it("shows a desktop or scanner a harmless tracking page, labelled as a demo", async () => {
    const html = await get(DESKTOP).text();
    expect(html).toContain("Demo page");
    expect(html).toContain("Your parcel is on its way");
    expect(html).not.toMatch(/<form|cc-number|redelivery fee/i);
  });

  it("shows only a UK phone the fake £1.99 redelivery fee card form, posting to a collector that isn't the site", async () => {
    const html = await get(PHONE).text();
    expect(html).toContain("Demo page");
    expect(html).toMatch(/£1\.99 redelivery fee/);
    expect(html).toContain(`action="${COLLECTOR}/pay"`);
    expect(html).toContain('autocomplete="cc-number"');
    // Its script would send the card to the same collector: the money trail must find it without sending anything.
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    expect(scriptSendTargets(script, "https://spotter.example/demo-shop/redelivery")).toEqual([`${COLLECTOR}/c`]);
  });

  it("only a UK phone gets the trap: a phone set to American English gets the harmless page", async () => {
    expect(isTargetPhone(PHONE, "en-GB,en")).toBe(true);
    expect(isTargetPhone(PHONE, "en-US,en")).toBe(false);
    expect(isTargetPhone(DESKTOP, "en-GB")).toBe(false);
    expect(isTargetPhone("", "")).toBe(false);
    expect(await get(PHONE, "en-US").text()).not.toMatch(/<form/);
  });

  it("is never cached or indexed, and says caches must split by browser and language", async () => {
    const res = get(PHONE);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("vary")).toMatch(/User-Agent/);
    expect(res.headers.get("vary")).toMatch(/Accept-Language/);
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("uses a collector address that can never resolve (.example), so nothing typed into the demo goes anywhere", () => {
    expect(new URL(COLLECTOR).hostname.endsWith(".example")).toBe(true);
  });
});
