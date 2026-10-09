/** Read a JSON reply without ever crashing on an HTML error page. */
export async function readJson(r: Response): Promise<Record<string, any>> {
  try {
    return await r.json();
  } catch {
    return { error: `Spotter replied unexpectedly (${r.status}). Try again in a moment.` };
  }
}
