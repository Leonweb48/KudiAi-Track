// Runs every bill-payment regression suite in tests/bills, one after another (they share fixed local ports), and fails if
// any check fails. Run: node tests/bills/run-all.mjs   (needs node + deno on PATH; no network beyond Deno's own imports)
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(dir).filter((f) => f.endsWith(".e2e.mjs")).sort();
let failed = 0;
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, s)], { encoding: "utf8", timeout: 6 * 60_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const summary = (out.match(/all \d+ checks passed|\d+ of \d+ checks FAILED|function never started/g) ?? ["no summary"]).pop();
  const ok = r.status === 0 && /checks passed/.test(summary);
  console.log(`${ok ? "PASS" : "FAIL"}  ${s.padEnd(32)} ${summary}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) { failed++; console.log(out.split("\n").filter((l) => /FAIL|Error|never started/.test(l)).slice(0, 15).join("\n")); }
}
console.log(failed ? `\n${failed} of ${suites.length} suites FAILED` : `\nall ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
