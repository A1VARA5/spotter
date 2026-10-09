import type { Metadata, Viewport } from "next";
import { Inter, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
// Phone screens use Inter, the closest open face to Apple's SF, so mockups read as real iOS.
const ios = Inter({ subsets: ["latin"], variable: "--font-ios", display: "swap" });

export const metadata: Metadata = {
  title: "Spotter: a spotter for every payment",
  description:
    "Spotter holds a payment for a moment, checks it, and asks someone you trust when it matters. For AI agents, older relatives and kids. Built on PayPal.",
};

export const viewport: Viewport = { themeColor: "#f3f5f2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${ios.variable}`}>
      <body>{children}</body>
    </html>
  );
}
