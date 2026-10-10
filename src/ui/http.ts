const GENERIC = "That didn't go through. Refresh the page to see where it is, then try again.";

/**
 * Something a person can read. Our own messages come as plain Errors (made from Spotter's reply);
 * TypeErrors and the like are the browser or a bug talking, so they never reach the screen as is.
 */
export function plainError(e: unknown): string {
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))
    return "Couldn't reach Spotter. Check your connection, then refresh to see where it is.";
  if (e instanceof Error && e.constructor === Error && e.message) return e.message;
  return GENERIC;
}

/** Read a JSON reply without ever crashing on an HTML error page. */
export async function readJson(r: Response): Promise<Record<string, any>> {
  try {
    return await r.json();
  } catch {
    return { error: `Spotter replied unexpectedly (${r.status}). Try again in a moment.` };
  }
}
