// Posts demo scenarios to a running Spotter. Usage: npx tsx scripts/run-scenarios.ts [base url] [ids...]
import { SCENARIOS } from "../src/ui/scenarios";

const base = process.argv[2] ?? "http://localhost:3417";
const only = process.argv.slice(3);
for (const s of SCENARIOS.filter((s) => !only.length || only.includes(s.id))) {
  const r = await fetch(`${base}/api/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s.body) });
  const j: any = await r.json();
  console.log(`${r.status} ${s.id}: ${j.payment?.status ?? j.error} | ${j.payment?.decision?.outcome ?? ""} | ${(j.payment?.ai?.flags ?? []).map((f: any) => f.kind + "/" + f.severity).join(", ")}`);
}
