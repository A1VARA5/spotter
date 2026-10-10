// One Watchtower chat: load, save (AG's harness debounces), delete.
import { getDeps } from "@/server/deps";
import { makeWatchtowerStore } from "@/watchtower/store";

type Ctx = { params: Promise<{ id: string }> };

async function run(what: string, fn: (s: ReturnType<typeof makeWatchtowerStore>) => Promise<Response>) {
  try {
    return await fn(makeWatchtowerStore((await getDeps()).db));
  } catch (e) {
    console.error(`[spotter] watchtower thread ${what} failed:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't reach your chats just now." }, { status: 500 });
  }
}

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return run("load", (s) => s.getThread(request, id));
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return run("save", (s) => s.putThread(request, id));
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return run("delete", (s) => s.deleteThread(request, id));
}
