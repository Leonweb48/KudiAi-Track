// Works out the version numbers for an over-the-air (Capgo) bundle — see .github/workflows/capgo-deploy.yml.
//
//   bundle = 1.<latest APK build>.<this OTA run>   e.g. 1.185.703
//   min    = the versionName of the OLDEST APK build whose native side (Capacitor plugins + our own Java) is identical to
//            the code being shipped, counting back from the latest build without a gap. Capgo (channel in "metadata" mode)
//            never sends the bundle to an app older than that, so no phone gets JavaScript that calls a plugin it lacks.
//
// APK builds are named 1.0.<run> up to #185 and 1.<run>.0 from #186 (build-apk.yml), so a new APK always outranks every
// bundle made before it and Capgo's no-downgrade rule stops a stale bundle replacing newer built-in code.
//
// Refuses (exit 1) when the code being shipped has a native change no APK has yet: that needs a new APK, not an OTA.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GH_TOKEN;
const OTA_RUN = process.env.OTA_RUN;
const HEAD = process.env.GITHUB_SHA || git("rev-parse", "HEAD").trim();
if (!REPO || !TOKEN || !OTA_RUN) throw new Error("GITHUB_REPOSITORY, GH_TOKEN and OTA_RUN are required");

function git(...args) { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }

// Plugins the JavaScript only ever calls inside a try/catch that does nothing when the plugin is missing, so an APK
// without them runs today's code fine and still gets OTA updates. @capacitor/haptics: every call is in src/utils/haptics.js
// (guarded). Added 2026-10-01 so APK #170–#172 (built the day before the 18 Sept notification redesign, no haptics) can
// receive it over the air instead of being stuck on the old notification drawer. @capacitor/clipboard (2026-10-02):
// only src/utils/clipboard.js calls it, inside try/catch, falling back to the web clipboard / the Paste button — so the
// "use copied account number" code can reach older APKs too; it just can't read the clipboard by itself there. Only add a
// plugin here after checking EVERY call site is guarded like that.
const OPTIONAL_PLUGINS = new Set(["@capacitor/haptics", "@capacitor/clipboard"]);

// What JavaScript can call natively: the Capacitor plugins (name + major version), our own Java plugins, and the raw
// resources the JS names (notification sounds: the push channels created in usePushNotifications.js use raw/kudiai.mp3).
export function nativeFingerprint(sha) {
  try {
    const pkg = JSON.parse(git("show", `${sha}:package.json`));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const plugins = Object.keys(deps)
      .filter((n) => /^@(capacitor|capgo|capacitor-community)\//.test(n) && n !== "@capacitor/cli" && !OPTIONAL_PLUGINS.has(n))
      .sort()
      .map((n) => `${n}@${String(deps[n]).replace(/^[^\d]*/, "").split(".")[0]}`);
    let java = "none", raw = "none";
    try { java = git("rev-parse", `${sha}:android/app/src/main/java`).trim(); } catch { /* no Java tree */ }
    try { raw = git("rev-parse", `${sha}:android/app/src/main/res/raw`).trim(); } catch { /* no raw resources */ }
    return JSON.stringify({ plugins, java, raw });
  } catch {
    return null;   // commit not in history — never counts as a match
  }
}

export const apkVersionName = (run) => (run <= 185 ? `1.0.${run}` : `1.${run}.0`);

const res = await fetch(
  `https://api.github.com/repos/${REPO}/actions/workflows/build-apk.yml/runs?per_page=100`,
  { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" } },
);
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const runs = (await res.json()).workflow_runs
  .filter((r) => r.conclusion === "success")   // not ?status=success: that filter returns an inconsistent page
  .map((r) => ({ run: r.run_number, sha: r.head_sha }))
  .sort((a, b) => b.run - a.run);
if (!runs.length) throw new Error("No successful APK build found");

const want = nativeFingerprint(HEAD);
const latest = runs[0];
if (nativeFingerprint(latest.sha) !== want) {
  console.error(`::error::The code being shipped changes the native side (Capacitor plugins or Android Java) since APK build #${latest.run}. ` +
    "Phones can't get that over the air — build a new APK (build-apk.yml) first; OTA updates resume after it.");
  process.exit(1);
}
let oldest = latest;
for (const r of runs.slice(1)) {
  if (nativeFingerprint(r.sha) !== want) break;
  oldest = r;
}

const out = { bundle: `1.${latest.run}.${OTA_RUN}`, min: apkVersionName(oldest.run), latest_apk: apkVersionName(latest.run), oldest_apk: oldest.run };
console.log(`OTA bundle ${out.bundle} → APK builds #${oldest.run}..#${latest.run} (min ${out.min})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(""));
