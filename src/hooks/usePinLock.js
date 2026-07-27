import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { setLocalPinHash, verifyLocalPin } from "../utils/pinHash";

// Base64url helpers for WebAuthn
function bufToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlToBuf(s) {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer;
}

async function webauthnRegister(userId) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "KudiAI Track", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId || "kt_user"),
        name: "kuditrack",
        displayName: "KudiAI Track",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        requireResidentKey: false,
      },
      timeout: 60000,
    },
  });
  return bufToB64url(cred.rawId);
}

async function webauthnVerify(credId) {
  const allowCredentials = credId
    ? [{ type: "public-key", id: b64urlToBuf(credId), transports: ["internal"] }]
    : [];
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials,
      userVerification: "required",
      timeout: 60000,
    },
  });
}

async function invoke(action, params = {}) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.functions.invoke("pin-manager", {
    body: { action, ...params },
  });
  // Network/deployment-level error (function unreachable, CORS, etc.)
  if (error) throw new Error(error.message);
  // Application-level error — edge function always returns 200; errors are in the body
  if (data?.error) throw new Error(data.error);
  return { data };
}

export function usePinLock(userId) {
  const [locked, setLocked] = useState(() => {
    // If the user previously set "Never", start unlocked to avoid lock-screen flash on app open.
    // The server value is confirmed by refetch() — this is only a hint for the initial render.
    if (userId) {
      try {
        const cached = localStorage.getItem(`kt_lock_timeout_${userId}`);
        if (cached !== null && parseInt(cached, 10) === 0) return false;
      } catch {}
    }
    return true;
  });
  const [loading,        setLoading]        = useState(true);
  const [status,         setStatus]         = useState(null);

  const inactivityTimer   = useRef(null);
  const capListenerRef    = useRef(null);
  const lastActivityRef   = useRef(Date.now()); // ms timestamp of last user activity
  const backgroundedAtRef = useRef(null);       // ms timestamp when app was backgrounded

  // Derived state
  const appPinSet  = status?.appPinSet  ?? false;
  const txnPinSet  = status?.txnPinSet  ?? false;
  const biometricEnabled  = status?.biometricEnabled  ?? false;
  // autoLockTimeout is in SECONDS (0 = Never, 30–3600).  Default 300 = 5 min.
  const autoLockTimeout   = status?.autoLockTimeout   ?? 300;
  const biometricAvailable = !!(navigator?.credentials);

  // ── Fetch status from server ───────────────────────────────────────
  const refetch = useCallback(async (retryCount = 0) => {
    if (!userId) return;
    if (retryCount === 0) setLoading(true);
    try {
      const { data } = await invoke("check_status");
      setStatus(data);
      // Cache the timeout so the next cold-start can initialize locked state correctly
      try {
        if (userId) localStorage.setItem(`kt_lock_timeout_${userId}`, String(data?.autoLockTimeout ?? 300));
      } catch {}
      if (!data?.appPinSet) {
        setLocked(false); // No PIN set yet — show setup, not lock screen
      } else if (data?.autoLockTimeout === 0) {
        // "Never": only lock for new-device reauth, never for inactivity
        setLocked(!!data?.requiresReauth);
      }
      setLoading(false);
    } catch {
      // Do NOT set locked=false here — fail CLOSED on every attempt.
      // Only resolve the locked state after all retries are exhausted so we never
      // flash the portal open while a retry is in flight.
      if (retryCount < 4) {
        setTimeout(() => refetch(retryCount + 1), 2000 * Math.pow(2, retryCount));
      } else {
        // All retries exhausted. Determine locked state from local evidence.
        if (userId) {
          try {
            const localHash = localStorage.getItem(`kt_pin_h_${userId}`);
            if (localHash) {
              // Local hash stored → a PIN was set. Stay locked so LockScreen can do
              // offline PBKDF2 verification. status stays null so the PIN-setup gate
              // in App.jsx (which needs status!==null) is also skipped — user goes
              // straight to LockScreen.
              setLoading(false);
              return;
            }
          } catch {}
        }
        // No local hash → PIN was never set (or hash cleared). Unlock without server.
        setLocked(false);
        setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      refetch();
    }
  }, [userId, refetch]);

  // ── Inactivity timer ───────────────────────────────────────────────
  const clearTimer = useCallback(() => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    if (locked) return;
    if (autoLockTimeout === 0) { clearTimer(); return; } // Never — clear any pending timer
    lastActivityRef.current = Date.now();
    clearTimer();
    inactivityTimer.current = setTimeout(
      () => setLocked(true),
      autoLockTimeout * 1000, // autoLockTimeout is in seconds
    );
  }, [locked, autoLockTimeout, clearTimer]);

  // Immediately clear any running timer the moment "Never" becomes active
  useEffect(() => {
    if (autoLockTimeout === 0) clearTimer();
  }, [autoLockTimeout, clearTimer]);

  // Start/reset timer on user activity
  useEffect(() => {
    if (locked) {
      clearTimer();
      return;
    }
    resetTimer();
    const events = ["touchstart", "mousedown", "keydown"];
    const handler = () => resetTimer();
    events.forEach(e => document.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach(e => document.removeEventListener(e, handler));
      clearTimer();
    };
  }, [locked, resetTimer, clearTimer]);

  // ── App background / visibility ────────────────────────────────────
  // On background: record the timestamp and pause the inactivity timer.
  // On foreground return: lock only if the app was backgrounded for >= autoLockTimeout.
  //   - Brief backgrounds (camera, CCT browser, home tap) do NOT lock.
  //   - Only a sustained background longer than the timeout causes a lock.
  // On native, both appStateChange and visibilitychange fire — backgroundedAtRef
  // acts as a one-shot flag so only the first onForeground call acts.
  useEffect(() => {
    const onBackground = () => {
      backgroundedAtRef.current = Date.now();
      clearTimer();
    };

    const onForeground = () => {
      if (locked || autoLockTimeout === 0) return;
      const bgAt = backgroundedAtRef.current;
      if (bgAt === null) return; // duplicate fire (native fires both appStateChange + visibilitychange)
      backgroundedAtRef.current = null;

      // Returning from an intentional CCT payment browser — the user was actively paying,
      // not idle. Skip the elapsed-lock check and restart the inactivity timer from zero
      // so a long 3DS / OTP flow doesn't surprise them with a lock screen on return.
      try {
        if (sessionStorage.getItem("ck_cct_payment_active") === "1") {
          sessionStorage.removeItem("ck_cct_payment_active");
          resetTimer();
          return;
        }
      } catch {}

      const elapsed   = Date.now() - bgAt;
      const timeoutMs = autoLockTimeout * 1000;
      if (elapsed >= timeoutMs) {
        setLocked(true);
      } else {
        clearTimer();
        inactivityTimer.current = setTimeout(() => setLocked(true), timeoutMs - elapsed);
      }
    };

    // Capacitor — store handle in a ref so cleanup is always synchronous
    import("@capacitor/app")
      .then(({ App: CapApp }) => {
        capListenerRef.current?.remove?.();
        capListenerRef.current = null;
        CapApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onForeground(); else onBackground();
        }).then(l => { capListenerRef.current = l; });
      })
      .catch(() => {});

    // Web
    const onVis = () => {
      if (document.hidden) onBackground(); else onForeground();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      capListenerRef.current?.remove?.();
      capListenerRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [locked, autoLockTimeout, clearTimer, resetTimer]);

  // ── Methods ────────────────────────────────────────────────────────
  const verifyAppPin = useCallback(async (pin) => {
    if (!navigator.onLine && userId) {
      const local = await verifyLocalPin(userId, pin);
      if (local.noLocalPin) return { data: { noLocalPin: true } };
      if (local.success)    { setLocked(false); return { data: { success: true } }; }
      return { data: local }; // { locked, lockedUntil } or { success: false, attemptsLeft }
    }
    const result = await invoke("verify_app_pin", { pin });
    if (result.data?.success) {
      setLocked(false);
      // Cache hash so offline unlock works after a successful online verify.
      if (userId) setLocalPinHash(userId, pin).catch(() => {});
    }
    return result;
  }, [userId]);

  const verifyTxnPin = useCallback(async (pin) => {
    return invoke("verify_txn_pin", { pin });
  }, []);

  const setupAppPin = useCallback(async (pin) => {
    const result = await invoke("setup_app_pin", { pin });
    if (result.data?.success && userId) setLocalPinHash(userId, pin).catch(() => {});
    await refetch();
    return result;
  }, [refetch, userId]);

  const setupTxnPin = useCallback(async (pin) => {
    const result = await invoke("setup_txn_pin", { pin });
    await refetch();
    return result;
  }, [refetch]);

  const changeAppPin = useCallback(async (currentPin, newPin) => {
    const result = await invoke("change_app_pin", { current_pin: currentPin, new_pin: newPin });
    if (result.data?.success && userId) setLocalPinHash(userId, newPin).catch(() => {});
    return result;
  }, [userId]);

  const changeTxnPin = useCallback(async (currentPin, newPin) => {
    return invoke("change_txn_pin", { current_pin: currentPin, new_pin: newPin });
  }, []);

  const authorizeReset = useCallback(async () => {
    return invoke("authorize_pin_reset");
  }, []);

  const resetAppPin = useCallback(async (newPin, resetToken) => {
    const result = await invoke("reset_app_pin", { new_pin: newPin, reset_token: resetToken });
    if (result.data?.success && userId) setLocalPinHash(userId, newPin).catch(() => {});
    return result;
  }, [userId]);

  const resetTxnPin = useCallback(async (newPin, resetToken) => {
    return invoke("reset_txn_pin", { new_pin: newPin, reset_token: resetToken });
  }, []);

  const updateSettings = useCallback(async (obj) => {
    const snake = {};
    // Allow 0 (Never) as a valid autoLockTimeout
    if (typeof obj.autoLockTimeout === "number") snake.auto_lock_timeout = obj.autoLockTimeout;
    if (typeof obj.biometricEnabled === "boolean") snake.biometric_enabled = obj.biometricEnabled;
    const result = await invoke("update_settings", snake);
    // Update cache immediately so the next cold-start reflects the new setting
    if (typeof obj.autoLockTimeout === "number" && userId) {
      try { localStorage.setItem(`kt_lock_timeout_${userId}`, String(obj.autoLockTimeout)); } catch {}
    }
    await refetch();
    return result;
  }, [refetch, userId]);

  const registerBiometric = useCallback(async () => {
    if (!userId) return false;
    try {
      const credId = await webauthnRegister(userId);
      localStorage.setItem("kt_biometric_cred_" + userId, credId);
      await updateSettings({ biometricEnabled: true });
      return true;
    } catch {
      return false;
    }
  }, [userId, updateSettings]);

  const unlockWithBiometric = useCallback(async () => {
    if (!userId) return false;
    const credId = localStorage.getItem("kt_biometric_cred_" + userId);
    try {
      await webauthnVerify(credId);
      setLocked(false);
      return true;
    } catch {
      return false;
    }
  }, [userId]);

  const disableBiometric = useCallback(async () => {
    if (!userId) return;
    localStorage.removeItem("kt_biometric_cred_" + userId);
    await updateSettings({ biometricEnabled: false });
  }, [userId, updateSettings]);

  const lock   = useCallback(() => setLocked(true),  []);
  const unlock = useCallback(() => setLocked(false), []);

  return {
    // State
    appPinSet,
    txnPinSet,
    locked,
    loading,
    status,
    biometricAvailable,
    biometricEnabled,
    autoLockTimeout,
    // Methods
    verifyAppPin,
    verifyTxnPin,
    setupAppPin,
    setupTxnPin,
    changeAppPin,
    changeTxnPin,
    authorizeReset,
    resetAppPin,
    resetTxnPin,
    updateSettings,
    registerBiometric,
    unlockWithBiometric,
    disableBiometric,
    lock,
    unlock,
    refetch,
  };
}
