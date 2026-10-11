// Which payment's page can be looked at again safely (KERNEL peek). The server decides for real (src/server/peek.ts:
// only the page on the case file, only a link from the payment's own message, only a public address); this only picks
// a payment worth offering the button for, so the button isn't shown where the server would always refuse.
type P = { case_file?: { page?: { url: string; finalUrl?: string } } | null; request: { context?: string | null } };

const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

/** The host to name on the button, or null when this payment has no page that came from its own message. */
export function peekableHost(p: P): string | null {
  const page = p.case_file?.page;
  if (!page?.url || !p.request.context) return null;
  let u: URL;
  try {
    u = new URL(page.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!p.request.context.includes(bare(page.url))) return null;
  try {
    return new URL(page.finalUrl || page.url).hostname;
  } catch {
    return u.hostname;
  }
}
