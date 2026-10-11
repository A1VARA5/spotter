// Panmoor Kitchen: a made up shop for Spotter's "spot the difference" demo. It sells an everyday cast iron skillet for
// far less than real shops do (a fake shop price). The product picture is a real photo of a plain, logo free pan
// (public domain), big and above the fold, so Channel3's image search can find the same kind of pan at real shops
// from KERNEL's screenshot of this page, and the case file can show the two side by side. A plain HTML page with its
// own look on purpose, so it reads like somebody else's shop; the banner tells people it is a demo.

/** Where the demo lives, so KERNEL's cloud browser can open it (like the other demo shops). */
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spotter-pay.vercel.app";
export const SKILLET_PATH = "/demo-shop/skillet";
export const SKILLET_IMAGE = "/demo-shop/skillet.jpg";

/** The item and price the demo payment uses: the words are the ones real shop listings use for this pan. */
export const SKILLET = { item: "cast iron skillet", price: "£4.99", was: "£39.99", shop: "Panmoor Kitchen" } as const;

export const SHOP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${SKILLET.shop} | Cast iron skillet, ${SKILLET.price} (demo shop)</title>
<meta property="og:title" content="Cast iron skillet, ${SKILLET.price}">
<meta property="og:image" content="${SITE}${SKILLET_IMAGE}">
<style>
  :root { --ink: #22201c; --muted: #6d665c; --paper: #f6f3ee; --card: #ffffff; --brand: #1f4d43; --sale: #c2412b; --line: #e4ded4; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 Georgia, "Times New Roman", serif; color: var(--ink); background: var(--paper); }
  .demo { margin: 0; background: var(--ink); color: #fff; font: 14px/1.4 system-ui, sans-serif; padding: 8px 16px; text-align: center; }
  .demo b { color: #ffd48a; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
  .logo { font-size: 22px; font-weight: 700; color: var(--brand); letter-spacing: 0.01em; }
  nav { display: flex; gap: 18px; font: 15px system-ui, sans-serif; color: var(--muted); }
  main { max-width: 960px; margin: 0 auto; padding: 20px 24px 40px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 28px; align-items: start; }
  .photo { margin: 0; background: #fff; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .photo img { display: block; width: 100%; height: auto; }
  h1 { font-size: 30px; line-height: 1.15; margin: 4px 0 8px; }
  .stars { color: #b7791f; font: 15px system-ui, sans-serif; }
  .price { font: 700 30px system-ui, sans-serif; margin: 12px 0 2px; color: var(--sale); }
  .was { color: var(--muted); text-decoration: line-through; font-size: 18px; font-weight: 400; margin-left: 8px; }
  .ship { color: var(--brand); font: 600 15px system-ui, sans-serif; }
  ul.points { padding-left: 20px; color: var(--muted); }
  .buy { display: inline-block; margin-top: 10px; background: var(--brand); color: #fff; padding: 13px 26px; border-radius: 999px; font: 700 16px system-ui, sans-serif; text-decoration: none; }
  .credit { margin: 6px 4px 0; font: 12px system-ui, sans-serif; color: var(--muted); }
  footer { border-top: 1px solid var(--line); padding: 16px 24px; font: 13px system-ui, sans-serif; color: var(--muted); text-align: center; }
  @media (max-width: 720px) { main { grid-template-columns: 1fr; } nav { display: none; } }
</style>
</head>
<body>
<p class="demo"><b>Demo shop.</b> ${SKILLET.shop} is made up for Spotter's demo. Nothing here is for sale. On purpose, it sells an everyday pan for far less than real shops do.</p>
<header>
  <div class="logo">${SKILLET.shop}</div>
  <nav><div>Cookware</div><div>Bakeware</div><div>Clearance</div></nav>
</header>
<main>
  <figure class="photo">
    <img src="${SKILLET_IMAGE}" width="960" height="692" alt="A plain cast iron skillet seen from above">
  </figure>
  <div>
    <h1>Cast iron skillet, pre seasoned</h1>
    <div class="stars">★★★★★ 4.9 (2,140 reviews)</div>
    <div class="price">${SKILLET.price}<span class="was">${SKILLET.was}</span></div>
    <div class="ship">Clearance: free delivery today only</div>
    <ul class="points">
      <li>Heavy cast iron, oven safe</li>
      <li>Works on gas, electric and induction</li>
      <li>Only 4 left at this price</li>
    </ul>
    <a class="buy" href="#">Buy now</a>
    <p class="credit">Photo: public domain (CC0), Wikimedia Commons.</p>
  </div>
</main>
<footer>${SKILLET.shop} is a demo shop made up for Spotter. Not a real business.</footer>
</body>
</html>`;
