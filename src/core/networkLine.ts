// The Spotter network's count in words. Pure (no crypto, no database), so Watchtower's widgets and tool cards in
// the browser say it the same way as the server (src/core/network.ts re-exports it).

export const NETWORK_WINDOW_DAYS = 30;

/** "Spotter families" for real ones, "demo families" (said plainly) for the demo. */
export const networkKind = (demo: boolean | undefined) => (demo ? "demo" : "Spotter");

/** The count in words: "Spotter families" for real ones, "demo families" (said plainly) for the demo. */
export function networkLine(n: { families: number; demo?: boolean }, payee: string): string {
  const kind = networkKind(n.demo);
  if (!n.families) return `No other ${kind} family has said no to ${payee} in the last ${NETWORK_WINDOW_DAYS} days.`;
  const who = `${n.families} other ${kind} famil${n.families === 1 ? "y" : "ies"}${n.demo ? " (other people trying the demo)" : ""}`;
  return `${who} said no to ${payee} in the last ${NETWORK_WINDOW_DAYS} days.`;
}
