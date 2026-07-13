import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

export const LS_ENABLED  = "kt_lock_enabled";
export const LS_PIN_HASH = "kt_lock_pin_hash";
export const LS_CRED_ID  = "kt_lock_cred_id";
export const LS_PIN_LEN  = "kt_lock_pin_len";

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function bufToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlToBuf(s) {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer;
}

async function checkBioAvailable() {
  try {
    return !!(await window.PublicKeyCredential
      ?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
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

// credId="bio" means the user enabled biometric but WebAuthn registration failed —
// use allowCredentials:[] so the platform shows its own biometric prompt on native.
async function webauthnVerify(credId) {
  const allowCredentials = credId && credId !== "bio"
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

export function useBiometricLock(userId) {
  const [locked,       setLocked]       = useState(false);
  const [enabled,      setEnabled]      = useState(() => localStorage.getItem(LS_ENABLED) === "true");
  const [hasPIN,       setHasPIN]       = useState(() => !!localStorage.getItem(LS_PIN_HASH));
  const [hasBiometric, setHasBiometric] = useState(() => !!localStorage.getItem(LS_CRED_ID));
  const [bioAvailable, setBioAvailable] = useState(false);
  // Default 4 for backward compat with PINs set before this field was stored
  const [pinLen,       setPinLen]       = useState(() => parseInt(localStorage.getItem(LS_PIN_LEN) || "4", 10));

  const wasActiveRef = useRef(true);

  useEffect(() => {
    checkBioAvailable().then(setBioAvailable);
  }, []);

  // Lock when app goes to background and user returns
  useEffect(() => {
    if (!enabled) return;

    if (Capacitor.isNativePlatform()) {
      let removeListener;
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          wasActiveRef.current = false;
        } else if (!wasActiveRef.current) {
          wasActiveRef.current = true;
          setLocked(true);
        }
      }).then(l => { removeListener = l; });
      return () => { removeListener?.remove(); };
    }

    // Web: visibilitychange
    const onVis = () => {
      if (document.hidden) {
        wasActiveRef.current = false;
      } else if (!wasActiveRef.current) {
        wasActiveRef.current = true;
        setLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled]);

  const setupPIN = useCallback(async (pin) => {
    const hash = await sha256(pin);
    localStorage.setItem(LS_PIN_HASH, hash);
    localStorage.setItem(LS_PIN_LEN, String(pin.length));
    setHasPIN(true);
    setPinLen(pin.length);
  }, []);

  // Enable lock + try to register biometric credential.
  // Sets the "bio" placeholder immediately so the UI responds before WebAuthn resolves.
  const enableLock = useCallback(async () => {
    localStorage.setItem(LS_ENABLED, "true");
    setEnabled(true);
    if (bioAvailable) {
      // Show toggle ON immediately — don't wait for WebAuthn
      localStorage.setItem(LS_CRED_ID, "bio");
      setHasBiometric(true);
      try {
        const credId = await webauthnRegister(userId);
        // Real credential registered — replace placeholder
        localStorage.setItem(LS_CRED_ID, credId);
      } catch {
        // Keep "bio" placeholder; webauthnVerify will use allowCredentials:[] at unlock time
      }
    }
  }, [bioAvailable, userId]);

  const disableLock = useCallback(() => {
    localStorage.removeItem(LS_ENABLED);
    localStorage.removeItem(LS_CRED_ID);
    setEnabled(false);
    setHasBiometric(false);
    setLocked(false);
  }, []);

  const disableBiometric = useCallback(() => {
    localStorage.removeItem(LS_CRED_ID);
    setHasBiometric(false);
  }, []);

  const clearAll = useCallback(() => {
    [LS_ENABLED, LS_PIN_HASH, LS_CRED_ID, LS_PIN_LEN].forEach(k => localStorage.removeItem(k));
    setEnabled(false);
    setHasPIN(false);
    setHasBiometric(false);
    setPinLen(4);
    setLocked(false);
  }, []);

  const unlockWithPIN = useCallback(async (pin) => {
    const entered = await sha256(pin);
    const stored  = localStorage.getItem(LS_PIN_HASH);
    if (entered === stored) { setLocked(false); return true; }
    return false;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    const credId = localStorage.getItem(LS_CRED_ID);
    try {
      await webauthnVerify(credId);
      setLocked(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    locked,
    enabled,
    hasPIN,
    hasBiometric,
    bioAvailable,
    pinLen,
    setupPIN,
    enableLock,
    disableLock,
    disableBiometric,
    clearAll,
    unlockWithPIN,
    unlockWithBiometric,
  };
}
