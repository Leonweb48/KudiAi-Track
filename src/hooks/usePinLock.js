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
  const [locked,  setLocked]  = useState(true);
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState(null);

  const inactivityTimer = useRef(null);

  // Derived state
  const appPinSet  = status?.appPinSet  ?? false;
  const txnPinSet  = status?.txnPinSet  ?? false;
  const biometricEnabled  = status?.biometricEnabled  ?? false;
  const autoLockTimeout   = status?.autoLockTimeout   ?? 5;
  const biometricAvailable = !!(navigator?.credentials);

  const needsDeviceVerification =
    !locked && txnPinSet && !localStorage.getItem("kt_device_txn_verified_" + userId);

  // ── Fetch status from server ───────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!userId || !session) return;
    setLoading(true);
    try {
      const { data } = await invoke("check_status");
      setStatus(data);
      if (!data?.appPinSet) {
        setLocked(false); // No PIN set yet — show setup, not lock screen
      }
    } catch {
      // If fetch fails, default to no pin set (don't block user)
      setLocked(false);
    } finally {
      setLoading(false);
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
    clearTimer();
    inactivityTimer.current = setTimeout(() => {
      setLocked(true);
    }, autoLockTimeout * 60 * 1000);
  }, [locked, autoLockTimeout, clearTimer]);

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
  useEffect(() => {
    // Capacitor
    let removeCapacitor;
    import("@capacitor/app")
      .then(({ App: CapApp }) => {
        CapApp.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) setLocked(true);
        }).then(l => { removeCapacitor = l; });
      })
      .catch(() => {});

    // Web
    const onVis = () => {
      if (document.hidden) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      removeCapacitor?.remove?.();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

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
    const result = await invoke("update_settings", obj);
    await refetch();
    return result;
  }, [refetch]);

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

  const completeDeviceVerification = useCallback(() => {
    if (!userId) return;
    localStorage.setItem("kt_device_txn_verified_" + userId, "1");
  }, [userId]);

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
    needsDeviceVerification,
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
    completeDeviceVerification,
    lock,
    unlock,
    refetch,
  };
}
