// Supabase query builders are thenable but have NO .catch(): `supabase.from(t).insert(x).catch(fn)` throws a
// TypeError before the request is even sent. It broke failed-email logging and, worse, the expired-cancelled-plan
// downgrade in useAuth (sign-in threw, the app never left the loading screen). Use `await` (it resolves to
// { error }) or `.then(ok, fail)` instead.
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "..");
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : files(path.join(d, e.name));
  return /\.(js|jsx)$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [path.join(d, e.name)] : [];
});

// The statement that starts at `i`, up to its closing ; at depth 0 (or the bracket that closes the enclosing call).
function statementAt(s, i) {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth < 0) break; }
    else if (c === ";" && depth === 0) break;
  }
  return s.slice(i, j);
}

test("no .catch() chained directly onto a Supabase query builder", () => {
  const bad = [];
  for (const f of files(SRC)) {
    const s = fs.readFileSync(f, "utf8");
    const re = /supabase\??\.(from|rpc)\(/g;
    let m;
    while ((m = re.exec(s))) {
      const stmt = statementAt(s, m.index);
      if (/\)\s*\.catch\(/.test(stmt) && !/\.then\(/.test(stmt)) bad.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split("\n").length}`);
    }
  }
  expect(bad).toEqual([]);
});

describe("sendEmailTrigger failure logging", () => {
  const insert = jest.fn();
  beforeEach(() => {
    jest.resetModules();
    insert.mockReset();
    // A builder like the real one: thenable, no .catch()
    insert.mockImplementation(() => ({ then: (ok) => Promise.resolve({ error: null }).then(ok) }));
    jest.doMock("../utils/supabase", () => ({ supabase: { from: () => ({ insert }), auth: { getSession: async () => ({ data: { session: null } }) } } }));
  });
  afterEach(() => { delete global.fetch; });

  test("a network failure is logged, not thrown", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
    const { sendEmailTrigger, setEmailToken } = require("../utils/emailTrigger");
    setEmailToken("t");
    await expect(sendEmailTrigger("welcome", { email: "a@example.com" })).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ subject: "[FAILED] welcome", status: "failed", error_msg: "offline" }));
  });

  test("an HTTP error is logged, not thrown", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve("bad gateway") }));
    const { sendEmailTrigger, setEmailToken } = require("../utils/emailTrigger");
    setEmailToken("t");
    await expect(sendEmailTrigger("receipt", { email: "a@example.com" })).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ subject: "[FAILED] receipt", error_msg: "HTTP 502: bad gateway" }));
  });
});
