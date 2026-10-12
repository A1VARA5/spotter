import { describe, expect, it } from "vitest";
import { recName, recShop, recText, recTitle, recToggle } from "./recording";

describe("recording mode: shop names", () => {
  it("replaces well known UK retailer domains with neutral words", () => {
    for (const d of ["johnlewis.com", "currys.co.uk", "dunelm.com", "debenhams.com", "www.argos.co.uk"]) {
      expect(recText(`£199.00 at ${d}`)).toBe("£199.00 at a real UK shop");
    }
  });

  it("replaces retailer names written as words", () => {
    expect(recText("Cheaper at John Lewis.")).toBe("Cheaper at a real UK shop.");
    expect(recText("Debenhams has it for £30.")).toBe("a real UK shop has it for £30.");
  });

  it("replaces domains it has never heard of with words that claim nothing about them", () => {
    expect(recText("Seen at kettlecorner-uk.com and at homewares.store")).toBe("Seen at a website and at website 2");
    expect(recText("Open https://www.example-real-shop.co.uk/p/123 to buy")).toBe("Open a website to buy");
    expect(recText("From £15.99 (dunelm.com, kitchenbits-uk.com) up to £28 (debenhams.com)")).toBe("From £15.99 (a real UK shop, website 2) up to £28 (real shop 3)");
  });

  it("never calls a look-alike or scam address a real shop", () => {
    expect(recText("The payee's site currys-clearance.shop was registered 3 days ago")).toBe("The payee's site a website was registered 3 days ago");
  });

  it("leaves email addresses, government and PayPal addresses alone", () => {
    for (const s of ["Reply went to refunds-team@gmail.com today.", "Check hmrc.gov.uk first.", "Log in at paypal.co.uk only."]) expect(recText(s)).toBe(s);
  });

  it("names on their own (payees) only lose a known retailer, never an unknown address", () => {
    expect(recName("currys.co.uk")).toBe("a real UK shop");
    expect(recName("John Lewis")).toBe("a real UK shop");
    expect(recName("totally-new-scam.shop")).toBe("totally-new-scam.shop");
    expect(recName("Panmoor Kitchen")).toBe("Panmoor Kitchen");
  });

  it("numbers different shops in one text and keeps one shop's name and address together", () => {
    expect(recText("Currys sells it for £229 (currys.co.uk), johnlewis.com for £199.")).toBe(
      "a real UK shop sells it for £229 (a real UK shop), real shop 2 for £199.",
    );
  });

  it("keeps Spotter's own made up names and addresses", () => {
    const own = [
      "GadgetBarn",
      "Larkhill Parcels",
      "Panmoor Kitchen",
      "harbourline-audio.co.uk",
      "sound-bargains.shop",
      "parcel-redelivery.co",
      "collect-x.example",
      "spotter-pay.vercel.app",
      "https://spotter-pay.vercel.app/demo-shop/skillet",
      "spotter@homingbox.net",
      "earbuds-outlet.shop",
      "bestdealz.shop",
      "larkspur-gifts.co.uk",
    ];
    for (const s of own) expect(recText(`Paid to ${s} today.`)).toBe(`Paid to ${s} today.`);
  });

  it("never calls a general hosting address a shop", () => {
    const s = "The shop page is on vercel.app, a general hosting address. Also netlify.app and github.io.";
    expect(recText(s)).toBe(s);
  });

  it("keeps PayPal", () => {
    expect(recText("Held by PayPal at sandbox.paypal.com")).toBe("Held by PayPal at sandbox.paypal.com");
  });

  it("leaves prices, numbers and ordinary punctuation alone", () => {
    const s = "£1,299.00 now, was £24.99. A 1.7L kettle, e.g. this one, i.e. cheaper. 3.5 stars. Next.js page.";
    expect(recText(s)).toBe(s);
  });

  it("drops the retailer from gift card advice instead of naming a shop", () => {
    expect(recText("Never pay with Amazon gift cards.")).toBe("Never pay with gift cards.");
  });

  it("shop labels: the first is 'a real UK shop', the rest are numbered", () => {
    expect(recShop("johnlewis.com")).toBe("a real UK shop");
    expect(recShop("currys.co.uk", 1)).toBe("a real UK shop");
    expect(recShop("currys.co.uk", 2)).toBe("real shop 2");
    expect(recShop("harbourline-audio.co.uk", 2)).toBe("harbourline-audio.co.uk");
    expect(recShop("GadgetBarn")).toBe("GadgetBarn");
  });
});

describe("recording mode: product brands", () => {
  it("turns a branded listing title into the plain product", () => {
    expect(recTitle("Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black")).toBe("wireless headphones");
    expect(recTitle("Le Creuset Cast Iron Skillet (23 cm)")).toBe("cast iron skillet");
    expect(recTitle("AirPods Pro 3 Noise Cancelling USB-C Wireless Earbuds")).toBe("wireless earbuds");
    expect(recTitle("Smeg Whistling Tea Kettle")).toBe("kettle");
    expect(recTitle("Marino Electric Kettle")).toBe("electric kettle");
  });

  it("never lets an unknown product line name through", () => {
    expect(recTitle("Arctis GameBuds")).toBe("earbuds");
    expect(recTitle("Zentrix Q9")).toBe("this product");
  });

  it("replaces brand and model inside a sentence with the product", () => {
    expect(recText("Watching Sony WH-1000XM5 headphones for you.")).toBe("Watching headphones for you.");
    expect(recText("£199.00 for Sony WH-1000XM5 Wireless Noise Cancelling Headphones at johnlewis.com.")).toBe(
      "£199.00 for wireless headphones at a real UK shop.",
    );
  });

  it("keeps account and payment names in safety advice readable", () => {
    for (const s of ["Never log in with your Apple ID from a text.", "Pay with Apple Pay or PayPal."]) expect(recText(s)).toBe(s);
  });

  it("keeps the family's own plain item names", () => {
    expect(recText("cast iron skillet")).toBe("cast iron skillet");
    expect(recText("Hand thrown mug set")).toBe("Hand thrown mug set");
  });
});

describe("recording mode switch", () => {
  it("?rec=1 turns it on, ?rec=0 turns it off, anything else leaves it", () => {
    expect(recToggle(new URLSearchParams("rec=1"))).toBe(true);
    expect(recToggle(new URLSearchParams("a=b&rec=0"))).toBe(false);
    expect(recToggle(new URLSearchParams("rec=yes"))).toBe(null);
    expect(recToggle(new URLSearchParams(""))).toBe(null);
  });
});
