import { TopBar } from "@/ui/components";
import { Demo } from "./Demo";

export const metadata = { title: "Try it | Spotter" };

export default function DemoPage() {
  return (
    <main className="shell" style={{ paddingBottom: 64 }}>
      <TopBar current="demo" />
      <h1 className="page-title">Try it</h1>
      <p className="lede" style={{ margin: "8px 0 24px" }}>
        Each one sends a real request through Spotter: the rules, an AI check that has to quote its evidence, and a real
        hold in the PayPal sandbox. No real money moves. Anything held waits for you on the dashboard.
      </p>
      <Demo />
    </main>
  );
}
