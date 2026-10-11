import { describe, expect, it } from "vitest";
import { messageSays, upTo, withoutIds } from "./userText";

describe("upTo", () => {
  it("keeps whole sentences within the limit instead of stopping mid word", () => {
    const text = "Opened the shop in a cloud browser. A person can see 506 of its 506 characters. Spotter also opened it at the same moment as a phone.";
    expect(upTo(text, 90)).toBe("Opened the shop in a cloud browser. A person can see 506 of its 506 characters.");
    expect(upTo("Short.", 90)).toBe("Short.");
  });
  it("falls back to a word boundary with an ellipsis when the first sentence is already too long", () => {
    expect(upTo("one two three four five six seven", 15)).toBe("one two three…");
  });
});

describe("withoutIds", () => {
  it("turns the find_genuine_offer list into shop names and prices, with no offer ids", () => {
    const raw =
      "offer_1: Soundform Dot Wireless Earbuds for £17.99 at belkin.com\noffer_2: Wave Beam In-Ear Wireless Earbuds for £39.95 at debenhams.com offer_3: Wave Beam In-Ear Wireless Earbuds for £39.95 at oasisfashion.com";
    expect(withoutIds(raw)).toBe(
      "Soundform Dot Wireless Earbuds for £17.99 at belkin.com; Wave Beam In-Ear Wireless Earbuds for £39.95 at debenhams.com; Wave Beam In-Ear Wireless Earbuds for £39.95 at oasisfashion.com",
    );
  });

  it("drops ids written inside a sentence or in brackets", () => {
    expect(withoutIds("The cheapest is offer_2 (£17.99 at belkin.com).")).toBe("The cheapest is the listing (£17.99 at belkin.com).");
    expect(withoutIds("Belkin sells it for £17.99 (offer_1).")).toBe("Belkin sells it for £17.99.");
    expect(withoutIds("Real shops (offer_1, offer_2) charge more.")).toBe("Real shops charge more.");
    expect(withoutIds("Same as offer_8f3a9c2b1d0e4f5a6b7c and cheaper.")).toBe("Same as the listing and cheaper.");
  });

  it("drops Spotter's own payment ids and leaves ordinary words alone", () => {
    expect(withoutIds("Payment pay_mg2x8k1a0b3c4d5e6f was held.")).toBe("Payment was held.");
    expect(withoutIds("Real retailers list cast iron skillets from £15.99 to £28.00.")).toBe("Real retailers list cast iron skillets from £15.99 to £28.00.");
    expect(withoutIds("special offer: 2 for 1")).toBe("special offer: 2 for 1");
  });
});

describe("messageSays", () => {
  it("quotes the words with one full stop, never a stop inside and outside the quote", () => {
    expect(messageSays("Hi mum its me, new number.")).toBe('The message says "Hi mum its me, new number".');
    expect(messageSays("it's Tom")).toBe(`The message says "it's Tom".`);
    expect(messageSays("help me!!  ")).toBe('The message says "help me".');
  });
});
