// Identity checks (BVN / NIN) through Youverify — logic + tests live here so the wallet code only has to call checkIdentity().
//
// WHAT IT DOES: takes an ID number the customer typed, asks Youverify (which asks NIBSS for a BVN / NIMC for a NIN) whether it is real and who it
// belongs to, and compares that name with the name the customer gave us. Nothing else from the provider's response is kept — the record also carries a
// photo, address, phone and date of birth, and those are read into memory only long enough to be dropped (our privacy policy commits to not storing
// BVN/NIN-derived data beyond what the wallet needs). It never returns the name it found: telling a stranger whose BVN a number is would turn this
// endpoint into a lookup service, so a mismatch is only ever "doesn't match".
//
// SAFETY NETS: explicit consent is required (Youverify demands isSubjectConsent = true, and it must really be the customer's), a person can only try a
// few times a day (each lookup costs money and an unlimited endpoint would be a way to guess other people's numbers), an ID that was already verified
// for the same person is never looked up — and paid for — again, and a provider outage / empty provider wallet is reported to the admins.
//
// SELFIE (optional, on top of the name check): a live photo is sent alongside the ID as `validations.selfie.image` — a full data URI, a real image,
// 48–4096 px each side, at most 1 MB (Youverify's own limits, confirmed against their sandbox before this was written). Youverify compares it with the
// photo NIBSS/NIMC has on file for that BVN/NIN and returns a confidence score and its own match verdict — that verdict (not our own scoring) is what
// this module trusts. THE PROVIDER'S REPLY ECHOES THE SUBMITTED IMAGE BACK — every place that reads a selfie result must destructure only
// {match, confidenceLevel, threshold} and must never log, store or pass along the raw response object once a selfie was involved.

export type IdKind = "bvn" | "nin";

export interface Person { firstName: string; middleName: string; lastName: string }
/** The provider's own verdict on a submitted selfie against the ID's file photo. Never carries the image. */
export interface SelfieResult { match: boolean; confidenceLevel: number; threshold: number }
export type Lookup =
  | { status: "found"; person: Person; providerRef: string; selfie?: SelfieResult }
  | { status: "not_found" }
  | { status: "no_funds" }
  | { status: "invalid_image" }
  | { status: "unavailable"; reason: string };

export interface YouverifyConfig { baseUrl: string; token: string }

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * A very loose sanity check on a client-submitted selfie before spending a provider call on it — Youverify itself enforces the real rules (a real
 * image, 48–4096 px, ≤1MB; confirmed against their sandbox). This only catches "clearly not a photo at all"; a bad-but-plausible-looking image still
 * reaches Youverify and comes back as the friendlier `selfie_invalid_image` result instead of a generic 400.
 */
export function selfieImageOk(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 1_500_000 && /^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/]+=*$/.test(v);
}

/**
 * One lookup. A single attempt on purpose (no retries): every call may be billed, and a timeout is reported as "unavailable" rather than repeated.
 * `selfieImage`, when given, must already be a full data URI (`data:image/jpeg;base64,…` or `data:image/png;base64,…`).
 */
export async function youverifyLookup(
  fetchFn: typeof fetch, cfg: YouverifyConfig, kind: IdKind, id: string, ref: string, selfieImage?: string, timeoutMs = 15_000,
): Promise<Lookup> {
  if (!cfg.token) return { status: "unavailable", reason: "not configured" };
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v2/api/identity/ng/${kind}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST", signal: ctrl.signal,
      headers: { token: cfg.token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        id, isSubjectConsent: true, metadata: { ref },
        ...(selfieImage ? { validations: { selfie: { image: selfieImage } } } : {}),
      }),
    });
  } catch (e) {
    return { status: "unavailable", reason: (e as Error).name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }

  let body: Record<string, unknown> = {};
  try { body = await res.json() as Record<string, unknown>; } catch { /* not JSON */ }
  const msg = clean(body.message).slice(0, 120);

  if (res.status === 402) return { status: "no_funds" };
  if (res.status === 401 || res.status === 403) return { status: "unavailable", reason: `refused (${res.status}): ${msg || "check the API key and that the product is enabled"}` };
  if (res.status >= 500) return { status: "unavailable", reason: `provider error (${res.status})` };
  if (res.status !== 200) {
    // A bad photo (too small, corrupt, not an image) 400s the WHOLE request — that's a photo problem, never "this BVN/NIN doesn't exist".
    if (selfieImage && /invalid image/i.test(msg)) return { status: "invalid_image" };
    // A number that does not exist comes back as a client error; anything else unexpected is not held against the customer.
    return /not found|no record|invalid|does not exist|not exist/i.test(msg) ? { status: "not_found" } : { status: "unavailable", reason: `unexpected ${res.status}: ${msg}` };
  }
  const data = (body.data ?? null) as Record<string, unknown> | null;
  if (body.success === false || !data) return /not found|no record|invalid|does not exist/i.test(msg) ? { status: "not_found" } : { status: "unavailable", reason: `unexpected reply: ${msg}` };
  const st = clean(data.status).toLowerCase();
  if (st && st !== "found") return { status: "not_found" };
  const person: Person = { firstName: clean(data.firstName), middleName: clean(data.middleName), lastName: clean(data.lastName) };
  if (!person.firstName && !person.lastName) return { status: "unavailable", reason: "empty record" };

  let selfie: SelfieResult | undefined;
  if (selfieImage) {
    // NOTE: `data.validations?.selfie?.selfieVerification` also carries an `image` field — the submitted photo, echoed back. Deliberately not read here.
    const validations = data.validations as Record<string, unknown> | undefined;
    const sv = ((validations?.selfie as Record<string, unknown> | undefined)?.selfieVerification ?? null) as Record<string, unknown> | null;
    if (sv && typeof sv.match === "boolean") {
      selfie = { match: sv.match, confidenceLevel: Number(sv.confidenceLevel) || 0, threshold: Number(sv.threshold) || 0 };
    }
    // sv missing entirely = the provider accepted the photo but returned no verdict (a contract change on their end) — surfaced as "unavailable" by
    // the caller (checkIdentity), which alerts the admins, rather than silently treated as either a pass or a fail.
  }
  return { status: "found", person, providerRef: clean(data.id).slice(0, 80), ...(selfie ? { selfie } : {}) };
}

// ── name matching ─────────────────────────────────────────────────────────────────────────────────────────────────

const words = (s: string): string[] =>
  // strip accents (combining marks), drop apostrophes of any kind (O'Neil = Oneil), treat hyphens as spaces, keep letters only
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\p{Pf}\p{Pi}'`]/gu, "").replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);

function edits(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same word, allowing one slip on a longer word (a typo is not a different person; a short word must match exactly). */
const same = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && edits(a, b, 1) <= 1);

/**
 * Does the name the customer gave belong to the person the provider found? Order does not matter ("Okonkwo Amaka" = "Amaka Okonkwo"), accents and
 * hyphens are ignored, and the LAST name must match plus at least one of the first / middle names (many people use their middle name day to day).
 * A first name split across two words ("Chukwu Emeka") matches when written as one ("Chukwuemeka") and the other way round.
 */
export function namesMatch(declared: string, p: Person): boolean {
  const d = words(declared);
  if (!d.length) return false;
  const dJoined = d.join("");
  // anyWord: a compound surname ("Adeyemi-Bello") is matched by either half; a first / middle name must match in full
  const hit = (name: string, anyWord = false): boolean => {
    const parts = words(name);
    if (!parts.length) return false;
    const joined = parts.join("");
    const inD = (w: string) => d.some((x) => same(x, w));
    if (anyWord ? parts.some((w) => w.length >= 3 && inD(w)) : parts.every(inD)) return true;
    return joined.length >= 4 && (d.some((x) => same(x, joined)) || dJoined.includes(joined));
  };
  if (!hit(p.lastName, true)) return false;
  return hit(p.firstName) || hit(p.middleName);
}

/** "Amaka Chidinma Okonkwo" (a stored verified name) back into parts: first word = first name, last word = last name, the rest = middle. */
export function personFromFullName(full: string): Person {
  const w = clean(full).split(" ").filter(Boolean);
  if (w.length <= 1) return { firstName: w[0] ?? "", middleName: "", lastName: "" };
  return { firstName: w[0], middleName: w.slice(1, -1).join(" "), lastName: w[w.length - 1] };
}

// ── the check ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckDeps {
  /** Record the attempt (audit + rate limit). */
  begin(a: { userId: string; kind: IdKind; hmac: string }): Promise<{ ok: true; checkId: string } | { ok: false; reason: "rate_limited" }>;
  /** A verification already on file for this person and this exact number. selfieMatched: null = no selfie was ever checked for this person. */
  cached(a: { userId: string; kind: IdKind; hmac: string }): Promise<{ verifiedName: string; selfieMatched: boolean | null } | null>;
  lookup(kind: IdKind, id: string, ref: string, selfieImage?: string): Promise<Lookup>;
  /** selfieSubmitted: did THIS attempt's request include a selfie at all. selfie: the verdict, only when the provider actually returned one. */
  finish(checkId: string, r: { outcome: string; matched: boolean | null; providerRef?: string; billed: boolean; selfieSubmitted: boolean; selfie?: SelfieResult | null }): Promise<void>;
  saveVerified(a: {
    userId: string; kind: IdKind; hmac: string; verifiedName: string; providerRef: string; checkId: string; matched: boolean | null;
    table: IdTable; selfieMatched: boolean | null;
  }): Promise<void>;
  alertAdmins(title: string, message: string): Promise<void>;
}

/** Which table holds this person's identity: a business owner, an Ajo client, or staff / a manager. */
export type IdTable = "profiles" | "aso_clients" | "staff";

export type CheckCode =
  | "consent_required" | "id_format" | "rate_limited" | "not_found" | "mismatch" | "unavailable"
  | "selfie_required" | "selfie_no_match" | "selfie_invalid_image";
export type CheckResult =
  | { ok: true; kind: IdKind; verifiedName: string; cached: boolean; nameMatched: boolean | null; selfieMatched: boolean | null }
  | { ok: false; code: CheckCode; message: string };

const LABEL: Record<IdKind, string> = { bvn: "BVN", nin: "NIN" };

export async function checkIdentity(
  deps: CheckDeps,
  a: {
    userId: string; kind: IdKind; id: string; consent: boolean; declaredName?: string; hmac: string; table?: IdTable;
    /** A full data URI (data:image/…;base64,…). Omit when a selfie isn't being collected at all. */
    selfieImage?: string;
    /** true = this action REQUIRES a passing selfie match (not just the ID/name), and a cached ID/name-only verification cannot be reused without one. */
    selfieRequired?: boolean;
  },
): Promise<CheckResult> {
  const L = LABEL[a.kind];
  if (a.consent !== true) return { ok: false, code: "consent_required", message: `Please tick the box to agree that we may verify your ${L}.` };
  if (!/^\d{11}$/.test(a.id)) return { ok: false, code: "id_format", message: `Your ${L} must be exactly 11 digits` };
  if (a.selfieRequired && !a.selfieImage) return { ok: false, code: "selfie_required", message: "Take a selfie to finish verifying your identity." };
  const declared = clean(a.declaredName);

  const known = await deps.cached({ userId: a.userId, kind: a.kind, hmac: a.hmac });
  // A cache hit is reused only if it already satisfies what THIS action needs — an ID/name-only verification from before does not let someone skip a
  // selfie check an action now requires (a "prove it's you, right now" step, never something that can be answered from an old record).
  if (known && !(a.selfieRequired && known.selfieMatched !== true)) {
    const matched = declared ? namesMatch(declared, personFromFullName(known.verifiedName)) : null;
    if (matched === false) return { ok: false, code: "mismatch", message: `The name on this ${L} doesn't match the name you gave us. Use your name exactly as it is on your ${L}.` };
    return { ok: true, kind: a.kind, verifiedName: known.verifiedName, cached: true, nameMatched: matched, selfieMatched: known.selfieMatched };
  }

  const b = await deps.begin({ userId: a.userId, kind: a.kind, hmac: a.hmac });
  if (!b.ok) return { ok: false, code: "rate_limited", message: "Too many verification attempts today. Please try again tomorrow, or contact support." };

  let r: Lookup;
  try { r = await deps.lookup(a.kind, a.id, b.checkId, a.selfieImage); }
  catch (e) { r = { status: "unavailable", reason: `error: ${(e as Error).message}`.slice(0, 120) }; }

  const submitted = !!a.selfieImage;
  const unavailable: CheckResult = { ok: false, code: "unavailable", message: "ID verification is temporarily unavailable. Please try again shortly — nothing was charged." };
  if (r.status === "no_funds") {
    await deps.finish(b.checkId, { outcome: "no_funds", matched: null, billed: false, selfieSubmitted: submitted });
    await deps.alertAdmins("ID verification stopped: the Youverify wallet is empty", "Youverify refused a lookup for insufficient funds. Customers cannot verify their BVN/NIN until it is topped up.").catch(() => {});
    return unavailable;
  }
  if (r.status === "invalid_image") {
    await deps.finish(b.checkId, { outcome: "unavailable", matched: null, billed: false, selfieSubmitted: true, selfie: null });
    return { ok: false, code: "selfie_invalid_image", message: "We couldn't use that photo — please retake it in good light, with your whole face in frame, and try again." };
  }
  if (r.status === "unavailable") {
    await deps.finish(b.checkId, { outcome: "unavailable", matched: null, billed: false, selfieSubmitted: submitted });
    if (/refused|not configured/.test(r.reason)) await deps.alertAdmins("ID verification is not working", `Youverify lookups are failing: ${r.reason}`).catch(() => {});
    return unavailable;
  }
  if (r.status === "not_found") {
    await deps.finish(b.checkId, { outcome: "not_found", matched: null, billed: false, selfieSubmitted: submitted });
    return { ok: false, code: "not_found", message: `We couldn't find that ${L}. Check the number and try again.` };
  }

  const verifiedName = [r.person.firstName, r.person.middleName, r.person.lastName].filter(Boolean).join(" ");
  const matched = declared ? namesMatch(declared, r.person) : null;
  if (matched === false) {
    await deps.finish(b.checkId, { outcome: "mismatch", matched: false, providerRef: r.providerRef, billed: true, selfieSubmitted: submitted, selfie: r.selfie ?? null });
    return { ok: false, code: "mismatch", message: `The name on this ${L} doesn't match the name you gave us. Use your name exactly as it is on your ${L}.` };
  }

  // A selfie was sent: the provider must give back a real verdict, and that verdict — not our own scoring — decides pass/fail.
  let selfieMatched: boolean | null = null;
  if (a.selfieImage) {
    if (!r.selfie) {
      // the provider accepted the photo but returned no result at all — a contract change on their end, not the customer's fault; do not guess
      await deps.finish(b.checkId, { outcome: "unavailable", matched, billed: true, selfieSubmitted: true, selfie: null });
      await deps.alertAdmins("ID verification: selfie result missing", "Youverify returned no selfie verdict for a submitted photo — check its response shape.").catch(() => {});
      return unavailable;
    }
    selfieMatched = r.selfie.match;
    if (a.selfieRequired && !selfieMatched) {
      await deps.finish(b.checkId, { outcome: "mismatch", matched, providerRef: r.providerRef, billed: true, selfieSubmitted: true, selfie: r.selfie });
      return { ok: false, code: "selfie_no_match", message: "Your selfie doesn't look like the photo on file for this ID. Make sure your face is clearly lit and try again." };
    }
  }

  await deps.saveVerified({ userId: a.userId, kind: a.kind, hmac: a.hmac, verifiedName, providerRef: r.providerRef, checkId: b.checkId, matched, table: a.table ?? "profiles", selfieMatched });
  await deps.finish(b.checkId, { outcome: "verified", matched, providerRef: r.providerRef, billed: true, selfieSubmitted: submitted, selfie: r.selfie ?? null });
  return { ok: true, kind: a.kind, verifiedName, cached: false, nameMatched: matched, selfieMatched };
}

/** HMAC-SHA256 hex of `label:value` — the same keyed hash wallet_kyc uses, so one number is recognisable across tables without being stored. */
export async function hmacHex(secret: string, label: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${label}:${value}`));
  return Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ── wiring to the database (thin; the SQL behind it is tested separately) ──────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Sb = any;
export function makeIdCheckDeps(
  sb: Sb, opts: { fetchFn: typeof fetch; cfg: YouverifyConfig; maxPerDay: number; consentVersion: string },
): CheckDeps {
  return {
    async begin({ userId, kind, hmac }) {
      const { data, error } = await sb.rpc("kyc_check_begin", { p_user: userId, p_kind: kind, p_hmac: hmac, p_max_per_day: opts.maxPerDay, p_consent_version: opts.consentVersion });
      if (error) throw new Error(`kyc_check_begin: ${error.message}`);
      return data?.ok ? { ok: true, checkId: String(data.id) } : { ok: false, reason: "rate_limited" };
    },
    async cached({ userId, kind, hmac }) {
      const { data } = await sb.from("kyc_verified").select("verified_name, id_hmac, selfie_matched").eq("user_id", userId).eq("kind", kind).maybeSingle();
      return data && data.id_hmac === hmac ? { verifiedName: String(data.verified_name || ""), selfieMatched: data.selfie_matched ?? null } : null;
    },
    lookup: (kind, id, ref, selfieImage) => youverifyLookup(opts.fetchFn, opts.cfg, kind, id, ref, selfieImage),
    async finish(checkId, r) {
      await sb.rpc("kyc_check_finish", {
        p_id: checkId, p_outcome: r.outcome, p_matched: r.matched, p_provider_ref: r.providerRef ?? null, p_billed: r.billed,
        p_selfie_submitted: r.selfieSubmitted, p_selfie_matched: r.selfie?.match ?? null, p_selfie_confidence: r.selfie?.confidenceLevel ?? null,
      });
    },
    async saveVerified({ userId, kind, hmac, verifiedName, providerRef, checkId, matched, table, selfieMatched }) {
      const { error } = await sb.rpc("kyc_save_verified", {
        p_user: userId, p_kind: kind, p_hmac: hmac, p_name: verifiedName, p_provider_ref: providerRef, p_check_id: checkId,
        p_matched: matched, p_table: table, p_selfie_matched: selfieMatched,
      });
      if (error) throw new Error(`kyc_save_verified: ${error.message}`);
    },
    async alertAdmins(title, message) {
      // one notice per problem per 6 hours — an outage must not fill the admin inbox with a row per customer
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: recent } = await sb.from("admin_notifications").select("id").eq("title", title).gte("created_at", since).limit(1);
      if (recent && recent.length) return;
      await sb.from("admin_notifications").insert({ type: "error", category: "finance", target_roles: ["finance_admin", "super_admin"], title, message });
    },
  };
}

/**
 * Read the switches (platform_config) and build the dependencies. `enabled: false` means the feature is off — callers do exactly what they did before.
 * The API token is a function secret passed in by the caller; the environment (sandbox / live), limits and fail-open switch are config.
 */
export async function loadIdCheck(
  sb: Sb, cfg: (key: string, fallback: string) => Promise<string>, env: { fetchFn: typeof fetch; token: string },
): Promise<{ enabled: false } | { enabled: true; deps: CheckDeps; failOpen: boolean }> {
  if ((await cfg("kyc_youverify_enabled", "false")) !== "true") return { enabled: false };
  return {
    enabled: true,
    failOpen: (await cfg("kyc_fail_open", "false")) === "true",
    deps: makeIdCheckDeps(sb, {
      fetchFn: env.fetchFn,
      // sandbox unless the live switch is on (an explicit address can override both — used by tests)
      cfg: { baseUrl: (await cfg("kyc_youverify_base", "")) || ((await cfg("kyc_youverify_live", "false")) === "true" ? "https://api.youverify.co" : "https://api.sandbox.youverify.co"), token: env.token },
      maxPerDay: Number(await cfg("kyc_max_checks_per_day", "6")) || 0,   // an unreadable limit refuses rather than allowing unlimited tries
      consentVersion: await cfg("kyc_consent_version", "2026-09"),
    }),
  };
}
