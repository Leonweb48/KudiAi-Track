// Shared bits for the bill-payment regression suites: where the real code lives, and stopping a child process tree on
// Windows and Linux alike (CI runs these on Ubuntu before every bill-server deploy — .github/workflows/deploy-functions.yml).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// the REAL bill server and the REAL fixed-IP relay — never copies
export const FN = path.join(REPO, "supabase", "functions", "clubkonnect", "index.ts");
export const RELAY_JS = path.join(REPO, "flw-relay", "server.js");

export function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else proc.kill("SIGKILL");
  } catch { /* already gone */ }
}
