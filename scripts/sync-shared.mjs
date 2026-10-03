// Copies src/shared/*.js to supabase/functions/_shared/app/, byte for byte. The edge functions that email monthly
// statements and reports build their PDFs with these copies, so the emailed documents are drawn by the same code as
// the app's. src/__tests__/sharedModules.test.js fails while any copy differs.
import fs from "node:fs";
const SRC = new URL("../src/shared/", import.meta.url);
const DST = new URL("../supabase/functions/_shared/app/", import.meta.url);
fs.mkdirSync(DST, { recursive: true });
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
for (const f of fs.readdirSync(DST)) if (!files.includes(f)) fs.rmSync(new URL(f, DST));   // a file removed from src/shared
for (const f of files) fs.copyFileSync(new URL(f, SRC), new URL(f, DST));
console.log(`${files.length} shared modules copied to supabase/functions/_shared/app/: ${files.join(", ")}`);
