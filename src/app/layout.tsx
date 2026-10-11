import type { Metadata, Viewport } from "next";
import { Inter, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import "./responsive.css";
import "@/ui/casefile.css";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
// Phone screens use Inter, the closest open face to Apple's SF, so mockups read as real iOS.
const ios = Inter({ subsets: ["latin"], variable: "--font-ios", display: "swap" });

export const metadata: Metadata = {
  title: "Spotter: it asks the person the text pretends to be",
  description:
    "Banks ask the person paying. Spotter asks the person the text pretends to be, while PayPal holds the money. It also catches shop pages that show phones a card form and security scanners nothing, and AI agents reaching for PayPal tools they never need.",
};

export const viewport: Viewport = { themeColor: "#f3f5f2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${ios.variable}`}>
      <body>{children}</body>
    </html>
  );
}
