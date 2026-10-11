// The two faced Larkhill Parcels demo page (./kit.ts), served as its own plain page so KERNEL's cloud browser can load
// it from the live site. Chosen per request from the browser and language, so it must never be cached or shared.
import { redeliveryPage } from "./kit";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const html = redeliveryPage(req.headers.get("user-agent") ?? "", req.headers.get("accept-language") ?? "");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "private, no-store",
      vary: "User-Agent, Accept-Language",
    },
  });
}
