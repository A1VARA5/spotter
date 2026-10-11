import { describe, expect, it } from "vitest";
import { unsourcedShops } from "./shops";

describe("unsourcedShops", () => {
  it("names well known retailers the sourced text never mentions", () => {
    expect(unsourcedShops("Compare prices at Currys, Argos or John Lewis.", [])).toEqual(["Currys", "Argos", "John Lewis"]);
  });

  it("accepts a retailer that a tool result named by its web address", () => {
    expect(unsourcedShops("Buy it from Currys or John Lewis.", ["offer_1: AirPods for £179.00 at currys.co.uk", "johnlewis.com"])).toEqual([]);
  });

  it("allows the payee and item themselves, and ignores ordinary words", () => {
    expect(unsourcedShops("Check this is really Argos.", ["Argos"])).toEqual([]);
    expect(unsourcedShops("This is very cheap and the boots look fake, so ask Gran.", [])).toEqual([]);
  });
});
