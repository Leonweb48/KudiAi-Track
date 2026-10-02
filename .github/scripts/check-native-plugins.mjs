// build-apk.yml writes capacitor.plugins.json by hand (it doesn't run `cap sync`), and the two gradle files are kept by
// hand too. A plugin missing from any of the three ships an APK where that plugin silently does nothing — that is how
// vibration (@capacitor/haptics) was missing from every APK until #187. This fails the build instead.
import fs from "node:fs";

const NOT_PLUGINS = new Set(["@capacitor/core", "@capacitor/android", "@capacitor/cli", "@capacitor/ios", "@capacitor/assets"]);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const plugins = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter((n) => /^@(capacitor|capgo|capacitor-community)\//.test(n) && !NOT_PLUGINS.has(n));
const listed = JSON.parse(fs.readFileSync("android/app/src/main/assets/capacitor.plugins.json", "utf8")).map((p) => p.pkg);
const settings = fs.readFileSync("android/capacitor.settings.gradle", "utf8");
const build = fs.readFileSync("android/app/capacitor.build.gradle", "utf8");
const project = (n) => n.replace(/^@/, "").replace(/\//g, "-");

const problems = [];
for (const p of plugins) {
  if (!listed.includes(p)) problems.push(`${p}: missing from capacitor.plugins.json (build-apk.yml)`);
  if (!settings.includes(`':${project(p)}'`)) problems.push(`${p}: missing from android/capacitor.settings.gradle`);
  if (!build.includes(`':${project(p)}'`)) problems.push(`${p}: missing from android/app/capacitor.build.gradle`);
}
if (problems.length) {
  for (const m of problems) console.log(`::error::${m}`);
  process.exit(1);
}
console.log(`all ${plugins.length} native plugins are wired into the APK: ${plugins.join(", ")}`);
