import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;
const MAX_LOCKOUTS = 3;

// ── PIN hashing via Web Crypto (PBKDF2) — no external deps ───────────────────
async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `pbkdf2$${toB64(salt)}$${toB64(new Uint8Array(derived))}`;
}

async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const salt = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
  const expectedBytes = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const actualBytes = new Uint8Array(derived);
  if (actualBytes.length !== expectedBytes.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < actualBytes.length; i++) {
    diff |= actualBytes[i] ^ expectedBytes[i];
  }
  return diff === 0;
}

// ── Weak PIN detection ─────────────────────────────────────────────────────────
const WEAK_6_DIGIT_PINS = new Set([
  "000000","111111","222222","333333","444444",
  "555555","666666","777777","888888","999999",
  "123456","234567","345678","456789",
  "987654","876543","765432","654321",
  "112233","123123","121212","101010","102030",
]);

const WEAK_4_DIGIT_PINS = new Set([
  "0000","1111","2222","3333","4444",
  "5555","6666","7777","8888","9999",
  "1234","2345","3456","4567","5678","6789",
  "9876","8765","7654","6543","5432","4321",
  "1212","1122","1010","2580","0852",
]);

function isWeakPin(pin: string, digits: 4 | 6): boolean {
  return digits === 6 ? WEAK_6_DIGIT_PINS.has(pin) : WEAK_4_DIGIT_PINS.has(pin);
}

function validatePin(pin: unknown, digits: 4 | 6): string | null {
  if (typeof pin !== "string") return "PIN must be a string";
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only";
  if (pin.length !== digits) return `PIN must be exactly ${digits} digits`;
  if (isWeakPin(pin, digits)) return "PIN is too common or predictable";
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string): Response {
  // Always HTTP 200 — client reads success/error from body
  return jsonResponse({ success: false, error: message });
}

function isLocked(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil) > new Date();
}

function attemptsLeft(attempts: number): number {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}

// ── Main handler ───────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Missing or invalid Authorization header");
    }
    const token = authHeader.replace("Bearer ", "");

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return errorResponse("Unauthorized");
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action, ...params } = body as { action: string; [k: string]: unknown };

    if (!action) return errorResponse("Missing action");

    // ── Fetch profile ─────────────────────────────────────────────────────────
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select(
        "app_pin_hash, app_pin_attempts, app_pin_locked_until, app_pin_lockout_count, " +
        "txn_pin_hash, txn_pin_attempts, txn_pin_locked_until, txn_pin_lockout_count, " +
        "txn_pin_reset_at, biometric_enabled, auto_lock_timeout",
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return errorResponse(`Profile not found: ${profileError?.message ?? "no row"}`);
    }

    // ── Helper: update profile columns ────────────────────────────────────────
    async function updateProfile(updates: Record<string, unknown>): Promise<void> {
      const { error: updateError } = await adminClient
        .from("profiles")
        .update(updates)
        .eq("id", user!.id);
      if (updateError) throw new Error(`DB update failed: ${updateError.message}`);
    }

    // ── check_status ──────────────────────────────────────────────────────────
    if (action === "check_status") {
      const appLocked = isLocked(profile.app_pin_locked_until);
      const txnLocked = isLocked(profile.txn_pin_locked_until);

      return jsonResponse({
        appPinSet: !!profile.app_pin_hash,
        txnPinSet: !!profile.txn_pin_hash,
        appPinLocked: appLocked,
        appPinLockedUntil: appLocked ? profile.app_pin_locked_until : null,
        appPinAttemptsLeft: appLocked ? 0 : attemptsLeft(profile.app_pin_attempts),
        appPinLockoutCount: profile.app_pin_lockout_count,
        txnPinLocked: txnLocked,
        txnPinLockedUntil: txnLocked ? profile.txn_pin_locked_until : null,
        txnPinAttemptsLeft: txnLocked ? 0 : attemptsLeft(profile.txn_pin_attempts),
        txnPinLockoutCount: profile.txn_pin_lockout_count,
        txnPinResetAt: profile.txn_pin_reset_at,
        biometricEnabled: profile.biometric_enabled,
        autoLockTimeout: profile.auto_lock_timeout,
        requiresReauth: profile.app_pin_lockout_count >= MAX_LOCKOUTS ||
                        profile.txn_pin_lockout_count >= MAX_LOCKOUTS,
      });
    }

    // ── setup_app_pin ─────────────────────────────────────────────────────────
    if (action === "setup_app_pin") {
      const err = validatePin(params.pin, 6);
      if (err) return errorResponse(err);
      const hash = await hashPin(params.pin as string);
      await updateProfile({
        app_pin_hash: hash,
        app_pin_attempts: 0,
        app_pin_locked_until: null,
        app_pin_lockout_count: 0,
      });
      return jsonResponse({ success: true });
    }

    // ── setup_txn_pin ─────────────────────────────────────────────────────────
    if (action === "setup_txn_pin") {
      const err = validatePin(params.pin, 4);
      if (err) return errorResponse(err);
      const hash = await hashPin(params.pin as string);
      await updateProfile({
        txn_pin_hash: hash,
        txn_pin_attempts: 0,
        txn_pin_locked_until: null,
        txn_pin_lockout_count: 0,
      });
      return jsonResponse({ success: true });
    }

    // ── verify_app_pin ────────────────────────────────────────────────────────
    if (action === "verify_app_pin") {
      if (!profile.app_pin_hash) return errorResponse("App PIN not set");
      if (typeof params.pin !== "string") return errorResponse("PIN required");

      if (isLocked(profile.app_pin_locked_until)) {
        return jsonResponse({
          success: false,
          locked: true,
          lockedUntil: profile.app_pin_locked_until,
          attemptsLeft: 0,
          requiresReauth: profile.app_pin_lockout_count >= MAX_LOCKOUTS,
        });
      }

      const correct = await verifyPinHash(params.pin, profile.app_pin_hash);

      if (correct) {
        await updateProfile({ app_pin_attempts: 0, app_pin_locked_until: null });
        return jsonResponse({ success: true });
      }

      const newAttempts = profile.app_pin_attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        const newLockoutCount = profile.app_pin_lockout_count + 1;
        await updateProfile({
          app_pin_attempts: 0,
          app_pin_locked_until: lockedUntil,
          app_pin_lockout_count: newLockoutCount,
        });
        return jsonResponse({
          success: false,
          locked: true,
          lockedUntil,
          attemptsLeft: 0,
          requiresReauth: newLockoutCount >= MAX_LOCKOUTS,
        });
      }

      await updateProfile({ app_pin_attempts: newAttempts });
      return jsonResponse({
        success: false,
        locked: false,
        attemptsLeft: MAX_ATTEMPTS - newAttempts,
        requiresReauth: false,
      });
    }

    // ── verify_txn_pin ────────────────────────────────────────────────────────
    if (action === "verify_txn_pin") {
      if (!profile.txn_pin_hash) return errorResponse("Transaction PIN not set");
      if (typeof params.pin !== "string") return errorResponse("PIN required");

      if (isLocked(profile.txn_pin_locked_until)) {
        return jsonResponse({
          success: false,
          locked: true,
          lockedUntil: profile.txn_pin_locked_until,
          attemptsLeft: 0,
          requiresReauth: profile.txn_pin_lockout_count >= MAX_LOCKOUTS,
        });
      }

      const correct = await verifyPinHash(params.pin, profile.txn_pin_hash);

      if (correct) {
        await updateProfile({ txn_pin_attempts: 0, txn_pin_locked_until: null });
        return jsonResponse({ success: true });
      }

      const newAttempts = profile.txn_pin_attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        const newLockoutCount = profile.txn_pin_lockout_count + 1;
        await updateProfile({
          txn_pin_attempts: 0,
          txn_pin_locked_until: lockedUntil,
          txn_pin_lockout_count: newLockoutCount,
        });
        return jsonResponse({
          success: false,
          locked: true,
          lockedUntil,
          attemptsLeft: 0,
          requiresReauth: newLockoutCount >= MAX_LOCKOUTS,
        });
      }

      await updateProfile({ txn_pin_attempts: newAttempts });
      return jsonResponse({
        success: false,
        locked: false,
        attemptsLeft: MAX_ATTEMPTS - newAttempts,
        requiresReauth: false,
      });
    }

    // ── change_app_pin ────────────────────────────────────────────────────────
    if (action === "change_app_pin") {
      if (!profile.app_pin_hash) return errorResponse("App PIN not set — use setup_app_pin");
      if (typeof params.current_pin !== "string") return errorResponse("current_pin required");
      const err = validatePin(params.new_pin, 6);
      if (err) return errorResponse(err);

      const correct = await verifyPinHash(params.current_pin, profile.app_pin_hash);
      if (!correct) return jsonResponse({ success: false, error: "Current PIN is incorrect" });

      const hash = await hashPin(params.new_pin as string);
      await updateProfile({
        app_pin_hash: hash,
        app_pin_attempts: 0,
        app_pin_locked_until: null,
        app_pin_lockout_count: 0,
      });
      return jsonResponse({ success: true });
    }

    // ── change_txn_pin ────────────────────────────────────────────────────────
    if (action === "change_txn_pin") {
      if (!profile.txn_pin_hash) return errorResponse("Transaction PIN not set — use setup_txn_pin");
      if (typeof params.current_pin !== "string") return errorResponse("current_pin required");
      const err = validatePin(params.new_pin, 4);
      if (err) return errorResponse(err);

      const correct = await verifyPinHash(params.current_pin, profile.txn_pin_hash);
      if (!correct) return jsonResponse({ success: false, error: "Current PIN is incorrect" });

      const hash = await hashPin(params.new_pin as string);
      await updateProfile({
        txn_pin_hash: hash,
        txn_pin_attempts: 0,
        txn_pin_locked_until: null,
        txn_pin_lockout_count: 0,
        txn_pin_reset_at: new Date().toISOString(),
      });
      return jsonResponse({ success: true });
    }

    // ── reset_app_pin (identity already verified via OTP in the client) ──────
    if (action === "reset_app_pin") {
      const err = validatePin(params.new_pin, 6);
      if (err) return errorResponse(err);
      const hash = await hashPin(params.new_pin as string);
      await updateProfile({
        app_pin_hash: hash,
        app_pin_attempts: 0,
        app_pin_locked_until: null,
        app_pin_lockout_count: 0,
      });
      return jsonResponse({ success: true });
    }

    // ── reset_txn_pin (identity already verified via OTP in the client) ──────
    if (action === "reset_txn_pin") {
      const err = validatePin(params.new_pin, 4);
      if (err) return errorResponse(err);
      const hash = await hashPin(params.new_pin as string);
      await updateProfile({
        txn_pin_hash: hash,
        txn_pin_attempts: 0,
        txn_pin_locked_until: null,
        txn_pin_lockout_count: 0,
        txn_pin_reset_at: new Date().toISOString(),
      });
      return jsonResponse({ success: true });
    }

    // ── update_settings ───────────────────────────────────────────────────────
    if (action === "update_settings") {
      const updates: Record<string, unknown> = {};

      if (typeof params.biometric_enabled === "boolean") {
        updates.biometric_enabled = params.biometric_enabled;
      }
      if (typeof params.auto_lock_timeout === "number") {
        const t = params.auto_lock_timeout;
        // 0 = Never; 30–3600 = seconds (30 s … 60 min)
        const valid = t === 0 || (Number.isInteger(t) && t >= 30 && t <= 3600);
        if (!valid) {
          return errorResponse("auto_lock_timeout must be 0 (never) or 30–3600 seconds");
        }
        updates.auto_lock_timeout = t;
      }

      if (Object.keys(updates).length === 0) {
        return errorResponse("No valid settings fields provided");
      }

      await updateProfile(updates);
      return jsonResponse({ success: true });
    }

    return errorResponse(`Unknown action: ${action}`);
  } catch (err) {
    console.error("pin-manager error:", err);
    return jsonResponse({ success: false, error: `Internal error: ${(err as Error).message}` });
  }
});
