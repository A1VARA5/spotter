import { searchProducts, sameProduct } from "../src/market/channel3";
const q = process.argv[2] ?? "Apple AirPods Pro 2";
const ps = await searchProducts(q, "GBP", 8);
console.log(ps === null ? "NULL (unavailable)" : `${ps.length} products`);
for (const p of ps ?? []) console.log(sameProduct(q, p.title), "|", p.title, "|", p.offers.slice(0, 3).map((o) => o.domain + " " + o.price).join(", "));
