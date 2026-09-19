// Run: deno test --allow-env --allow-net --allow-read supabase/functions/auth-email-hook/index.test.ts
//
// Proves the hook's security contract with Supabase's real signature scheme
// (Standard Webhooks). fetch is stubbed; nothing leaves the machine.

Deno.env.set("AUTH_HOOK_TEST", "1");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
Deno.env.set("EMAIL_TRIGGER_SECRET", "trigger-secret");

const enc = new TextEncoder();
const KEY_BYTES = enc.encode("0123456789abcdef0123456789abcdef");
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const REAL_SECRET = "v1,whsec_" + b64(KEY_BYTES);        // the format the Supabase dashboard shows
const OTHER_SECRET = "v1,whsec_" + b64(enc.encode("a-completely-different-secret-key!"));

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("ASSERT: " + msg); }

async function sign(secret: string, id: string, ts: number, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.replace(/^v1,whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
  return "v1," + b64(mac);
}

interface Call { url: string; method: string; body: any }
let n = 0;

// Fresh module instance per case (the enforce flag is cached per instance).
async function run(opts: {
  enforce: "true" | "false";
  body: unknown;
  signWith?: string | null;           // null => send no signature headers at all
  ageSeconds?: number;                // simulate a replayed request
  hookSecretEnv?: string;             // what the function has configured
}) {
  Deno.env.set("HOOK_SECRET", opts.hookSecretEnv ?? REAL_SECRET);
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url.includes("/rest/v1/internal_flags")) return new Response(JSON.stringify([{ value: opts.enforce }]), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const mod = await import(`./index.ts?case=${++n}`);
    const raw = JSON.stringify(opts.body);
    const headers = new Headers({ "Content-Type": "application/json" });
    if (opts.signWith !== null) {
      const id = "msg_" + n;
      const ts = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
      headers.set("webhook-id", id);
      headers.set("webhook-timestamp", String(ts));
      headers.set("webhook-signature", await sign(opts.signWith ?? REAL_SECRET, id, ts, raw));
    }
    const res = await mod.handle(new Request("https://hook.test/", { method: "POST", headers, body: raw }));
    return {
      status: res.status,
      json: await res.json(),
      emailCalls: calls.filter((c) => c.url.includes("admin.kudiai.app")),
      logCalls: calls.filter((c) => c.url.includes("/rest/v1/email_delivery_log")),
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const magiclink = { user: { email: "victim@example.com", user_metadata: { full_name: "Vic" } }, email_data: { email_action_type: "magiclink", token: "123456" } };
const recovery = (tokenUrl: string) => ({
  user: { email: "victim@example.com" },
  email_data: { email_action_type: "recovery", token_hash: "HASH123", token_url: tokenUrl, redirect_to: "https://evil.example/steal" },
});

Deno.test("valid Standard Webhooks signature, enforcing -> email is sent and hook answers {}", async () => {
  const r = await run({ enforce: "true", body: magiclink });
  assert(r.status === 200 && JSON.stringify(r.json) === "{}", "answers 200 {}");
  assert(r.emailCalls.length === 1, "exactly one email trigger call");
  assert(r.emailCalls[0].body.event === "business_login_otp", "magiclink -> login OTP event");
  assert(r.emailCalls[0].body.data.email === "victim@example.com", "recipient forwarded");
});

Deno.test("FORGED signature (wrong secret), enforcing -> {} returned and NO email is sent", async () => {
  const r = await run({ enforce: "true", body: magiclink, signWith: OTHER_SECRET });
  assert(JSON.stringify(r.json) === "{}", "answers {}");
  assert(r.emailCalls.length === 0, "no email trigger call");
  assert(r.logCalls.some((c) => c.body.status === "failed" && String(c.body.subject).includes("REJECTED")), "rejection is logged");
});

Deno.test("no signature at all (anyone with the URL), enforcing -> no email", async () => {
  const r = await run({ enforce: "true", body: recovery("https://evil.example/reset"), signWith: null });
  assert(JSON.stringify(r.json) === "{}", "answers {}");
  assert(r.emailCalls.length === 0, "no password-reset email for an unsigned request");
});

Deno.test("replayed request (valid signature, 10 minutes old), enforcing -> no email", async () => {
  const r = await run({ enforce: "true", body: magiclink, ageSeconds: 600 });
  assert(r.emailCalls.length === 0, "stale timestamp rejected");
});

Deno.test("HOOK_SECRET not configured, enforcing -> no email (fail closed)", async () => {
  const r = await run({ enforce: "true", body: magiclink, hookSecretEnv: "" });
  assert(r.emailCalls.length === 0, "no secret => nothing is trusted");
});

Deno.test("shadow mode: forged request is LOGGED as rejected but still processed (rollout safety)", async () => {
  const r = await run({ enforce: "false", body: magiclink, signWith: OTHER_SECRET });
  assert(r.emailCalls.length === 1, "shadow mode still forwards");
  assert(r.logCalls.some((c) => String(c.body.subject).includes("REJECTED")), "verdict is recorded");
});

Deno.test("shadow mode: a VERIFIED request is logged as verified (this is the proof HOOK_SECRET matches)", async () => {
  const r = await run({ enforce: "false", body: magiclink });
  assert(r.logCalls.some((c) => c.body.status === "sent" && String(c.body.subject).includes("VERIFIED")), "verified verdict recorded");
});

Deno.test("even with a VALID signature, an attacker-supplied token_url is never used as the reset link", async () => {
  const r = await run({ enforce: "true", body: recovery("https://evil.example/reset?t=1") });
  assert(r.emailCalls.length === 1, "legit recovery still sends");
  const url: string = r.emailCalls[0].body.data.reset_url;
  assert(url.startsWith("https://proj.supabase.co/auth/v1/verify?token=HASH123"), "link built from our own project + token_hash");
  assert(!url.includes("evil.example/reset") && !url.includes("evil.example%2Fsteal"), "no attacker host in the link");
});

Deno.test("event mapping: signup / magiclink / email change use their own events", async () => {
  const signup = await run({ enforce: "true", body: { user: { email: "a@x.com" }, email_data: { email_action_type: "signup", token: "111111" } } });
  assert(signup.emailCalls[0].body.event === "business_signup_otp", "signup");
  const change = await run({ enforce: "true", body: { user: { email: "old@x.com", new_email: "new@x.com" }, email_data: { email_action_type: "email_change_new", token: "1", token_new: "222222" } } });
  assert(change.emailCalls[0].body.event === "business_email_change_otp", "email change has its own event");
  assert(change.emailCalls[0].body.data.email === "new@x.com", "code goes to the NEW address");
  assert(change.emailCalls[0].body.data.otp_token === "222222", "uses the new-address token");
});
