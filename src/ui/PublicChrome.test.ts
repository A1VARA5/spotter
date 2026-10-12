import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicHeader } from "./PublicChrome";

// Round 8 m3: /how, /privacy, /terms, /was-it-you, /status and /real-money had no skip link (first Tab hit the logo).
// The shared header carries it, so every public page gets one.
describe("PublicHeader skip link (WCAG 2.4.1)", () => {
  for (const band of [false, true]) {
    it(`is the first focusable thing and jumps past the header${band ? " (dark band)" : ""}`, () => {
      const html = renderToStaticMarkup(createElement(PublicHeader, { signedIn: false, band }));
      const first = html.match(/<(a|button)\b[^>]*>/)![0];
      expect(first).toContain('class="skip-link"');
      expect(first).toContain('href="#main-content"');
      // The target comes after the header's last link, so the skip really skips it.
      const target = html.indexOf('id="main-content"');
      expect(target).toBeGreaterThan(html.lastIndexOf("</header>"));
      expect(html).toMatch(/id="main-content"[^>]*tabindex="-1"/);
    });
  }
});
