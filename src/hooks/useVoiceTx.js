import { useState, useRef } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

const SpeechToText = registerPlugin("SpeechToText");

const LANG_CODES = { en: "en-NG", ha: "ha", ig: "ig", yo: "yo" };

/* ── Local transaction parser ───────────────────────────────────────────────
   Runs in the browser — no API key needed. Uses keyword matching + regex.
   ──────────────────────────────────────────────────────────────────────── */
function parseTransactionLocally(transcript) {
  const raw  = transcript || "";
  const text = raw.toLowerCase();

  /* ── Type: in (sale) vs out (expense) ── */
  const OUT_WORDS = [
    "bought","buy","purchase","paid","spend","spent","expense","cost",
    // Hausa
    "sayo","sayi","saye","karo",
    // Igbo
    "zụọ","zụta","zuo","zuta","achọ",
    // Yoruba
    " ra ","rà","rá","lo ra",
  ];
  const IN_WORDS = [
    "sold","sell","received","income","sale","collected","got paid",
    // Hausa
    "sayar","sayarwa","karba",
    // Igbo
    "ree","resụ","resaa","zere","rite",
    // Yoruba
    " ta ","tà","tá","ta ni","mo ta","ntaa",
  ];

  let type = "in";
  for (const w of OUT_WORDS) { if (text.includes(w)) { type = "out"; break; } }
  // In-words override out-words (more specific)
  for (const w of IN_WORDS)  { if (text.includes(w)) { type = "in";  break; } }

  /* ── Amount ── */
  let amount = 0;
  // Try patterns in order of reliability
  const amountPatterns = [
    // ₦4500 or #4500
    /[₦#]\s*([\d,]+(?:\.\d+)?)\s*k?\b/i,
    // 4.5k or 5k or 10k
    /\b([\d,]+(?:\.\d+)?)\s*k\b/i,
    // naira 4500 or 4500 naira
    /(?:naira|ngn)\s+([\d,]+)/i,
    /([\d,]+)\s+(?:naira|ngn)/i,
    // plain number with 3+ digits (prices)
    /\b([\d,]{3,})\b/,
    // any number
    /\b(\d+)\b/,
  ];
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      const numStr = m[1].replace(/,/g, "");
      let   val    = parseFloat(numStr);
      // Handle "k" suffix: "5k" → 5000
      if (/\b[\d.]+\s*k\b/i.test(m[0])) val *= 1000;
      if (val > 0) { amount = val; break; }
    }
  }

  /* ── Quantity ── */
  let quantity = 1;
  const qtyMatch = text.match(/(\d+)\s*(yard|piece|bag|unit|roll|dozen|pack|plate|cup|bottle|wrap|pair|carton|box)/i);
  if (qtyMatch) quantity = parseInt(qtyMatch[1]);

  /* ── Item name — strip filler words, keep the noun ── */
  let item = raw;

  // Remove leading subject + verb phrases (English + Hausa + Igbo + Yoruba)
  item = item.replace(/^(i |na |mo |m |a |an |e )?(sold|bought|sell|buy|purchase[d]?|sayar da|sayarwa|sayo|sayi|ta |taa |ree |resụ |zụọ |zụta )/gi, "");
  // Remove Hausa connector "da"
  item = item.replace(/^da\s+/gi, "");
  // Remove amount and everything after
  item = item.replace(/\s*(for|at|worth|naira|₦|#|ngn)\s*[\d,k.]+.*/gi, "");
  item = item.replace(/\s*[\d,k.]+\s*(naira|₦|#|ngn).*/gi, "");
  item = item.replace(/\s*[₦#][\d,k.]+.*/gi, "");
  // Remove payment words at the end
  item = item.replace(/\s*(by\s+)?(cash|transfer|pos|card|mobile money|opay|palmpay|kuda|momo)\b.*/gi, "");
  // Remove quantity phrases
  item = item.replace(/\s*\d+\s*(yard|piece|bag|unit|roll|dozen|pack|plate|cup|bottle|wrap|pair|carton|box)s?\b/gi, "");
  item = item.trim();

  if (!item || item.length < 2) item = "Transaction";

  // Capitalise first letter of each word (title case)
  item = item.replace(/\b\w/g, c => c.toUpperCase());

  /* ── Payment type ── */
  let payment_type = "cash";
  if (/transfer|bank|trf|wire/i.test(text))              payment_type = "transfer";
  else if (/pos|card|machine|atm/i.test(text))           payment_type = "pos";
  else if (/mobile money|opay|palmpay|kuda|momo|wallet/i.test(text)) payment_type = "mobile money";

  /* ── Category ── */
  let category = type === "in" ? "sale" : "expense";
  if (/stock|restock|inventory|supply|supplies/i.test(text)) category = "stock";
  else if (/credit|owe|owing|debt sale/i.test(text))         category = "credit sale";
  else if (/repay|payback|pay back|debt repay/i.test(text))  category = "debt repayment";

  /* ── Customer name — look for "for [Name]" or "from [Name]" or "to [Name]" ── */
  let customer_name = "";
  const custMatch = raw.match(/(?:for|from|to|customer)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  if (custMatch) customer_name = custMatch[1];

  return { type, amount, item_name: item, category, payment_type, customer_name, quantity, note: "" };
}

// status: idle | recording | parsing | done | error
export function useVoiceTx() {
  const [isRecording, setIsRecording] = useState(false);
  const [status,      setStatus]      = useState("idle");
  const [transcript,  setTranscript]  = useState("");
  const [interim,     setInterim]     = useState("");
  const [parsed,      setParsed]      = useState(null);
  const [error,       setError]       = useState(null);
  const [lang,        setLang]        = useState("en");

  const recognitionRef = useRef(null);
  const finalRef       = useRef("");

  const startRecording = async () => {
    setStatus("recording");
    setTranscript("");
    setInterim("");
    setParsed(null);
    setError(null);
    finalRef.current = "";

    // ── Native path: use the custom SpeechToText Capacitor plugin ────────
    // This fires Android's built-in speech recognizer dialog directly,
    // bypassing all WebView permission layers that cause "not-allowed" errors.
    if (Capacitor.isNativePlatform()) {
      setIsRecording(true);
      try {
        const result = await SpeechToText.start({
          language: LANG_CODES[lang] || "en-US",
        });
        const text = (result.transcript || "").trim();
        setIsRecording(false);
        if (!text) {
          setError("No speech detected. Please try again and speak clearly.");
          setStatus("error");
          return;
        }
        setTranscript(text);
        setStatus("parsing");
        const txn = parseTransactionLocally(text);
        setParsed(txn);
        setStatus("done");
      } catch (err) {
        setIsRecording(false);
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("cancel") || msg === "cancelled") {
          setStatus("idle");
        } else {
          setError("Could not capture speech. Please try again.");
          setStatus("error");
        }
      }
      return;
    }

    // ── Web path: Web Speech API (Chrome desktop / PWA) ──────────────────
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice input requires Chrome browser.");
      setStatus("error");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang            = LANG_CODES[lang] || "en-NG";
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interimText = "";
      for (const result of e.results) {
        if (result.isFinal) finalRef.current += result[0].transcript + " ";
        else                interimText       += result[0].transcript;
      }
      setTranscript(finalRef.current.trim());
      setInterim(interimText);
    };

    rec.onerror = (e) => {
      // Content filtering / network blips — restart silently instead of failing
      const retriable = ["network", "audio-capture", "service-not-allowed", "bad-grammar"];
      const isFiltered = typeof e.error === "string" &&
        (retriable.includes(e.error) || e.error.toLowerCase().includes("filter") || e.error.toLowerCase().includes("block"));

      if (isFiltered) {
        // Restart recognition transparently
        try { recognitionRef.current?.stop(); } catch {}
        setTimeout(() => {
          try {
            const r2 = new SpeechRecognition();
            r2.lang           = rec.lang;
            r2.continuous     = true;
            r2.interimResults = true;
            r2.onresult = rec.onresult;
            r2.onerror  = rec.onerror;
            r2.onend    = rec.onend;
            recognitionRef.current = r2;
            r2.start();
          } catch { /* give up silently */ }
        }, 300);
        return;
      }

      setIsRecording(false);
      setInterim("");
      if (e.error === "no-speech") {
        setError("No speech detected. Please try again and speak clearly.");
      } else if (e.error === "not-allowed") {
        setError("Microphone blocked. Please allow microphone access in your browser settings and reload.");
      } else {
        setError("Could not capture speech. Please try again.");
      }
      setStatus("error");
    };

    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  };

  const stopAndProcess = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    setInterim("");

    const text = (finalRef.current || transcript).trim();
    if (!text) {
      setError("No speech captured. Please try again and speak clearly.");
      setStatus("error");
      return;
    }

    setTranscript(text);
    setStatus("parsing");

    // Parse locally — instant, no API
    try {
      const txn = parseTransactionLocally(text);
      setParsed(txn);
      setStatus("done");
    } catch (e) {
      setError("Could not parse transaction. Please try again.");
      setStatus("error");
    }
  };

  const reset = () => {
    recognitionRef.current?.abort();
    finalRef.current = "";
    setStatus("idle");
    setTranscript("");
    setInterim("");
    setParsed(null);
    setError(null);
    setIsRecording(false);
  };

  return {
    isRecording, status, transcript, interim, parsed, error,
    lang, setLang, startRecording, stopAndProcess, reset,
  };
}
