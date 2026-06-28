import { useState, useRef } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const VOICE_PARSE_URL  = "https://admin.kudiai.app/api/public/voice-parse";
const TRIGGER_SECRET   = process.env.REACT_APP_EMAIL_SECRET;
const MAX_RECORD_SECS  = 60;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendToGemini(audioBlob, mimeType) {
  const base64 = await blobToBase64(audioBlob);
  const payload = { audio_base64: base64, mime_type: mimeType || "audio/webm" };
  const voiceHeaders = {
    "Content-Type":     "application/json",
    "x-trigger-secret": TRIGGER_SECRET || "",
  };

  let data;
  if (Capacitor.isNativePlatform()) {
    // CapacitorHttp bypasses WebView CORS and has no 10s default timeout
    const r = await CapacitorHttp.post({
      url:         VOICE_PARSE_URL,
      headers:     voiceHeaders,
      data:        JSON.stringify(payload),
      readTimeout: 120000,
    });
    if (!r.status || r.status < 200 || r.status >= 300) {
      throw new Error(r.data?.error || `Server error ${r.status}`);
    }
    data = r.data;
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(VOICE_PARSE_URL, {
        method:  "POST",
        signal:  controller.signal,
        headers: voiceHeaders,
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const isIn  = data.transaction_type === "Cash In";
  return {
    type:          isIn ? "in" : "out",
    amount:        Number(data.amount) || 0,
    item_name:     String(data.description || "Transaction").trim(),
    category:      isIn ? "sale" : "expense",
    payment_type:  "cash",
    customer_name: "",
    quantity:      1,
    note:          "",
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
// status: idle | recording | parsing | done | error
export function useVoiceTx() {
  const [isRecording,      setIsRecording]      = useState(false);
  const [status,           setStatus]           = useState("idle");
  const [parsed,           setParsed]           = useState(null);
  const [error,            setError]            = useState(null);
  const [lang,             setLang]             = useState("en");
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const mimeTypeRef      = useRef("");
  const streamRef        = useRef(null);
  const timerRef         = useRef(null);
  const cancelledRef     = useRef(false);

  // Stops MediaRecorder + timer without triggering Gemini (used by reset)
  const _stopStream = () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const _stopRecorder = () => {
    clearInterval(timerRef.current);
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    else _stopStream();
  };

  const startRecording = async () => {
    cancelledRef.current = false;
    setStatus("recording");
    setParsed(null);
    setError(null);
    setRecordingSeconds(0);
    chunksRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Your browser does not support audio recording.");
      setStatus("error");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied. Please allow microphone access and try again.");
      setStatus("error");
      return;
    }
    streamRef.current = stream;

    const mimeType = getSupportedMimeType();

    let mr;
    try {
      mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setError("Could not start audio recording on this device.");
      setStatus("error");
      return;
    }
    // Use the actual MIME type the recorder chose (important on Android WebView
    // where MediaRecorder.isTypeSupported returns false for all listed types
    // but the recorder still picks a valid default like audio/mp4).
    mimeTypeRef.current = mr.mimeType || mimeType || "audio/webm";
    mediaRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data?.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      _stopStream();
      setIsRecording(false);

      if (cancelledRef.current) {
        cancelledRef.current = false;
        return;
      }

      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "audio/webm" });
      if (blob.size < 500) {
        setError("Recording too short. Please speak clearly and try again.");
        setStatus("error");
        return;
      }

      setStatus("parsing");
      try {
        const txn = await sendToGemini(blob, mimeTypeRef.current || "audio/webm");
        setParsed(txn);
        setStatus("done");
      } catch (e) {
        setError(e.message || "Could not analyze audio. Please check your connection and try again.");
        setStatus("error");
      }
    };

    mr.start(250);
    setIsRecording(true);

    // Tick every second; auto-stop at MAX_RECORD_SECS
    let secs = 0;
    timerRef.current = setInterval(() => {
      secs++;
      setRecordingSeconds(secs);
      if (secs >= MAX_RECORD_SECS) _stopRecorder();
    }, 1000);
  };

  const stopAndProcess = () => {
    _stopRecorder();
  };

  const reset = () => {
    cancelledRef.current   = true;
    _stopRecorder();
    mediaRecorderRef.current = null;
    streamRef.current        = null;
    chunksRef.current        = [];
    setStatus("idle");
    setIsRecording(false);
    setParsed(null);
    setError(null);
    setRecordingSeconds(0);
  };

  return {
    isRecording, status, parsed, error,
    lang, setLang, startRecording, stopAndProcess, reset,
    recordingSeconds,
  };
}
