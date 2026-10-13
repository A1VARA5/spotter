// The scam check eval: Spotter's real check on 40 labelled scam texts and 40 normal ones from a public dataset
// (eval/data/sms-sample.json, Mishra and Soni 2022, CC BY 4.0). Each message goes through the same path a forwarded
// text takes (checkWordsOnly with the live aiCheck and extractPayment), and "flagged" means Spotter said it has the
// signs of a scam. Costs two model calls per message (about 1p each).
//
//   npx tsx --env-file=.env.local scripts/eval-scam-check.mts [--limit 10]
//
// Writes eval/results/<date>.json and prints the table that goes in the README.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { aiCheck, type AiCheckResult } from "../src/ai/check";
import { extractPayment } from "../src/ai/extract";
import { checkWordsOnly } from "../src/ai/scan";
import { score, type Verdict } from "../src/eval/score";

// The check never touches the database; make sure nothing here can.
delete process.env.DATABASE_URL;

type Item = { id: string; label: "scam" | "normal"; text: string };
const data = JSON.parse(readFileSync("eval/data/sms-sample.json", "utf8")) as { source: string; items: Item[] };
const limitArg = process.argv.indexOf("--limit");
const items = limitArg > 0 ? data.items.filter((_, i) => i % Math.ceil(data.items.length / Number(process.argv[limitArg + 1])) === 0) : data.items;

type Row = Item & { flagged: boolean | null; engine?: string; flags: string[]; reply: string[]; error?: string; ms: number };

async function run(item: Item): Promise<Row> {
  const t0 = Date.now();
  let last: AiCheckResult | null = null;
  const check = async (req: Parameters<typeof aiCheck>[0]) => (last = await aiCheck(req));
  try {
    const r = await checkWordsOnly(check, (t) => extractPayment(t), item.text);
    const res = last as AiCheckResult | null;
    // No answer from any AI is a failed check, not a verdict either way.
    const failed = !res || !res.ok || res.aiDown;
    return {
      ...item,
      flagged: failed ? null : r.signs,
      engine: res?.aiEngine,
      flags: res?.ok ? res.flags.filter((f) => f.severity !== "low").map((f) => `${f.kind}: ${f.why}`) : [],
      reply: r.text,
      ...(failed ? { error: res?.error ?? "no result" } : {}),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ...item, flagged: null, flags: [], reply: [], error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

const rows: Row[] = [];
const queue = [...items];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      const row = await run(it);
      rows.push(row);
      console.log(`${String(rows.length).padStart(2)}/${items.length} ${row.id} ${row.label.padEnd(6)} ${row.flagged === null ? "FAILED " + row.error : row.flagged ? "flagged" : "not flagged"} (${row.ms} ms)`);
    }
  }),
);
rows.sort((a, b) => a.id.localeCompare(b.id));

const s = score(rows as Verdict[]);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const date = new Date().toISOString().slice(0, 10);
mkdirSync("eval/results", { recursive: true });
writeFileSync(`eval/results/${date}.json`, JSON.stringify({ date, source: data.source, score: s, rows }, null, 1));

console.log(`\nScam check on ${s.scams} scam and ${s.normals} normal texts (${data.source.split(",")[0]})`);
console.log("| Precision | Recall | Normal texts called a scam | Failed checks |");
console.log("| --- | --- | --- | --- |");
console.log(`| ${pct(s.precision)} | ${pct(s.recall)} (${s.caught} of ${s.caught + s.missed}) | ${s.falseAlarms} of ${s.normals - rows.filter((r) => r.label === "normal" && r.flagged === null).length} | ${s.failed} |`);
console.log("\nMissed scams:");
for (const r of rows.filter((r) => r.label === "scam" && r.flagged === false)) console.log(`- ${r.id}: ${r.text.slice(0, 140)}`);
console.log("False alarms:");
for (const r of rows.filter((r) => r.label === "normal" && r.flagged)) console.log(`- ${r.id}: ${r.text.slice(0, 140)} | ${r.flags[0] ?? ""}`);
console.log(`\nSaved eval/results/${date}.json`);
