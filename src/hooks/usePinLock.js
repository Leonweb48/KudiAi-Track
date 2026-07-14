import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";

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

export function usePinLock(userId, session) {
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

  // Derived state
  const appPinSet  = status?.appPinSet  ?? false;
  const txnPinSet  = status?.txnPinSet  ?? false;
  const biometricEnabled  = status?.biometricEnabled  ?? false;
  // autoLockTimeout is in SECONDS (0 = Never, 30–3600).  Default 300 = 5 min.
  const autoLockTimeout   = status?.autoLockTimeout   ?? 300;
  const biometricAvailable = !!(navigator?.credentials);

  // ── Fetch status from server ───────────────────────────────────────
  const refetch = useCallback(async (retryCount = 0) => {
    if (!userId || !session) return;
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
      setLocked(false);
      if (retryCount < 4) {
        // Network blip — retry up to 4 times before giving up (covers APK edge-function cold starts).
        // Delays: 2s, 4s, 8s, 16s.
        setTimeout(() => refetch(retryCount + 1), 2000 * Math.pow(2, retryCount));
      } else {
        // All retries exhausted — keep status=null so App.jsx PIN gate doesn't fire falsely.
        setLoading(false);
      }
    }
  }, [userId, session]);

  useEffect(() => {
    if (userId && session) {
      refetch();
    }
  }, [userId, session, refetch]);

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
  // On background: pause the inactivity timer.
  // On foreground return: check elapsed time since last activity.
  //   - If elapsed >= timeout → lock now.
  //   - Otherwise → restart timer with the remaining time.
  // This means "1 minute" locks only after 1 minute of total inactivity,
  // regardless of whether the app was backgrounded in the middle.
  useEffect(() => {
    const onBackground = () => {
      clearTimer(); // pause — don't fire while hidden
    };

    const onForeground = () => {
      if (locked || autoLockTimeout === 0) return;
      const elapsed  = Date.now() - lastActivityRef.current;
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
  }, [locked, autoLockTimeout, clearTimer]);

  // ── Methods ────────────────────────────────────────────────────────
  const verifyAppPin = useCallback(async (pin) => {
    const result = await invoke("verify_app_pin", { pin });
    if (result.data?.success) {
      setLocked(false);
      await refetch();
    }
    return result;
  }, [refetch]);

  const verifyTxnPin = useCallback(async (pin) => {
    return invoke("verify_txn_pin", { pin });
  }, []);

  const setupAppPin = useCallback(async (pin) => {
    const result = await invoke("setup_app_pin", { pin });
    await refetch();
    return result;
  }, [refetch]);

  const setupTxnPin = useCallback(async (pin) => {
    const result = await invoke("setup_txn_pin", { pin });
    await refetch();
    return result;
  }, [refetch]);

  const changeAppPin = useCallback(async (currentPin, newPin) => {
    return invoke("change_app_pin", { current_pin: currentPin, new_pin: newPin });
  }, []);

  const changeTxnPin = useCallback(async (currentPin, newPin) => {
    return invoke("change_txn_pin", { current_pin: currentPin, new_pin: newPin });
  }, []);

  const resetAppPin = useCallback(async (newPin) => {
    return invoke("reset_app_pin", { new_pin: newPin });
  }, []);

  const resetTxnPin = useCallback(async (newPin) => {
    return invoke("reset_txn_pin", { new_pin: newPin });
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
