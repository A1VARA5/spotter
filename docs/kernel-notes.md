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

## Replay: why it is safe to show

- The browser never gets KERNEL's link. It is sealed with AES-256-GCM (key from `SESSION_SECRET`, `src/core/seal.ts`) inside the case file, and `/api/payments/[id]/replay` opens it on the server for the signed in household that owns the payment, follows the redirect only to `*.amazonaws.com`, checks it is `video/mp4` under 20 MB, and relays it with range support and `cache-control: private`.
- It expires sensibly: Spotter offers it for 23 hours (KERNEL keeps recordings 1 day on our plan) and answers 410 after that.
- What is in the video: a fresh browser with no profile, cookies or family data, opening one page for a few seconds.
- Live view isn't used for the case visit: the browser is gone within seconds, so there is nothing live to watch. For looking live, see "Look at it safely" below (pictures relayed by our server, not KERNEL's live view link).

## Look at it safely (peek, added 2026-10-11)

The spotter can look at the page from a case file themselves, live, without opening it on their own phone or laptop. Code: `src/server/peek.ts`, routes under `/api/payments/[id]/peek` (POST start, `/frame`, `/scroll`, `/close`, DELETE), panel `src/ui/Peek.tsx`, table `peeks` (end of `src/db/schema.ts`), tests `src/server/peek.test.ts`.

### Decision: relay pictures from our server, don't embed KERNEL's live view

What the docs and two short live sessions (2026-10-11, each under 35 s, deleted in `finally`) showed about live view:

- `browser_live_view_url` is `https://prod-iad-hypeman-<n>.kernel.sh:8443/browser/live/<12 character token>`. The host changes per session. Nothing but the token protects it: no API key, no cookie, no origin check. It is a bearer link.
- Opening it answers `302` to `/browser/live?jwt=<signed token>` on the same host. The replay link's JWT (see above) carried KERNEL account ids, a private IP and a CDP port, so this one most likely does too. Either way it would sit in our page's DOM.
- `readOnly=true` is only a query parameter. Whoever holds the link can drop it and get full control of the browser (mouse, keyboard, address bar). The docs describe no other read only switch, no expiry other than deleting the browser, and no way to revoke a link.
- After `deleteByID` the link answers `404` within seconds, so its life is the browser's life.
- Embedding needs `frame-src` and `connect-src` for `*.kernel.sh:8443` and `wss://`, plus `allow-scripts allow-same-origin` in the sandbox, and KERNEL's own messaging relies on `document.referrer` (a `no-referrer` policy breaks `KERNEL_SET_READ_ONLY`).

So an embedded live view would hand the browser a link that anyone who sees it (an extension, a screen share, a copied devtools value) can use to watch and control a browser our account pays for, read only in name only. It would only last as long as the browser (90 s at most), so it isn't reusable "for long", but "read only by default" couldn't be enforced, and the page would carry KERNEL ids. We built the safer alternative instead:

- **Server relayed pictures.** `client.browsers.computer.captureScreenshot(id)` returns a PNG of the browser's screen (about 350 ms, 50 to 65 KB at 1024x768 or 390x844 on example.com). The panel asks `/api/payments/[id]/peek/frame` for one about every 0.7 s after the last arrived. The server finds the household's open peek, opens the sealed session id, takes the picture, checks it really is a PNG under 3 MB, and answers `image/png`, `cache-control: no-store`, `nosniff`. Frames closer than 400 ms apart are refused (429).
- **Read only, enforced by the server.** The only other action is `/scroll` with `up` or `down`, which calls `computer.scroll` with a fixed wheel step at the middle of the screen. No click, key, text, clipboard or navigation call exists anywhere in the code, so nobody can type into the page through Spotter, even on purpose. The panel still says "Don't type passwords or card details here", plainly, because the page might ask.
- **Nothing from KERNEL reaches the browser.** No link, no session id. Start answers only `{ secondsLeft, view }`. The session id is sealed with AES-256-GCM (`src/core/seal.ts`, purpose `kernel-peek`) before it is stored and never logged. No KERNEL link is stored at all. Our page has no third party frame, so no CSP change was needed.
- **The page shown is a picture**, so nothing the scam page runs (scripts, downloads, sound, popups) reaches the spotter's device. It runs on KERNEL's machine.

What this costs compared to live view: about 1 to 1.5 frames a second instead of video, and scrolling by buttons instead of touch. For looking at a scam page that is enough.

### Who, what and how often

- Only the signed in household that owns the payment (`getPayment(db, id, householdId)`), like the replay. No PIN: looking is like reading the case file. Every other household gets 404 or 410, and a test checks KERNEL is never called for them.
- Only the page already on that payment's case file (`case_file.page.url`), never a URL from the request. It goes through the case agent's guards again: it must be one of the links in the payment's own message (`extractUrls`, same as `open_link`), http or https only, and its host must not be localhost, `.local`, `.internal` or resolve to a private, loopback, carrier or link local address (`safeToFetch` from `links.ts`). The last one matters more here than for our own fetches: KERNEL's browser sits in KERNEL's network, and `169.254.169.254` is a cloud metadata address. Limit: KERNEL resolves the name again itself, so a rebinding DNS server could still answer differently; Spotter only shows what KERNEL's browser loads, as a picture.
- A fresh headful browser each time: no profile, no cookies, `stealth: false`, `start_url` set to the page (no Playwright, nothing run in the page), viewport 390x844 on phones and 1024x768 otherwise (both on KERNEL's known good list).

### Caps and deletion

- One open peek per household (partial unique index `peeks_one_open_idx`, so two starts racing can't both win), 90 s each, 3 a day per household and 30 a day overall (constants in `PEEK`). The caps and the open slot are claimed in one SQL statement. Under heavy concurrency the overall cap can overshoot by a few, never the one open per household rule. Demo families are free to make, so the overall cap is the real wall.
- The browser is deleted: when the spotter closes the panel (Close button, Escape, the `cancel` event), when the tab is hidden or closed (`navigator.sendBeacon` to `/peek/close`), when the card unmounts, when the countdown hits zero, on every server call after its time is up (`sweepPeeks` ends and deletes every expired peek, any household), when a start fails after the browser was created (in `finally`), and when a browser only arrives after starting timed out. Backstop: `timeout_seconds: 20`. A live session showed frame requests count as activity (a 10 s timeout browser stayed alive through 22 s of one a second screenshots), so the browser lives while the panel is watching and dies 20 s after it stops asking, even if every delete above failed.
- A failed delete is logged and never blocks closing the peek. Logged errors have long id like strings blanked, because KERNEL's error text can echo a session id. Expired browsers are deleted in parallel. A start that died half way (no session after 30 s) is cleared by the sweep, so the family isn't stuck on "already looking". Starts that failed don't count towards the caps.
- The SDK's own request limit (27 s) is longer than our wait (12 s), so a browser created late still comes back with its id and is deleted, kept alive past the response with `after()`.

### Verified live (2026-10-11, local dev, demo family)

The booby trapped shop scenario's case file showed "Look at it safely" next to "Watch Spotter open it". At 1440 px the panel showed the shop live (1024x768) with the address bar, the warning and a 90 s countdown; 27 frames all `200` in about 250 ms each, scroll down moved the page, focus started on Close and went back to the button after Escape, and nothing in the page's DOM or resources mentioned KERNEL. At 390 px (iframe) the browser opened at phone size. After Escape and after Close, KERNEL's browser list was empty. Screenshots in `../paypal-spotter-submission/review-shots/peek/`. Six KERNEL sessions in all (two probes, two case visits, two peeks), each under 35 s.

### Cost per peek

Headful is $0.0001333 a second (about $0.008 a minute). A full peek is 90 s, so about $0.012; at most about 110 s ($0.015) if every delete fails and the 20 s backstop ends it. The cap of 30 a day overall is at most about $0.45 a day. The screenshot and scroll calls aren't billed separately on the pricing page.

## Cost per case

About 6 s of headful browser, so about $0.0008 a case; at most 20 s ($0.0027) if our delete fails and the inactivity timeout ends it. $5 of monthly credit covers about 6,000 cases.

## Limits

- A cloaking site can show KERNEL's browser a different page than it showed the agent. Spotter can only judge the page it was shown.
- "Covered" is only checked inside the 800x600 viewport.
- Instruction detection is a word list (`looksLikeInstruction`): new phrasings can slip past it, which is why the AI check also reads the agent's context.
