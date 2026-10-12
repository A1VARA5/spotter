"use client";
// Recording mode in the page: every place that shows a real shop or a listing title asks useRec() for the words, so
// one switch (the cookie read in AppShell) changes them all. Off, every function hands the text back unchanged.
import { createContext, useContext } from "react";
import { recName, recShop, recText, recTitle } from "@/core/recording";

export type Rec = {
  on: boolean;
  /** Any sentence that can name a shop or a product brand. */
  text(s: string): string;
  /** A payee or item name: only a known retailer or a product brand goes, an unknown address stays (it is evidence). */
  name(s: string): string;
  /** A listing title (Channel3). */
  title(s: string): string;
  /** A shop name or address on its own; n numbers shops in a list (1 is "a real UK shop", 2 is "real shop 2"). */
  shop(s: string, n?: number): string;
  /** The label on a link to a shop's own page: "Open johnlewis.com", or "Open the shop" while recording. */
  open(shop: string): string;
};

const PLAIN: Rec = { on: false, text: (s) => s, name: (s) => s, title: (s) => s, shop: (s) => s, open: (s) => `Open ${s}` };
const RECORDING: Rec = { on: true, text: recText, name: recName, title: recTitle, shop: recShop, open: (s) => (recShop(s) === s ? `Open ${s}` : "Open the shop") };

export const recFor = (on: boolean): Rec => (on ? RECORDING : PLAIN);

const RecContext = createContext<boolean | undefined>(undefined);
// Watchtower's widgets are drawn by AG Studio, which can mount them outside this tree; they read the last value here.
let browserOn = false;

export function RecProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (typeof window !== "undefined") browserOn = on;
  return <RecContext.Provider value={on}>{children}</RecContext.Provider>;
}

export function useRec(): Rec {
  const on = useContext(RecContext);
  return recFor(on ?? (typeof window !== "undefined" && browserOn));
}

/** A shop's name for pieces that can also render on the server (MarketNote): <ShopName name="currys.co.uk" />. */
export function ShopName({ name }: { name: string }) {
  return useRec().shop(name);
}

/** The same for an item or payee name: <RecName>{name}</RecName>. */
export function RecName({ children }: { children: string }) {
  return useRec().name(children);
}
