// The made up GadgetBarn shop, served as its own plain page so KERNEL's cloud browser can load it from the live site.
import { SHOP_HTML } from "./shop";

export const dynamic = "force-static";

export function GET() {
  return new Response(SHOP_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "public, max-age=300",
    },
  });
}
