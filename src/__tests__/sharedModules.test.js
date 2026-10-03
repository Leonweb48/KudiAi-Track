// src/shared/*.js run on the server too (supabase/functions/_shared/app/ — the monthly statement and report emails build
// their PDFs with them). The copies must be byte-for-byte the app's: run `node scripts/sync-shared.mjs` after editing.
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const app = path.join(root, "src/shared");
const server = path.join(root, "supabase/functions/_shared/app");
const files = fs.readdirSync(app).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));

describe("shared modules (app ⇄ server)", () => {
  it("every shared module has a server copy, and nothing extra", () => {
    expect(fs.readdirSync(server).sort()).toEqual([...files].sort());
  });
  it.each(files)("%s is identical on the server", (f) => {
    expect(fs.readFileSync(path.join(server, f), "utf8")).toBe(fs.readFileSync(path.join(app, f), "utf8"));
  });
  it.each(files)("%s only imports other shared modules", (f) => {
    const src = fs.readFileSync(path.join(app, f), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const i of imports) expect(i).toMatch(/^\.\/[A-Za-z0-9_]+\.js$/);
  });
});
