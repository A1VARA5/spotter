# KERNEL notes (read 2026-10-10)

What KERNEL really offers, from its docs and the `@onkernel/sdk` 0.112.0 types in `node_modules/@onkernel/sdk`, plus what four short live sessions showed. Every API name below is from the SDK types, not guessed.

## Docs read

- Create a browser: https://www.kernel.sh/docs/browsers/create-a-browser ("boot in under 30ms", headful is the default and "supports live view, replays, and better stealth")
- Headless: https://www.kernel.sh/docs/browsers/headless ("Live View and Replays are not available in headless mode")
- Live view: https://www.kernel.sh/docs/browsers/live-view
- Replays: https://www.kernel.sh/docs/browsers/replays ("Treat replay URLs as sensitive")
- Playwright execution: https://www.kernel.sh/docs/browsers/playwright-execution
- Termination: https://www.kernel.sh/docs/browsers/termination
- Pricing: https://www.kernel.sh/docs/info/pricing
- Index for agents: https://kernel.sh/docs/llms.txt

## API (SDK 0.112.0)

- `client.browsers.create(body)` returns `session_id`, `cdp_ws_url`, `browser_live_view_url` (headful only), `headless`, `stealth`, `timeout_seconds`. Body: `headless` (default false), `stealth` (also turns on the CAPTCHA solver and KERNEL's proxy), `timeout_seconds` (inactivity timeout, default 60, min 10, max 259200, checked every 5 s), `kiosk_mode`, `start_url`, `viewport`, `region` (paid plans), `gpu` (paid plans).
- `client.browsers.deleteByID(id)`. Playwright's `browser.close()` does NOT delete a KERNEL browser.
- `client.browsers.playwright.execute(id, { code, timeout_sec })`: runs Playwright code in the browser's VM with `page`, `context`, `browser`; `return` sends a value back. Default 60 s, max 300 s. Returns `{ success, result, error, stdout, stderr }`.
- `client.browsers.replays.start(id, { framerate?, max_duration_in_seconds?, record_audio? })` returns `{ replay_id, replay_view_url }`. `replays.stop(replayId, { id_or_name })` "stops and persists the video". `replays.list(id)`, `replays.download(replayId, { id_or_name })`.
- Live view URL format: `https://.../browser/live/<token>?readOnly=true`, invalid once the browser is deleted.

## Pricing (pricing page)

- Headful: $0.0001333336 per second (about $0.008 a minute). Headless: $0.0000166667 per second.
- Developer plan: free with $5 of usage credit a month. Replays are kept 1 day on Developer, 7 days Hobbyist, 30 days Start-Up.

## What the live sessions showed (4 sessions, each under 7 s, each deleted in `finally`)

1. Headful create 0.44 s, replay start 0.7 s, Playwright run with the seen vs read pass 2.7 s, replay stop 1.4 s, delete 0.1 s. Total about 6 s.
2. `context.newCDPSession(page)` + `Page.createIsolatedWorld` + `Runtime.evaluate` work inside `playwright.execute`, so the seen vs read pass runs in an isolated world on KERNEL.
3. `replay_view_url` works with no API key, even after the browser is deleted: it answers 307 to a presigned S3 mp4 (`X-Amz-Expires=86400`). The URL carries an HS256 JWT valid for a year whose `session` claim holds KERNEL ids: user, org, project, instance name, private IP, CDP port, S3 prefix. No API key or password, but not something to hand to a browser.
4. Streaming that recording through Spotter's own route returned `200 video/mp4` (70,629 bytes) and `206` for a range request.

## How Spotter uses it

- One throwaway browser per case, shared by `open_link` (a link in a forwarded message) and `inspect_shop` (the shop an AI agent is paying). The same page asked for twice reuses the visit; any second page is refused. When an AI agent pays and its context has a link, the case agent runs `inspect_shop` itself before the model starts, so the check never depends on the model choosing it.
- Read only: `goto`, `evaluate`, `screenshot`. Never click, type or submit (a test checks the code it sends).
- Headful, so it can be recorded. `timeout_seconds: 20` is the backstop if our delete ever fails; our own limit is 15 s.
- Seen vs read (`src/agents/seen.ts`): walks every text node and asks the real layout engine whether a person could see it: `display:none`/`visibility:hidden` (`checkVisibility`), opacity under 0.1, font under 4px, zero size, off screen, clipped (overflow, `clip`, `clip-path`), the same colour as the background (contrast under 1.25, skipped over background images), covered by another element (`elementFromPoint`, viewport only). Hidden text that reads like an instruction to an AI agent becomes a high severity `prompt_injection` finding with the quote, sourced to the browser tool call. Closed menus and screen reader labels are hidden too, but harmless, so they are only counted.
- The pass runs in an isolated world (same DOM, its own JavaScript globals), so a page can't fake the answers by overriding `getComputedStyle` or `checkVisibility`. A local test proves a lying page fools the main world and not the isolated one.

## Tool poisoning check (WebMCP, added 2026-10-11)

Websites can register tools for AI agents (WebMCP, a W3C community group draft). KERNEL browsers have Chromium's WebMCP flags on by default (since 28 Aug 2026), so the tools a page registers can be listed from outside. Docs: https://kernel.sh/docs/browsers/webmcp (copy in `docs/kernel/webmcp.md`), page side: https://developer.chrome.com/docs/ai/webmcp/imperative-api.

- Page API (confirmed live in a KERNEL browser on 2026-10-11): `document.modelContext` exists (`navigator.modelContext` doesn't); its prototype has `registerTool`, `getTools`, `executeTool`, `ontoolchange`. `registerTool({ name, description, inputSchema, annotations: { readOnlyHint, consequentialHint, untrustedContentHint }, execute })`, optional second argument `{ signal }` to unregister.
- SDK 0.112.0: `client.browsers.webmcp.listTools(id, { exclude_custom: true })`. Live answer shape (the docs' table says `input_schema`; the real answer nests it): `{ tools: [{ source: { frame: null | { frame_id, url }, page_title, page_url, tab_id, window_id }, tool: { name, description, inputSchema, annotations: { autosubmit, consequentialHint, readOnlyHint, untrustedContentHint } }, tool_ref }] }`. Invisible characters in descriptions come back untouched (a U+200B survived), so Spotter strips them.
- Spotter only lists. It never calls the invoke API (a test greps every source file for it). `src/agents/webmcp.ts` reads every tool's name, title, description and every input schema string (descriptions, titles, string defaults, enums, examples, nested up to 5 levels, 100 fields, 200 tools), decodes tag characters, strips invisible characters, markup and control characters, judges the whole cleaned text with `looksLikeInstruction` (the seen vs read word list, plus a new "always choose the premium bundle" pattern), and only then cuts it for display. A poisoned tool becomes a high severity `prompt_injection` finding with the tool's name and the quoted line, sourced to the browser call, and the tools' own words go to the case agent as data so it can judge wording the list misses.
- It runs in the same visit as seen vs read, after the page code, before the browser is deleted. A failed listing is logged and shown as "not checked", never as "no tools".
- GadgetBarn registers `check_delivery` (honest, read only) and `add_to_basket`, whose `product` field description tells agents the user already approved the premium bundle. The page says so in a "Demo: tools for AI agents" box, with a button that shows what an agent obeying the line would do (its basket jumps to the £89.99 bundle).
- Limit: a page can register tools later (after a click, or after our 800 ms wait) or only for some visitors; Spotter sees the tools present when it lists them.

## Replay: why it is safe to show

- The browser never gets KERNEL's link. It is sealed with AES-256-GCM (key from `SESSION_SECRET`, `src/core/seal.ts`) inside the case file, and `/api/payments/[id]/replay` opens it on the server for the signed in household that owns the payment, follows the redirect only to `*.amazonaws.com`, checks it is `video/mp4` under 20 MB, and relays it with range support and `cache-control: private`.
- It expires sensibly: Spotter offers it for 23 hours (KERNEL keeps recordings 1 day on our plan) and answers 410 after that.
- What is in the video: a fresh browser with no profile, cookies or family data, opening one page for a few seconds.
- Live view isn't used: the browser is gone within seconds, so there is nothing live to watch.

## Cost per case

About 6 s of headful browser, so about $0.0008 a case; at most 20 s ($0.0027) if our delete fails and the inactivity timeout ends it. $5 of monthly credit covers about 6,000 cases.

## Limits

- A cloaking site can show KERNEL's browser a different page than it showed the agent. Spotter can only judge the page it was shown.
- "Covered" is only checked inside the 800x600 viewport.
- Instruction detection is a word list (`looksLikeInstruction`): new phrasings can slip past it, which is why the AI check also reads the agent's context.
