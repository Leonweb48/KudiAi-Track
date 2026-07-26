import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { friendlyError, moneyError } from "../utils/errorMessages";
import { openPaystackPopup } from "../utils/paystackCheckout";
import { supabase } from "../utils/supabase";
import BillPayments from "./BillPayments";
import CashbackCard from "../components/CashbackCard";
import { fmt, fmtDate, fmtDateTime, ledgerTypeLabel } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { useCampaigns } from "../hooks/useCampaigns";
import { usePartnerOffers } from "../hooks/usePartnerOffers";
import { usePushNotifications } from "../hooks/usePushNotifications";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import OffersSection from "../components/slots/OffersSection";
import PoweredByCardSlot from "../components/slots/PoweredByCardSlot";
import TabCardQuadSlot from "../components/slots/TabCardQuadSlot";
import TabCardDuoSlot from "../components/slots/TabCardDuoSlot";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildAjoContributionReceipt, buildAjoWithdrawalReceipt } from "../utils/receiptConfig";
import AIChatWidget from "../components/AIChatWidget";
import { buildAjoMemberContext } from "../utils/buildContext";
import AppLogo from "../components/AppLogo";
import { useT, useLanguage } from "../contexts/LanguageContext";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
import { allocatePeriods } from "../utils/allocatePeriods.mjs";
import NotificationCenter from "../components/NotificationCenter";
import { useToast } from "../components/Toast";
import ContributionCard from "../components/ContributionCard";
import EsusuRotationDashboard from "../components/EsusuRotationDashboard";
import LegalScreen from "./LegalScreen";

async function ajoFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("ajo-portal", {
    body: { action, ...body },
  });
  if (error) {
    let msg = error.message || "Portal request failed";
    try {
      const errBody = await error.context?.json?.();
      if (errBody?.error) msg = errBody.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Constants ─────────────────────────────────────────────────────────────
const ADMIN_URL = "https://admin.kudiai.app";
const YEAR      = new Date().getFullYear();

function makeTicketTypes(t) {
  return [
    { value: "account",     label: t("ticket.account")     },
    { value: "transaction", label: t("ticket.transaction") },
    { value: "technical",   label: t("ticket.technical")   },
    { value: "savings",     label: t("ticket.savings")     },
    { value: "general",     label: t("ticket.general")     },
  ];
}

function makeNav(t) {
  return [
    { id: "home",    icon: "home",  label: t("nav.home")     },
    { id: "bills",   icon: "bills", label: t("nav.bills")    },
    { id: "history", icon: "txn",   label: t("nav.history")  },
    { id: "me",      icon: "user",  label: t("settings.title") },
  ];
}

function greetingText(t) {
  const h = new Date().getHours();
  return h < 12 ? t("greet.morning") : h < 17 ? t("greet.afternoon") : t("greet.evening");
}
function fmtLocaleDate(lang) {
  const locale = lang === "ha" ? "ha" : lang === "yo" ? "yo" : lang === "ig" ? "ig" : "en-NG";
  return new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function uploadAjoAvatar(file, clientId) {
  const ext = file.name.split(".").pop() || "jpg";
  // Convert to base64 and upload via edge function (service role bypasses storage RLS)
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const { data, error } = await supabase.functions.invoke("ajo-portal", {
    body: { action: "upload-avatar", client_id: clientId, ext, base64, mime: file.type },
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  if (data?.error) throw new Error(`Photo upload failed: ${data.error}`);
  if (!data?.url) throw new Error("Photo upload failed: no URL returned");
  return data.url;
}

async function compressImage(file, maxKB = 250) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      // Scale down if large — proof screenshots don't need more than 1200px wide
      if (width > 1200) { height = Math.round(height * 1200 / width); width = 1200; }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      // Try quality levels until under maxKB
      let quality = 0.75;
      const tryCompress = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxKB * 1024 || quality <= 0.3) {
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          } else {
            quality -= 0.1;
            tryCompress();
          }
        }, "image/jpeg", quality);
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadAjoProof(file, clientId) {
  const compressed = await compressImage(file, 250);
  const ext  = "jpg";
  const path = `${clientId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("ajo-proofs").upload(path, compressed, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  // Always use the direct Supabase URL — the proxy alias (kudiai.app/sb) baked into
  // getPublicUrl breaks link opening in PWA/browser contexts.
  return `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/ajo-proofs/${path}`;
}

// ── Micro-components ──────────────────────────────────────────────────────
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const AUTO_LOCK_OPTIONS = [
  { label: "30 seconds",  secs: 30   },
  { label: "1 minute",    secs: 60   },
  { label: "5 minutes",   secs: 300  },
  { label: "15 minutes",  secs: 900  },
  { label: "30 minutes",  secs: 1800 },
  { label: "Never",       secs: 0    },
];

const P = {
  in:     "M12 19V5|M5 12l7-7 7 7",
  out:    "M12 5v14|M19 12l-7 7-7-7",
  lock:   "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  back:   "M19 12H5|M12 19l-7-7 7-7",
  cam:    "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M12 17a4 4 0 100-8 4 4 0 000 8",
  pen:    "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7|M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  check:  "M20 6L9 17l-5-5",
  sun:    "M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 100 14A7 7 0 0012 5z",
  moon:   "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  out2:   "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9",
  faq:    "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z|M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
  person: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
  finger: "M12 10a2 2 0 00-2 2v4a2 2 0 004 0v-4a2 2 0 00-2-2z|M12 4a8 8 0 018 8|M4 12a8 8 0 018-8",
  alert:  "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01",
  help:   "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
  doc:    "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
};

function SectionLabel({ children }) {
  return <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">{children}</p>;
}

function SettingsCard({ children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700/80 mb-5">
      {children}
    </div>
  );
}

function Row({ icon, label, sub, onClick, right, iconCls }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-[14px] text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls || "bg-slate-100 dark:bg-slate-700"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] leading-snug text-slate-800 dark:text-slate-100">{label}</p>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right !== undefined ? right : (
        <Svg d="M9 18l6-6-6-6" size={16} color="#cbd5e1" />
      )}
    </button>
  );
}

function RowIcon({ d, color = "#64748b" }) {
  return <Svg d={d} size={20} color={color} />;
}

// ── Skeleton primitives ────────────────────────────────────────────────────
const Sk = ({ w = "w-full", h = "h-4", r = "rounded-xl", className = "" }) => (
  <div className={`${w} ${h} ${r} bg-slate-200 dark:bg-slate-700 animate-pulse ${className}`} />
);

function SkeletonHome() {
  return (
    <div className="px-4 pt-5 pb-36 space-y-4">
      {/* Greeting — 3 lines: text-sm label / text-2xl name / text-[11px] date ≈ 60px */}
      <div className="space-y-[5px]">
        <Sk w="w-24" h="h-[14px]" r="rounded-full" />
        <Sk w="w-44" h="h-[24px]" r="rounded-lg" />
        <Sk w="w-36" h="h-[11px]" r="rounded-full" />
      </div>
      {/* Insight pill */}
      <Sk h="h-11" r="rounded-2xl" />
      {/* Hero card — matches rounded-3xl py-5 card */}
      <Sk h="h-[200px]" r="rounded-3xl" />
      {/* Status line */}
      <Sk w="w-52" h="h-3" r="rounded-full" />
      {/* Quick actions — p-4 card with header + 2×2 button grid */}
      <Sk h="h-[220px]" r="rounded-2xl" />
      {/* Cashback + services */}
      <Sk h="h-16" r="rounded-2xl" />
      <Sk h="h-[140px]" r="rounded-2xl" />
    </div>
  );
}

function SkeletonHistory() {
  return (
    <div className="px-4 pt-5 pb-36 space-y-4">
      {/* Filter pill row */}
      <div className="flex gap-2">
        {[80, 96, 76].map(w => (
          <div key={w} className="animate-pulse h-8 rounded-full bg-slate-200 dark:bg-slate-700" style={{ width: w }} />
        ))}
      </div>
      {/* Transaction rows */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-3">
            <Sk w="w-10" h="h-10" r="rounded-xl" className="flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Sk w="w-32" h="h-3" r="rounded-full" />
              <Sk w="w-20" h="h-2.5" r="rounded-full" />
            </div>
            <Sk w="w-16" h="h-3" r="rounded-full" className="flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonBills() {
  return (
    <div className="px-4 pt-5 pb-36 space-y-4">
      {/* Category grid */}
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Sk w="w-14" h="h-14" r="rounded-2xl" />
            <Sk w="w-10" h="h-2.5" r="rounded-full" />
          </div>
        ))}
      </div>
      {/* Second row */}
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Sk w="w-14" h="h-14" r="rounded-2xl" />
            <Sk w="w-10" h="h-2.5" r="rounded-full" />
          </div>
        ))}
      </div>
      {/* Feature tiles */}
      <Sk h="h-24" r="rounded-2xl" />
      <Sk h="h-24" r="rounded-2xl" />
      {/* Recent bill rows */}
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3">
            <Sk w="w-10" h="h-10" r="rounded-xl" className="flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Sk w="w-28" h="h-3" r="rounded-full" />
              <Sk w="w-16" h="h-2.5" r="rounded-full" />
            </div>
            <Sk w="w-14" h="h-3" r="rounded-full" className="flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PIN setup modal ────────────────────────────────────────────────────────
function PinSetupModal({ onDone, onClose }) {
  const [step,  setStep]  = useState(1);
  const [pin1,  setPin1]  = useState("");
  const [pin2,  setPin2]  = useState("");
  const [error, setError] = useState("");

  const active    = step === 1 ? pin1 : pin2;
  const setActive = step === 1 ? setPin1 : setPin2;

  const handleDigit = (d) => {
    if (active.length >= 6) return;
    const next = active + d;
    setActive(next);
    setError("");
    if (next.length === 6) {
      if (step === 1) {
        setTimeout(() => setStep(2), 250);
      } else {
        if (pin1 === next) { onDone(pin1); }
        else { setError("PINs don't match. Try again."); setPin2(""); setPin1(""); setTimeout(() => setStep(1), 800); }
      }
    }
  };

  const handleDel = () => { setActive(v => v.slice(0, -1)); setError(""); };

  return (
    <Modal title={step === 1 ? "Set App PIN" : "Confirm PIN"} onClose={onClose}>
      <div className="flex flex-col items-center gap-6 py-2">
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
          {step === 1 ? "Choose a 6-digit PIN to protect your app" : "Enter your PIN again to confirm"}
        </p>
        <div className="flex gap-4">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${active.length > i ? "bg-brand-500 border-brand-500 scale-110" : "border-slate-300 dark:border-slate-600"}`} />
          ))}
        </div>
        {error && <p className="text-xs text-red-500 font-semibold -mt-2">{error}</p>}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
              {n}
            </button>
          ))}
          <div />
          <button onClick={() => handleDigit("0")}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
            0
          </button>
          <button onClick={handleDel}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
              <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-4">
          Your PIN is stored securely on this device only
        </p>
      </div>
    </Modal>
  );
}

// ── Security PIN pad ───────────────────────────────────────────────────────
// Full-screen numpad overlay at z-[300]. Shared by App PIN and Txn PIN flows.
// minLength: when set, a "Continue" button appears at that count (for variable-length current PIN step).
const PIN_PAD_CSS = `@keyframes ajoPinShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-10px)}40%,80%{transform:translateX(10px)}}.ajo-pin-shake{animation:ajoPinShake 0.38s ease}`;

function AjoPinPad({ title, subtitle, length = 6, minLength, onComplete, onCancel, error, shaking, loading, hint }) {
  const [digits, setDigits] = useState("");

  useEffect(() => {
    if (shaking) { const t = setTimeout(() => setDigits(""), 420); return () => clearTimeout(t); }
  }, [shaking]);

  const addDigit = useCallback((d) => {
    if (loading) return;
    setDigits(prev => {
      if (prev.length >= length) return prev;
      const next = prev + d;
      if (next.length === length) setTimeout(() => { onComplete(next); setDigits(""); }, 120);
      return next;
    });
  }, [loading, length, onComplete]);

  const del = useCallback(() => { if (!loading) setDigits(v => v.slice(0, -1)); }, [loading]);

  const manualSubmit = () => { if (digits.length >= (minLength || length)) { const d = digits; setDigits(""); onComplete(d); } };
  const showContinue = minLength && digits.length >= minLength && digits.length < length;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-white dark:bg-slate-900 select-none"
      style={{ paddingTop: "max(0px, env(safe-area-inset-top, 0px))", paddingBottom: "max(0px, env(safe-area-inset-bottom, 0px))" }}>
      <style>{PIN_PAD_CSS}</style>

      <div className="flex items-center px-4 pt-4 pb-1 flex-shrink-0">
        {onCancel && (
          <button onClick={onCancel} className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition">
            <Svg d={P.back} size={18} color="#64748b" />
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <div className="text-center space-y-1.5">
          <p className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
          {subtitle && <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed">{subtitle}</p>}
        </div>

        <div className={`flex gap-[18px] ${shaking ? "ajo-pin-shake" : ""}`}>
          {Array.from({ length }).map((_, i) => (
            <div key={i} className={`w-[14px] h-[14px] rounded-full border-2 transition-all duration-150 ${
              i < digits.length ? "bg-brand-500 border-brand-500 scale-110" : "border-slate-300 dark:border-slate-600"
            }`} />
          ))}
        </div>

        {error ? (
          <p className="text-sm text-red-500 font-semibold text-center -mt-1">{error}</p>
        ) : hint ? (
          <p className="text-[12px] text-slate-400 text-center -mt-1">{hint}</p>
        ) : null}

        {showContinue && !loading && (
          <button onClick={manualSubmit}
            className="px-8 py-2.5 bg-brand-500 text-white rounded-xl font-bold text-sm active:scale-95 transition -mt-1">
            Continue
          </button>
        )}
      </div>

      <div className="flex-shrink-0 px-6 pb-6">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 max-w-[288px] mx-auto">
            {[1,2,3,4,5,6,7,8,9,"",0,"del"].map((k, i) => {
              if (k === "") return <div key={i} />;
              if (k === "del") return (
                <button key={i} onClick={del}
                  className="h-[62px] rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 active:bg-slate-200 dark:active:bg-slate-700 transition">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" /><line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              );
              return (
                <button key={i} onClick={() => addDigit(String(k))} onPaste={e => e.preventDefault()}
                  className="h-[62px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-[22px] font-bold text-slate-800 dark:text-slate-100 active:scale-95 active:bg-slate-200 dark:active:bg-slate-700 transition">
                  {k}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────
const FAQS = [
  { q: "How do I pay my contribution?",
    a: "On the Home tab, tap the green 'Pay Contribution' button. Choose Paystack (card/bank) or Manual Transfer. For manual, send to the account shown and upload your receipt." },
  { q: "How do I check my savings balance?",
    a: "Your balance is shown on the Home tab in the hero card. Tap the eye icon to hide or reveal it." },
  { q: "How do I request a withdrawal?",
    a: "On the Home tab, tap 'Withdraw'. Enter the amount — you'll see a fee breakdown before confirming. Your savings agent reviews and approves all requests." },
  { q: "How do I view my transaction history?",
    a: "Tap the History tab. Filter by Deposits, Withdrawals, or Fees. Each row opens a full receipt with a dispute option." },
  { q: "What is the contribution calendar?",
    a: "The green squares on the Home tab show your activity for the last 90 days — each square is a day you contributed." },
  { q: "What fees apply?",
    a: "A registration fee may apply when you make your first deposit. Subsequent withdrawals may carry a percentage fee. The full breakdown is shown in My Fees." },
  { q: "What is Esusu rotation?",
    a: "If your group uses Esusu mode, each member takes turns collecting the full pot. Check the Rotation section on your Home tab to see the current turn and schedule." },
  { q: "How do I set a savings goal?",
    a: "On the Home tab, tap 'Set a Savings Goal'. Enter your target amount. A progress ring shows how close you are and estimates your completion date." },
  { q: "What is the PIN lock?",
    a: "The PIN lock protects your portal when you step away. Go to Me → Security to set or change your PIN. Biometric (fingerprint/face) is supported on compatible devices." },
  { q: "How do I update my profile?",
    a: "Go to the Me tab and tap the pen icon on your profile card, or go to Me → Edit Profile to change your name, phone, and photo." },
  { q: "How do I change my password?",
    a: "Go to the Me tab and tap 'Change Password' at the bottom." },
  { q: "How do I dispute a transaction?",
    a: "Open the History tab, tap any completed transaction row to view the receipt, then tap 'Dispute' to submit a report." },
];

function FAQ({ faqSearch = "", aiAnswer = "", aiLoading = false, aiError = "" }) {
  const [open, setOpen] = useState(null);
  const q = faqSearch.trim().toLowerCase();
  const filtered = q
    ? FAQS.filter(f => (f.q + " " + f.a).toLowerCase().includes(q))
    : FAQS;
  return (
    <div className="space-y-2">
      {filtered.length === 0 && !aiLoading && !aiAnswer && !aiError && (
        <div className="flex flex-col items-center py-8 gap-2 text-center">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Svg d={P.faq} size={20} color="#94a3b8" />
          </div>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No matches found</p>
          <p className="text-xs text-slate-400">Tap <span className="font-bold text-brand-500">Ask AI</span> to get a personalised answer.</p>
        </div>
      )}
      {filtered.map((f, i) => {
        const idx = FAQS.indexOf(f);
        return (
          <div key={idx} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-hidden">
            <button onClick={() => setOpen(open === idx ? null : idx)}
              className="w-full flex items-start gap-3 px-4 py-4 text-left">
              <div className="w-6 h-6 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-black text-brand-500 dark:text-brand-400">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </div>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1 leading-snug">{f.q}</span>
              <Svg d={open === idx ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} size={16} color="#94a3b8" />
            </button>
            {open === idx && (
              <div className="px-4 pb-4 pl-[52px]">
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p>
              </div>
            )}
          </div>
        );
      })}
      {(aiAnswer || aiLoading || aiError) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-brand-200 dark:border-brand-800/40 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="#3DA829" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <p className="text-[11px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider">AI Answer</p>
          </div>
          {aiLoading && (
            <div className="flex gap-1.5 py-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-2 h-2 rounded-full bg-brand-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
          {aiError && <p className="text-xs text-red-500">{aiError}</p>}
          {aiAnswer && <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>}
        </div>
      )}
    </div>
  );
}

function SupportInline({ client, session }) {
  const t = useT();
  const TICKET_TYPES = makeTicketTypes(t);
  const [form, setForm] = useState({
    subject: "", description: "", type: "general", priority: "medium",
    user_name: client?.full_name || "",
    user_email: client?.email || session?.user?.email || "",
  });
  const [submitting, setSub] = useState(false);
  const [done, setDone]      = useState(null);
  const [err, setErr]        = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.user_email.trim()) { setErr("Subject and email are required."); return; }
    setSub(true); setErr("");
    try {
      const res = await fetch(`${ADMIN_URL}/api/public/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "ajo_client", submitter_type: "ajo_client" }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to submit ticket"); return; }
      setDone(d.ticket_no);
    } catch { setErr("Network error. Please try again."); }
    finally { setSub(false); }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Svg d={P.check} size={28} color="#22c55e" sw={2.5} />
        </div>
        <div>
          <p className="text-base font-extrabold text-slate-800 dark:text-white">Ticket Submitted</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your ticket number is <span className="font-bold text-brand-500">#{done}</span>
          </p>
          <p className="text-xs text-slate-400 mt-2">Our team will respond to {form.user_email} shortly.</p>
        </div>
        <button onClick={() => setDone(null)}
          className="px-6 py-3 bg-brand-500 text-white rounded-2xl font-bold text-sm">
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/40 rounded-2xl px-4 py-3">
        <p className="text-[11px] text-brand-600 dark:text-brand-300 font-medium leading-relaxed">
          Describe your issue and our support team will respond by email within 24 hours.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[["Your Name", "user_name", "text", "Your name"], ["Email *", "user_email", "email", "your@email.com"]].map(([l, k, tp, ph]) => (
          <div key={k}>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{l}</p>
            <input type={tp} placeholder={ph} value={form[k]}
              onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
              className="w-full h-11 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
        ))}
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Category</p>
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="w-full h-11 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/30">
          {TICKET_TYPES.map(tt => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
        </select>
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Subject *</p>
        <input placeholder="Brief summary of your issue" value={form.subject}
          onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} required
          className="w-full h-11 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Description</p>
        <textarea placeholder="Describe the problem in detail…" value={form.description} rows={4}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
      </div>
      {err && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl px-3 py-2">
          <Svg d={P.alert} size={14} color="#ef4444" />
          <p className="text-xs text-red-500">{err}</p>
        </div>
      )}
      <button type="submit" disabled={submitting}
        className="w-full h-12 bg-brand-500 disabled:opacity-50 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.99]">
        {submitting && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {submitting ? "Submitting…" : "Submit Ticket"}
      </button>
    </form>
  );
}

// ── Portal-aware transaction PIN modal ───────────────────────────────────────
// Verifies against aso_clients.portal_pin (via ajo-portal verify-txn-pin).
// If the client has no PIN set (portal_pin_changed_at is null), auto-approves.
const SHAKE_CSS = `@keyframes _shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}.ajo-pin-shake{animation:_shake 0.5s ease}`;
const PAD_DIGITS = [1,2,3,4,5,6,7,8,9];

function AjoTxnPinModal({ clientId, hasPinSet, title, amount, description, onApprove, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasPinSet) { onApprove?.(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  }, []);

  const handleVerify = useCallback(async (entered) => {
    setBusy(true);
    try {
      const res = await ajoFn("verify-txn-pin", { client_id: clientId, pin: entered });
      if (res?.ok) { onApprove?.(); return; }
      triggerShake();
      setPin("");
      setErr("Incorrect PIN — try again.");
    } catch {
      triggerShake();
      setPin("");
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [clientId, onApprove, triggerShake]);

  const handleDigit = useCallback((d) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setErr("");
    if (next.length === 4) setTimeout(() => handleVerify(next), 150);
  }, [busy, pin, handleVerify]);

  const handleDel = useCallback(() => {
    if (busy) return;
    setPin(p => p.slice(0, -1));
    setErr("");
  }, [busy]);

  if (!hasPinSet) return null;

  return (
    <>
      <style>{SHAKE_CSS}</style>
      <div onClick={onCancel} className="fixed inset-0 bg-black/55" style={{ zIndex: 300 }} />
      <div className="fixed left-0 right-0 bottom-0 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl"
        style={{ zIndex: 301, paddingBottom: "env(safe-area-inset-bottom, 16px)", animation: "slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
        </div>
        <p className="text-center font-bold text-[17px] text-slate-900 dark:text-slate-100 px-6 mb-4">{title}</p>
        {(amount != null || description) && (
          <div className="mx-4 mb-5 bg-slate-50 dark:bg-slate-800 rounded-2xl p-4">
            {amount != null && (
              <p className="text-center text-[28px] font-extrabold text-brand-500 mb-2">
                ₦{(amount / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </p>
            )}
            {description && (
              <p className="text-center text-[12px] text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
        )}
        <div className="flex flex-col items-center gap-4 px-6">
          <p className="text-[13px] text-slate-500 text-center">Enter your transaction PIN to confirm</p>
          {busy
            ? <div className="w-6 h-6 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
            : <div className={`flex justify-center gap-4 ${shake ? "ajo-pin-shake" : ""}`}>
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                    pin.length > i ? "scale-110" : "border-slate-300 dark:border-slate-600 bg-transparent"
                  }`} style={pin.length > i ? { background: "var(--brand-green)", borderColor: "var(--brand-green)" } : undefined} />
                ))}
              </div>
          }
          {err && <p className="text-[12px] font-semibold text-red-500 text-center -mt-2">{err}</p>}
          <div className="grid grid-cols-3 gap-2.5 w-full max-w-[280px]">
            {PAD_DIGITS.map(n => (
              <button key={n} onClick={() => handleDigit(String(n))}
                className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold transition-all duration-100">
                {n}
              </button>
            ))}
            <div />
            <button onClick={() => handleDigit("0")}
              className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold transition-all duration-100">
              0
            </button>
            <button onClick={handleDel}
              className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-600 dark:text-slate-400 flex items-center justify-center transition-all duration-100">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" /><line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
              </svg>
            </button>
          </div>
          <button onClick={onCancel} className="text-sm text-slate-400 py-2 px-6 mb-1">Cancel</button>
        </div>
      </div>
    </>
  );
}

// ── Pay Contribution modal ────────────────────────────────────────────────
// Contribution type selector — shown only when client is in a group (2 options)
function ContribTypeSelector({ clientGroups = [], value, selectedGroupId, onChange, label = "Which savings goal?" }) {
  if (!clientGroups.length) return null;
  const opts = [
    { key: "personal_savings", label: "Personal Savings", desc: "Add to your personal savings balance", groupId: null },
    ...clientGroups.map(g =>
      g.group_mode === "rotating"
        ? { key: "esusu_rotation", label: g.name, desc: "Esusu Rotation — contribute to the pot", groupId: g.id }
        : { key: "group_savings",  label: g.name, desc: "Savings Group — contribute to the pool",  groupId: g.id }
    ),
  ];
  return (
    <div className="mb-5">
      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{label}</p>
      <div className="space-y-2">
        {opts.map(opt => (
          <button key={`${opt.key}:${opt.groupId || "personal"}`} type="button"
            onClick={() => onChange(opt.key, opt.groupId)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition ${
              value === opt.key && selectedGroupId === opt.groupId
                ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                : "border-slate-200 dark:border-slate-700"
            }`}>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold text-slate-800 dark:text-white truncate">{opt.label}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{opt.desc}</p>
            </div>
            <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              value === opt.key && selectedGroupId === opt.groupId ? "border-brand-500 bg-brand-500" : "border-slate-300 dark:border-slate-600"
            }`}>
              {value === opt.key && selectedGroupId === opt.groupId && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PayContributionModal({ client, clientGroups = [], cycles = [], onClose, onSuccess }) {
  const [status,          setStatus]         = useState("idle"); // idle | loading | awaiting | verifying | done | error
  const [message,         setMessage]        = useState("");
  const [pendingRef,      setPendingRef]     = useState(null);
  const [paidAmt,         setPaidAmt]        = useState(0);
  const [customAmt,       setCustomAmt]      = useState(String(client?.contribution_amount || ""));
  const [txnPin,          setTxnPin]         = useState(null);
  const [showShare,       setShowShare]      = useState(false);
  const [contribCtx,      setContribCtx]     = useState("personal_savings");
  const [contribGroupId,  setContribGroupId] = useState(null);
  const activePsCycles = cycles.filter(cy => cy.status === "active");
  const [selectedCycleId, setSelectedCycleId] = useState(() => activePsCycles.length === 1 ? activePsCycles[0].id : null);
  const popupCleanup = useRef(null);
  useEffect(() => () => popupCleanup.current?.(), []);

  const doVerify = useCallback(async (ref) => {
    if (!ref) return;
    setStatus("verifying");
    setMessage("Verifying your payment…");
    try {
      const confirmation = await ajoFn("confirm-payment", { client_id: client.id, reference: ref });
      setStatus("done");
      setMessage(`Payment confirmed! Ref: ${ref}`);
      onSuccess?.(ref, confirmation?.client);
    } catch (e) {
      setStatus("awaiting");
      setMessage(friendlyError(e));
    }
  }, [client.id, onSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePay = async () => {
    const amt = parseFloat(customAmt);
    if (!amt || amt <= 0) { setMessage("Please enter a valid amount."); return; }
    setStatus("loading"); setMessage(""); setPendingRef(null);
    setPaidAmt(amt);

    try {
      const res = await ajoFn("initialize-payment", { client_id: client.id, amount: amt, contribution_context: contribCtx, group_id: contribGroupId || undefined, ...(contribCtx === "personal_savings" && selectedCycleId ? { cycle_id: selectedCycleId } : {}) });
      if (!res.authorization_url) throw new Error("Payment initialization failed");

      const ref = res.reference;
      setPendingRef(ref);
      setStatus("awaiting");
      setMessage("Paystack is open. After paying, come back here and tap the button below.");

      // Open in-app browser (Chrome Custom Tabs on Android, popup on web)
      popupCleanup.current?.();
      popupCleanup.current = openPaystackPopup(res.authorization_url, {
        onClose: (urlRef) => setTimeout(() => doVerify(urlRef || ref), 600),
      });
    } catch (e) {
      setStatus("error");
      setMessage(moneyError(e));
    }
  };

  // Full-screen success screen — tap "Share Receipt" for shareable receipt modal
  if (status === "done") {
    const receiptData = buildAjoContributionReceipt(
      {
        id: pendingRef, type: "contribution", status: "completed",
        amount: paidAmt || client?.contribution_amount || 0,
        created_at: new Date().toISOString(), payment_method: "paystack",
      },
      client?.full_name || "—",
      client?.group_name || "Ajo Group"
    );

    if (showShare) {
      return (
        <TransactionDetailModal
          data={receiptData}
          onClose={() => setShowShare(false)}
        />
      );
    }

    return (
      <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 flex flex-col">
        {/* Top accent */}
        <div className="h-1.5 w-full bg-[linear-gradient(90deg,#16255A,#3DA829)]" />

        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          {/* Checkmark */}
          <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6 shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 text-green-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <p className="text-[11px] font-bold text-green-500 uppercase tracking-widest mb-1">Transaction Successful</p>
          <AmountDisplay amount={paidAmt || client?.contribution_amount || 0} size="hero" align="center" style={{ marginBottom: 4 }} />
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Added to your savings
          </p>

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Your balance has been updated.
          </p>
        </div>

        {/* Bottom actions */}
        <div className="flex-none px-6 pb-10 pt-4 space-y-3">
          <button
            onClick={() => setShowShare(true)}
            className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Share Receipt
          </button>
          <button
            onClick={onClose}
            className="w-full py-3.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-sm transition active:scale-[0.99]">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl p-6 shadow-2xl max-h-[88dvh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-2xl flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-extrabold text-slate-800 dark:text-white">Pay your contribution</p>
            <p className="text-[11px] text-slate-400">Secure payment via Paystack</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* LEAD: Amount — the one thing they need to do */}
        <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-4 mb-4">
          <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-2 capitalize">{client?.contribution_frequency || "monthly"} contribution</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-brand-600 dark:text-brand-300">₦</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={customAmt}
              onChange={e => setCustomAmt(e.target.value)}
              disabled={status === "loading" || status === "awaiting" || status === "verifying"}
              placeholder="Enter amount"
              className="flex-1 bg-transparent text-2xl font-black text-brand-600 dark:text-brand-300 outline-none placeholder:text-brand-200 dark:placeholder:text-brand-500 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          {client?.contribution_amount > 0 && Number(customAmt) !== client.contribution_amount && (
            <button
              onClick={() => setCustomAmt(String(client.contribution_amount))}
              className="mt-2 text-[10px] text-brand-500 dark:text-brand-400 underline underline-offset-2">
              Use {fmt(client.contribution_amount)} instead
            </button>
          )}
        </div>

        {/* First-deposit info — plain language, no formula */}
        {contribCtx === "personal_savings" && (() => {
          if (Number(client?.total_saved || 0) > 0) return null;
          const regCharge = Number(client?.registration_charge || 0);
          const expected  = Number(client?.contribution_amount || 0);
          const minReq    = expected + regCharge;
          if (minReq <= 0 || (regCharge === 0 && client?.commission_model !== "first_period")) return null;
          return (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5 mb-4">
              <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                Your first payment is ₦{minReq.toLocaleString("en-NG")} — includes a one-time ₦{regCharge.toLocaleString("en-NG")} registration. After today, every payment is ₦{expected.toLocaleString("en-NG")}.
              </p>
            </div>
          );
        })()}

        {/* Goal selector — secondary, only visible if client is in a group */}
        <ContribTypeSelector clientGroups={clientGroups.map(m => m.group).filter(Boolean)} value={contribCtx} selectedGroupId={contribGroupId}
          onChange={(ctx, gid) => { setContribCtx(ctx); setContribGroupId(gid || null); }} />

        {/* Cycle picker — secondary, only if personal savings and multiple active cycles */}
        {contribCtx === "personal_savings" && activePsCycles.length > 1 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Which savings goal?</p>
            <div className="space-y-1.5">
              {activePsCycles.map(cyc => (
                <button key={cyc.id} type="button"
                  onClick={() => setSelectedCycleId(cyc.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left text-sm transition ${
                    selectedCycleId === cyc.id
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  }`}>
                  <span className="font-semibold">{cyc.label || "Savings"}</span>
                  {selectedCycleId === cyc.id && <div className="w-3.5 h-3.5 rounded-full bg-brand-500 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {message && (
          <p className={`text-xs mb-4 px-3 py-2 rounded-xl ${
            status === "error" ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
            : status === "awaiting" ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
            : "bg-slate-50 dark:bg-slate-800 text-slate-500"
          }`}>
            {message}
          </p>
        )}

        {(status === "awaiting" || status === "verifying") && (
          <button
            onClick={() => doVerify(pendingRef)}
            disabled={status === "verifying"}
            className="w-full mb-3 py-4 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2 shadow-md">
            {status === "verifying"
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying…</>
              : "I've paid — confirm my savings"}
          </button>
        )}

        <button
          onClick={() => {
            const amt = parseFloat(customAmt);
            if (!amt || amt <= 0) { setMessage("Please enter a valid amount."); return; }
            const hasPinSet = Boolean(client?.portal_pin_changed_at);
            setTxnPin({
              title: "Confirm Contribution",
              amount: Math.round(amt * 100),
              description: "Savings contribution via Paystack",
              hasPinSet,
              onApprove: () => { setTxnPin(null); handlePay(); },
            });
          }}
          disabled={status === "loading" || status === "awaiting" || status === "verifying"}
          className="w-full py-4 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2 shadow-md">
          {status === "loading"
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Opening Paystack…</>
            : status === "awaiting" ? "Open Paystack again"
            : <>Pay {fmt(parseFloat(customAmt) || 0)} now</>}
        </button>
        <button onClick={onClose} disabled={status === "loading" || status === "verifying"}
          className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center py-2">
          Cancel
        </button>
        {txnPin && <AjoTxnPinModal {...txnPin} clientId={client?.id} onCancel={() => setTxnPin(null)} />}
      </div>
    </div>
  );
}

// ── Quick Actions (Staff Portal style) ────────────────────────────────────
function ActionBtn({ label, icon, bg, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${bg}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon.split("|").map((d, i) => <path key={i} d={d} />)}
        </svg>
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">{label}</span>
    </button>
  );
}

// ── Bill service tiles for Quick Services grid ─────────────────────────────
const QUICK_SERVICES = [
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", d: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
  { id: "data",        label: "Data Bundle", g1: "#3b82f6", g2: "#1d4ed8", d: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id: "cable",       label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", d: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
  { id: "betting",     label: "Betting",     g1: "#10b981", g2: "#059669", d: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
  { id: "more",        label: "More Bills",  g1: "#6366f1", g2: "#4f46e5", d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4" },
];

// ── Contribution calendar ─────────────────────────────────────────────────
function ContribCalendar({ contributions }) {
  const contribDates = new Set(
    contributions.filter(c => c.type === "contribution" && c.status === "completed")
      .map(c => (c.created_at || "").slice(0, 10))
  );
  const cells = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    cells.push({ date: ds, has: contribDates.has(ds) });
  }
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Activity — last 90 days</p>
      <div className="flex flex-wrap gap-0.5">
        {cells.map(({ date, has }) => (
          <div key={date} title={fmtDate(date)}
            className={`w-3 h-3 rounded-sm ${has ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-brand-500" />
          <span className="text-[10px] text-slate-400">Contributed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] text-slate-400">No activity</span>
        </div>
      </div>
    </div>
  );
}

// ── First-login force-password-change ─────────────────────────────────────
function AjoMemberFirstLogin({ ajoClient }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];

  const submit = async () => {
    if (password.length < 8) { setError("Minimum 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    setSuccess(true);
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-brand-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your dashboard…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pb-5" style={{ paddingTop: "max(56px, env(safe-area-inset-top, 56px))" }}>
        <div className="w-12 h-12 bg-brand-500 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Hi {ajoClient?.full_name?.split(" ")[0] || "there"}! Choose a password you'll use every time you log in.
        </p>
      </div>
      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">New Password *</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-brand-500 dark:text-brand-400">
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          {password && (
            <div className="flex gap-1 mt-1.5">
              {[1,2,3,4].map(n => (
                <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirm Password *</label>
          <input type={showPwd ? "text" : "password"} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 ${confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}`} />
          {confirm && confirm !== password && <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>}
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>}
        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition">
          {saving ? "Saving…" : "Set Password & Enter Dashboard →"}
        </button>
        <button onClick={() => supabase.auth.signOut()} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Change password modal ─────────────────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [pwd,     setPwd]     = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);

  const handle = async () => {
    if (pwd.length < 8) { setError("Minimum 8 characters"); return; }
    if (pwd !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: pwd, data: { must_change_password: false } });
    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    setSuccess(true);
    setTimeout(onClose, 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Change Password</h3>
        {success ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 text-green-700 dark:text-green-400 font-semibold text-sm text-center">
            Password updated successfully!
          </div>
        ) : (
          <>
            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-3"><p className="text-xs text-red-600 dark:text-red-400">{error}</p></div>}
            <div className="space-y-3 mb-4">
              <div className="relative">
                <input type={showPwd ? "text" : "password"} value={pwd} onChange={e => setPwd(e.target.value)} placeholder="New password (min. 8 chars)"
                  className="w-full px-3 pr-14 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-brand-500">{showPwd ? "Hide" : "Show"}</button>
              </div>
              <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password"
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <button onClick={handle} disabled={saving || pwd.length < 8 || pwd !== confirm}
              className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold text-sm transition disabled:opacity-50">
              {saving ? "Updating…" : "Update Password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Manual deposit modal ──────────────────────────────────────────────────
function ManualDepositModal({ client, clientGroups = [], cycles = [], ownerInfo, onClose, onSuccess }) {
  const [amount,         setAmount]        = useState("");
  const [payerName,      setPayerName]     = useState("");
  const [notes,          setNotes]         = useState("");
  const [proofFile,      setProofFile]     = useState(null);
  const [proofPrev,      setProofPrev]     = useState(null);
  const [uploading,      setUploading]     = useState(false);
  const [saving,         setSaving]        = useState(false);
  const [error,          setError]         = useState("");
  const [done,           setDone]          = useState(false);
  const [contribCtx,     setContribCtx]    = useState("personal_savings");
  const [contribGroupId, setContribGroupId] = useState(null);
  const activePsCyclesMd = cycles.filter(cy => cy.status === "active");
  const [selectedMdCycleId, setSelectedMdCycleId] = useState(() => activePsCyclesMd.length === 1 ? activePsCyclesMd[0].id : null);
  const [copiedField,    setCopiedField]   = useState(null);
  const fileRef = useRef(null);

  // Prefer the client's own dedicated account; fall back to the owner's business account
  const clientBank = ownerInfo?.client_bank;
  const ownerBank  = ownerInfo?.owner;
  const hasBank = clientBank?.account_number
    ? true
    : !!(ownerBank?.bank_account_number && ownerBank?.bank_name);
  const amtNum  = parseFloat(amount) || 0;

  const copyText = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* silent */ }
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError("Image must be under 2 MB"); return; }
    setProofFile(f);
    setProofPrev(URL.createObjectURL(f));
    setError("");
  };

  const handleSubmit = async () => {
    if (!amtNum || amtNum <= 0) { setError("Enter a valid amount"); return; }
    setSaving(true); setError("");
    try {
      let proofUrl = null;
      if (proofFile) {
        setUploading(true);
        proofUrl = await uploadAjoProof(proofFile, client.id);
        setUploading(false);
      }
      await ajoFn("submit-manual-claim", {
        client_id:            client.id,
        owner_id:             client.user_id,
        amount:               amtNum,
        payer_name:           payerName.trim()    || null,
        notes:                notes.trim()        || null,
        proof_url:            proofUrl,
        contribution_context: contribCtx,
        ...(contribCtx === "personal_savings" && selectedMdCycleId ? { cycle_id: selectedMdCycleId } : {}),
        ...(contribCtx !== "personal_savings" && contribGroupId   ? { group_id: contribGroupId }    : {}),
      });
      setDone(true);
      onSuccess?.();
    } catch (e) {
      setUploading(false);
      setError(moneyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />

        {done ? (
          <div className="text-center py-6">
            {/* Amber clock — deliberately NOT green, cannot be mistaken for credited */}
            <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-amber-500 dark:text-amber-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Sent for checking</p>
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-white mb-2">We got it!</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed px-2">Your agent will check the transfer and update your balance shortly. You&apos;ll get a notification when it&apos;s done.</p>
            <button onClick={onClose} className="w-full py-3.5 bg-slate-800 dark:bg-slate-700 text-white rounded-2xl font-bold text-sm active:scale-[0.99] transition">
              Got it
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/40 rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M12 5v14M5 12l7-7 7 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-slate-800 dark:text-white">Make a Deposit</p>
                <p className="text-[11px] text-slate-400">Send money here, then tell us you&apos;ve paid</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* LEAD: Bank details — the action they need to do before anything else */}
            {hasBank ? (() => {
              const isClientAcct = !!clientBank?.account_number;
              const acctNum  = isClientAcct ? clientBank.account_number  : ownerBank.bank_account_number;
              const acctName = isClientAcct ? clientBank.account_name    : ownerBank.bank_account_name;
              const bankName = isClientAcct ? clientBank.bank_name       : ownerBank.bank_name;
              return (
                <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-4 mb-4">
                  <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-3">Send money here</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">Account Number</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-black text-slate-800 dark:text-white tracking-widest tabular">{acctNum}</span>
                        <button onClick={() => copyText(acctNum, "acctNum")}
                          className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition active:scale-90 ${copiedField === "acctNum" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-brand-100 dark:bg-brand-900/40 text-brand-500 dark:text-brand-400"}`}>
                          {copiedField === "acctNum"
                            ? <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                            : <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                          }
                        </button>
                      </div>
                    </div>
                    {acctName && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">Account Name</span>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{acctName}</span>
                          <button onClick={() => copyText(acctName, "acctName")}
                            className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition active:scale-90 ${copiedField === "acctName" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"}`}>
                            {copiedField === "acctName"
                              ? <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                              : <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                            }
                          </button>
                        </div>
                      </div>
                    )}
                    {bankName && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Bank</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{bankName}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })() : (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5 mb-4">
                <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">Bank details not set up yet. Contact your savings agent for transfer instructions.</p>
              </div>
            )}

            {/* Amount — past tense, matches what they already did */}
            <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-4 mb-4">
              <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-2">How much did you send? <span className="text-red-400">*</span></p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-brand-600 dark:text-brand-300">₦</span>
                <input
                  type="number" inputMode="decimal" min="1"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-black text-brand-600 dark:text-brand-300 outline-none placeholder:text-brand-200 dark:placeholder:text-brand-700 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              {amtNum > 0 && (
                <p className="text-[11px] text-brand-400 dark:text-brand-500 mt-1">{fmt(amtNum)} — exact transfer amount</p>
              )}
            </div>

            {/* Goal selector — secondary, after amount, only if in a group */}
            <ContribTypeSelector clientGroups={clientGroups.map(m => m.group).filter(Boolean)} value={contribCtx} selectedGroupId={contribGroupId}
              onChange={(ctx, gid) => { setContribCtx(ctx); setContribGroupId(gid || null); }} />

            {/* Cycle picker — secondary, only if multiple active cycles */}
            {contribCtx === "personal_savings" && activePsCyclesMd.length > 1 && (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Which savings goal?</p>
                <div className="space-y-1.5">
                  {activePsCyclesMd.map(cyc => (
                    <button key={cyc.id} type="button"
                      onClick={() => setSelectedMdCycleId(cyc.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left text-sm transition ${
                        selectedMdCycleId === cyc.id
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                          : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                      }`}>
                      <span className="font-semibold">{cyc.label || "Savings"}</span>
                      {selectedMdCycleId === cyc.id && <div className="w-3.5 h-3.5 rounded-full bg-brand-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* First-deposit info — plain language */}
            {contribCtx === "personal_savings" && (() => {
              if (Number(client.total_saved || 0) > 0) return null;
              const regCharge = Number(client.registration_charge || 0);
              const expected  = Number(client.contribution_amount  || 0);
              const minReq    = expected + regCharge;
              if (minReq <= 0 || (regCharge === 0 && client.commission_model !== "first_period")) return null;
              return (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5 mb-3">
                  <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                    Your first payment is ₦{minReq.toLocaleString("en-NG")} — includes a one-time ₦{regCharge.toLocaleString("en-NG")} registration. After today, every payment is ₦{expected.toLocaleString("en-NG")}.
                  </p>
                </div>
              );
            })()}

            {/* Proof upload — simplified */}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
            {uploading && (
              <div className="mb-3 px-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400">Uploading screenshot…</span>
                  <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="h-1.5 bg-brand-100 dark:bg-brand-800 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full animate-pulse" style={{ width: "75%" }} />
                </div>
              </div>
            )}
            {!uploading && proofPrev && (
              <div className="relative mb-3">
                <img src={proofPrev} alt="Proof" className="w-full rounded-xl object-cover max-h-40 border border-slate-200 dark:border-slate-600" />
                <button onClick={() => { setProofFile(null); setProofPrev(null); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center text-white text-xs font-bold">✕</button>
              </div>
            )}
            {!uploading && !proofPrev && (
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-2.5 mb-3 text-xs font-bold text-brand-500 dark:text-brand-400 flex items-center gap-2 active:scale-[0.99] transition">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                </svg>
                Add a screenshot (optional — speeds up approval)
              </button>
            )}

            {/* Optional extra details — collapsed by default */}
            <details className="mb-3 group">
              <summary className="text-[11px] font-bold text-slate-400 dark:text-slate-500 cursor-pointer select-none list-none flex items-center gap-1.5 mb-2">
                <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 transition-transform group-open:rotate-90" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                Add more details (optional)
              </summary>
              <div className="space-y-2.5 mt-2">
                <input
                  type="text"
                  value={payerName} onChange={e => setPayerName(e.target.value)}
                  placeholder="Sender name (name on the transfer)"
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  type="text"
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Note (e.g. January contribution)"
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </details>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving || uploading || !amtNum || amtNum <= 0}
              className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm flex items-center justify-center gap-2">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
                : "I sent this money"}
            </button>

            <p className="text-[10px] text-slate-400 text-center mt-3">
              Your agent will confirm it before your balance is updated.
            </p>
          </>
        )}
      </div>
    </div>
    </>
  );
}

// ── Withdrawal request modal ──────────────────────────────────────────────
function WithdrawRequestModal({ client, cycles = [], clientGroups = [], rotationsData = [], contributions = [], onClose, onSuccess }) {
  const [amount,        setAmount]        = useState("");
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState("");
  const [done,          setDone]          = useState(false);
  const [txnPin,        setTxnPin]        = useState(null);
  const [esusuLocked,   setEsusuLocked]   = useState(0);
  const [cycleLocked,   setCycleLocked]   = useState(0);
  const [groupLocked,   setGroupLocked]   = useState(0);
  const [locksLoaded,   setLocksLoaded]   = useState(false);
  const [activeTab,       setActiveTab]       = useState("personal");
  const [selectedGrpId,   setSelectedGrpId]   = useState(null);
  const selectedCycleId = cycles.filter(c => c.status === "active").length === 1
    ? cycles.find(c => c.status === "active")?.id ?? null
    : null;

  useEffect(() => {
    setLocksLoaded(false);
    Promise.all([
      supabase.rpc("ajo_locked_esusu_amount", { p_client_id: client.id }),
      supabase.rpc("ajo_locked_cycle_amount",  { p_client_id: client.id }),
      supabase.rpc("ajo_locked_group_amount",  { p_client_id: client.id }),
    ]).then(([{ data: eData }, { data: cData }, { data: gData }]) => {
      setEsusuLocked(Number(eData || 0));
      setCycleLocked(Number(cData || 0));
      setGroupLocked(Number(gData || 0));
      setLocksLoaded(true);
    }).catch(() => setLocksLoaded(true));
  }, [client.id, client.current_balance, cycles]);

  // Bank account state
  const [banks,        setBanks]        = useState([]);
  const hasAccount = !!(
    (client.withdrawal_account_number || client.account_number) &&
    (client.withdrawal_account_name   || client.account_name)
  );
  const [acctForm,     setAcctForm]     = useState({
    bank_code:      client.withdrawal_bank_code      || client.bank_code      || "",
    account_number: client.withdrawal_account_number || client.account_number || "",
    account_name:   client.withdrawal_account_name   || client.account_name   || "",
    bank_name:      client.withdrawal_bank_name      || client.bank_name      || "",
  });
  const [acctVerified,  setAcctVerified]  = useState(false);
  const [acctVerifying, setAcctVerifying] = useState(false);
  const [acctError,     setAcctError]     = useState("");
  const [editingAcct,   setEditingAcct]   = useState(!hasAccount);

  useEffect(() => {
    supabase.functions.invoke("paystack", { body: { action: "list-banks" } })
      .then(({ data }) => setBanks(data?.data || []))
      .catch(() => {});
  }, []);

  const resolveAcct = async () => {
    if (!acctForm.bank_code || acctForm.account_number.length !== 10) {
      setAcctError("Select a bank and enter a 10-digit account number"); return;
    }
    setAcctVerifying(true); setAcctError(""); setAcctVerified(false);
    try {
      const { data } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: acctForm.account_number, bank_code: acctForm.bank_code },
      });
      if (!data?.status || !data?.data?.account_name) {
        setAcctError(data?.message || "Could not verify account. Check the details and retry."); return;
      }
      const bankName = banks.find(b => b.code === acctForm.bank_code)?.name || acctForm.bank_name;
      setAcctForm(p => ({ ...p, account_name: data.data.account_name, bank_name: bankName }));
      setAcctVerified(true);
    } catch { setAcctError("Verification failed. Try again."); }
    finally { setAcctVerifying(false); }
  };

  // Derived tab/group data
  const savingsGroups = clientGroups
    .filter(m => m.group?.group_mode === "savings")
    .map(m => m.group)
    .filter(Boolean);
  const esusuRounds = rotationsData;
  const hasTabs = savingsGroups.length > 0 || esusuRounds.length > 0;
  const selectedGroup = savingsGroups.find(g => g.id === selectedGrpId) || savingsGroups[0] || null;

  // Fee from active percent cycle (not client row — cycle model is the truth after Cycles v2)
  const activePctCycle = cycles.find(cy => cy.status === "active" && cy.commission_model === "percent");
  const pctFee       = activePctCycle ? (activePctCycle.commission_percent || 0) : 0;
  const amtNum       = parseFloat(amount) || 0;
  const feeAmt       = (amtNum * pctFee) / 100;
  const netAmt       = amtNum - feeAmt;
  const lockedAmount = esusuLocked + cycleLocked + groupLocked;
  const withdrawable = Math.max((client.current_balance || 0) - lockedAmount, 0);

  const handleSubmit = async () => {
    if (!amtNum || amtNum <= 0)   { setError("Enter a valid amount"); return; }
    if (amtNum > withdrawable) {
      const lockParts = [];
      if (groupLocked > 0) lockParts.push(`${fmt(groupLocked)} committed to group/esusu`);
      if (esusuLocked > 0) lockParts.push(`${fmt(esusuLocked)} locked in active esusu round`);
      if (cycleLocked > 0) lockParts.push(`${fmt(cycleLocked)} locked in first-period cycle`);
      const lockMsg = lockParts.length > 0
        ? `Only ${fmt(withdrawable)} is available — ${lockParts.join(" and ")}`
        : "Amount exceeds your balance";
      setError(lockMsg);
      return;
    }
    if (netAmt <= 0)              { setError("Amount too small after fee deduction"); return; }
    if (!acctForm.account_name || !acctForm.account_number || !acctForm.bank_code) {
      setError("Add and verify your bank account before requesting a withdrawal"); return;
    }
    setSaving(true); setError("");
    try {
      const existingAcctNum  = client.withdrawal_account_number || client.account_number || "";
      const existingBankCode = client.withdrawal_bank_code      || client.bank_code      || "";
      const bankChanged = acctForm.account_number !== existingAcctNum ||
                          acctForm.bank_code      !== existingBankCode;
      if (bankChanged && acctVerified) {
        await ajoFn("update-profile", {
          client_id: client.id,
          fields: {
            withdrawal_bank_code:      acctForm.bank_code,
            withdrawal_bank_name:      acctForm.bank_name,
            withdrawal_account_number: acctForm.account_number,
            withdrawal_account_name:   acctForm.account_name,
          },
        });
      }
      const reqNotes = activeTab === "group" && selectedGroup
        ? `Group savings — ${selectedGroup.name}`
        : undefined;
      // Attribution: attach cycle_id for personal withdrawals, group_id for group/esusu
      const reqCycleId = activeTab === "personal" ? (selectedCycleId || null) : null;
      const reqGroupId = (activeTab === "group" || activeTab === "esusu")
        ? (selectedGrpId || (savingsGroups[0]?.id || esusuRounds[0]?.group?.id) || null)
        : null;
      await ajoFn("request-withdrawal", {
        client_id: client.id,
        owner_id:  client.user_id,
        amount:    amtNum,
        ...(reqCycleId ? { cycle_id: reqCycleId } : {}),
        ...(reqGroupId ? { group_id: reqGroupId } : {}),
        ...(reqNotes   ? { notes:    reqNotes }   : {}),
      });
      setDone(true);
      onSuccess();
    } catch (e) {
      setError(moneyError(e));
    } finally {
      setSaving(false);
    }
  };

  // Shared withdrawal form used by both Personal and Group tabs
  const withdrawalForm = (
    <>
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-4 py-4 mb-3">
        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">How much do you want?</p>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black text-slate-700 dark:text-slate-200">₦</span>
          <input
            type="number" inputMode="decimal" min="1"
            value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-2xl font-black text-slate-700 dark:text-slate-200 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        {amtNum > withdrawable && (
          <p className="text-[11px] text-red-500 mt-1">Exceeds available balance</p>
        )}
        {amtNum > 0 && amtNum <= withdrawable && (
          <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600">
            {feeAmt > 0 ? (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">You&apos;ll receive · {fmt(feeAmt)} handling fee</span>
                <span className="text-sm font-extrabold text-green-600 dark:text-green-400 tabular-nums">{fmt(Math.max(0, netAmt))}</span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">You&apos;ll receive · no fee</span>
                <span className="text-sm font-extrabold text-green-600 dark:text-green-400 tabular-nums">{fmt(amtNum)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Payout Account</p>
          {!editingAcct && acctForm.account_name && (
            <button type="button" onClick={() => { setEditingAcct(true); setAcctVerified(false); }}
              className="text-[11px] font-bold text-brand-500 dark:text-brand-400">Change</button>
          )}
        </div>
        {!editingAcct && acctForm.account_name ? (
          <div>
            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{acctForm.account_name}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{acctForm.bank_name} · ****{acctForm.account_number.slice(-4)}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <select value={acctForm.bank_code} onChange={e => {
              const sel = banks.find(b => b.code === e.target.value);
              setAcctForm(p => ({ ...p, bank_code: e.target.value, bank_name: sel?.name || "", account_name: "" }));
              setAcctVerified(false);
            }} className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
              <option value="">Select bank…</option>
              {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" maxLength={10} placeholder="10-digit account number"
                value={acctForm.account_number}
                onChange={e => { setAcctForm(p => ({ ...p, account_number: e.target.value.replace(/\D/g, "").slice(0, 10), account_name: "" })); setAcctVerified(false); }}
                className="flex-1 h-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              <button type="button" onClick={resolveAcct}
                disabled={acctVerifying || !acctForm.bank_code || acctForm.account_number.length !== 10}
                className="h-10 px-3.5 rounded-xl bg-brand-500 text-white text-xs font-bold disabled:opacity-40 flex-shrink-0 active:scale-95 transition">
                {acctVerifying ? "…" : "Verify"}
              </button>
            </div>
            {acctVerified && acctForm.account_name && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-xl">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-green-600 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                <p className="text-[12px] font-bold text-green-700 dark:text-green-400">{acctForm.account_name}</p>
              </div>
            )}
            {acctError && <p className="text-xs text-red-500">{acctError}</p>}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      <button
        onClick={() => {
          if (!amtNum || amtNum <= 0) { setError("Enter a valid amount"); return; }
          if (amtNum > withdrawable) {
            let lockMsg = "Amount exceeds your available balance";
            if (esusuLocked > 0 && cycleLocked > 0) {
              lockMsg = `Only ${fmt(withdrawable)} is available — ${fmt(esusuLocked)} locked in esusu and ${fmt(cycleLocked)} locked in your first-period cycle`;
            } else if (esusuLocked > 0) {
              lockMsg = `Only ${fmt(withdrawable)} is available — ${fmt(esusuLocked)} is locked in your active esusu round`;
            } else if (cycleLocked > 0) {
              lockMsg = `Only ${fmt(withdrawable)} is available — ${fmt(cycleLocked)} is locked in your first-period savings cycle`;
            }
            setError(lockMsg);
            return;
          }
          if (netAmt <= 0) { setError("Amount too small after fee deduction"); return; }
          if (!acctForm.account_name || !acctForm.account_number || !acctForm.bank_code) {
            setError("Add and verify your bank account before requesting a withdrawal"); return;
          }
          setTxnPin({
            title: "Confirm Withdrawal",
            amount: Math.round(netAmt * 100),
            description: "Savings withdrawal request",
            hasPinSet: Boolean(client?.portal_pin_changed_at),
            onApprove: () => { setTxnPin(null); handleSubmit(); },
          });
        }}
        disabled={saving || !amtNum || amtNum <= 0}
        className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm">
        {saving ? "Withdrawing…" : amtNum > 0 && netAmt > 0 ? `Withdraw ${fmt(netAmt)}` : "Withdraw"}
      </button>
    </>
  );

  return (
    <>
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        {done ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Done!</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">Your agent will pay you out shortly. We&apos;ll let you know when it&apos;s ready.</p>
            <button onClick={onClose} className="mt-5 w-full py-3.5 bg-brand-500 text-white rounded-xl font-bold text-sm">Close</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M12 19V5M5 12l7 7 7-7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-slate-800 dark:text-white">Take out money</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Hero: one clear number — skeleton while locks load (bug 1 fix) */}
            <div className="text-center mb-4">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Ready to withdraw</p>
              {locksLoaded
                ? <p className="text-4xl font-black text-slate-800 dark:text-white tabular-nums">{fmt(withdrawable)}</p>
                : <div className="h-10 w-40 bg-slate-200 dark:bg-slate-700 rounded-xl mx-auto animate-pulse" />
              }
            </div>

            {/* Collapsible set-aside — only once locks are loaded and something is actually locked */}
            {locksLoaded && lockedAmount > 0 && (
              <details className="mb-4 group">
                <summary className="text-xs font-bold text-amber-600 dark:text-amber-400 cursor-pointer select-none list-none flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 transition-transform group-open:rotate-90 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                  + {fmt(lockedAmount)} set aside
                </summary>
                <div className="mt-2 space-y-1.5 pl-1">
                  {cycleLocked > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30">
                      <p className="text-xs text-amber-700 dark:text-amber-400">{fmt(cycleLocked)} · In your savings plan (until it completes)</p>
                    </div>
                  )}
                  {groupLocked > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30">
                      <p className="text-xs text-amber-700 dark:text-amber-400">{fmt(groupLocked)} · In your group savings</p>
                    </div>
                  )}
                  {esusuLocked > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30">
                      <p className="text-xs text-amber-700 dark:text-amber-400">{fmt(esusuLocked)} · In your esusu rotation</p>
                    </div>
                  )}
                </div>
              </details>
            )}

            {hasTabs && (
              <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-700/50 rounded-xl mb-4">
                {[
                  { key: "personal", label: "Personal" },
                  ...(savingsGroups.length > 0 ? [{ key: "group", label: "Group Savings" }] : []),
                  ...(esusuRounds.length  > 0 ? [{ key: "esusu",  label: "Esusu" }] : []),
                ].map(tab => (
                  <button key={tab.key} type="button" onClick={() => { setActiveTab(tab.key); setError(""); }}
                    className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition ${
                      activeTab === tab.key
                        ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm"
                        : "text-slate-500 dark:text-slate-400"
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* ── Personal Savings tab ── */}
            {activeTab === "personal" && (
              <>
                {cycles.filter(cy => cy.status === "active").length > 0 && (
                  <div className="space-y-2 mb-4">
                    {cycles.filter(cy => cy.status === "active").map(cy => {
                      const isLocked = cy.commission_model === "first_period" &&
                        Number(cy.commission_balance || 0) >= Number(cy.expected_amount_per_period || 0) &&
                        Number(cy.expected_amount_per_period || 0) > 0;
                      // Per-cycle locked = SUM(contributions) - SUM(commissions) - SUM(registration_fees)
                      // ajo_approve_contribution stores all three row types with cycle_id, so we
                      // must subtract registration_fee or the locked figure is inflated by the reg charge.
                      const cycRows = contributions.filter(
                        c => c.cycle_id === cy.id && c.status === "completed" &&
                             (c.type === "contribution" || c.type === "commission" || c.type === "registration_fee")
                      );
                      const cycLocked = Math.max(
                        0,
                        cycRows.filter(c => c.type === "contribution"   ).reduce((s, c) => s + Number(c.amount || 0), 0) -
                        cycRows.filter(c => c.type === "commission"     ).reduce((s, c) => s + Number(c.amount || 0), 0) -
                        cycRows.filter(c => c.type === "registration_fee").reduce((s, c) => s + Number(c.amount || 0), 0)
                      );
                      return (
                        <div key={cy.id} className={`px-3.5 py-2.5 rounded-xl border ${isLocked ? "border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{cy.label || "Savings"}</p>
                              {isLocked && (
                                <p className="text-[11px] font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
                                  {fmt(cycLocked)} locked
                                </p>
                              )}
                            </div>
                            {isLocked
                              ? <span className="ml-2 shrink-0 text-[9px] font-extrabold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Locked</span>
                              : <span className="ml-2 shrink-0 text-[9px] font-extrabold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Available</span>
                            }
                          </div>
                          {isLocked && (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                              {cycLocked > 0
                                ? "Available to withdraw once your savings plan is complete"
                                : "Savings accumulate from your next deposit"}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {withdrawalForm}
              </>
            )}

            {/* ── Saving Group tab ── */}
            {activeTab === "group" && (() => {
              const grp = selectedGroup;
              if (!grp) return null;
              const rs     = grp.round_status || "not_started";
              const target = Number(grp.target_amount || 0);

              // My contribution total for this group in this round
              const myContribs = contributions.filter(c =>
                c.group_id === grp.id &&
                c.contribution_context === "group_savings" &&
                c.type === "contribution" &&
                c.status === "completed" &&
                (!grp.started_at || new Date(c.created_at) >= new Date(grp.started_at))
              );
              const myTotal = myContribs.reduce((s, c) => s + Number(c.amount), 0);

              // Pot = sum over ALL members — we don't have other members' contributions client-side,
              // so we derive from rotationsData (if present) or show only my contribution.
              // The owner's group detail page shows the full pot; client sees their share only.

              const daysLeft = grp.target_deadline
                ? Math.ceil((new Date(grp.target_deadline) - new Date()) / 86400000)
                : null;

              return (
                <>
                  {savingsGroups.length > 1 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Which savings group?</p>
                      <div className="space-y-1.5">
                        {savingsGroups.map(g => (
                          <button key={g.id} type="button" onClick={() => setSelectedGrpId(g.id)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left text-sm transition ${
                              (selectedGrpId || savingsGroups[0]?.id) === g.id
                                ? "border-[#16255A] bg-[#16255A]/5 dark:bg-[#16255A]/20 text-[#16255A] dark:text-blue-300"
                                : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                            }`}>
                            <span className="font-semibold">{g.name}</span>
                            {(selectedGrpId || savingsGroups[0]?.id) === g.id && (
                              <div className="w-3.5 h-3.5 rounded-full bg-[#16255A] flex-shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Status card */}
                  <div className="mb-4 space-y-3">
                    {/* Round status banner */}
                    {rs === "not_started" && (
                      <div className="px-3.5 py-3 rounded-xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10">
                        <p className="text-xs font-extrabold text-amber-700 dark:text-amber-400">Round not started yet</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">Your savings agent will set a target and start the round when the group is ready</p>
                      </div>
                    )}
                    {rs === "active" && target > 0 && (
                      <div className="px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Group target</p>
                          {daysLeft !== null && daysLeft >= 0 && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">{daysLeft} day{daysLeft !== 1 ? "s" : ""} left</span>
                          )}
                        </div>
                        <div className="h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${target > 0 && myTotal > 0 ? Math.min(100, Math.round((myTotal / target) * 100)) : 0}%` }} />
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">{fmt(myTotal)} saved</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">of {fmt(target)} target</p>
                        </div>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-amber-500 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">Locked until the round closes</p>
                        </div>
                      </div>
                    )}
                    {rs === "target_met" && (
                      <div className="px-3.5 py-3 rounded-xl border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/10">
                        <p className="text-xs font-extrabold text-blue-700 dark:text-blue-400">Target met — funds locked until group closes</p>
                        <p className="text-[10px] text-blue-600 dark:text-blue-500 mt-0.5">Your savings agent will close the group to release your {fmt(myTotal)}</p>
                      </div>
                    )}
                    {rs === "closed" && (
                      <div className="px-3.5 py-3 rounded-xl border border-green-200 dark:border-green-700/50 bg-green-50 dark:bg-green-900/10">
                        <p className="text-xs font-extrabold text-green-700 dark:text-green-400">Released — {fmt(myTotal)} available in your savings</p>
                        <p className="text-[10px] text-green-600 dark:text-green-500 mt-0.5">This group has closed. Your funds are now part of your withdrawable balance.</p>
                      </div>
                    )}

                    {/* My contribution stat */}
                    {rs !== "not_started" && (
                      <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">My contribution this round</p>
                        <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(myTotal)}</p>
                      </div>
                    )}
                  </div>

                  {(rs === "active" || rs === "closed" || rs === "target_met") && withdrawalForm}
                </>
              );
            })()}

            {/* ── Esusu Rotation tab ── */}
            {activeTab === "esusu" && (
              <div className="space-y-4">
                {esusuRounds.length === 0 && (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No active esusu round</p>
                )}
                {/* Bug 3 fix: show same esusuLocked source as the header hero number */}
                {locksLoaded && esusuLocked > 0 && (
                  <div className="flex items-center justify-between px-3 py-2.5 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-800/30 mb-1">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">Your locked amount in esusu</p>
                    <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">{fmt(esusuLocked)}</p>
                  </div>
                )}
                {esusuRounds.map(rd => {
                  const myTurn = (rd.turns || []).find(t => t.client_id === client.id);
                  const myTurnStatus = myTurn?.status;
                  const hasPaid = !!rd.contribution_ticks?.[client.id];
                  return (
                    <div key={rd.group?.id} className="space-y-3">
                      {esusuRounds.length > 1 && (
                        <p className="text-xs font-extrabold text-slate-600 dark:text-slate-300">{rd.group?.name}</p>
                      )}
                      {rd.round && (
                        <div className="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Round {rd.round.round_number}</p>
                            <span className="text-[9px] font-extrabold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Active</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Group pot (all members)</p>
                            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{fmt(rd.pot_size || 0)}</p>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Your contribution this period</p>
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${hasPaid ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"}`}>
                              {hasPaid ? "Paid" : "Pending"}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {(rd.turns || []).map(t => {
                          const isMe       = t.client_id === client.id;
                          const isPaid     = t.status === "paid";
                          const isCurrent  = t.status === "current";
                          const isSkipped  = t.status === "skipped";
                          return (
                            <div key={t.position} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border ${
                              isMe
                                ? "border-[#16255A]/30 bg-[#16255A]/5 dark:bg-[#16255A]/15 dark:border-[#16255A]/40"
                                : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30"
                            }`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-extrabold ${
                                isPaid    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                                : isCurrent ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
                                : isSkipped ? "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                              }`}>
                                {t.position}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-bold truncate ${isMe ? "text-[#16255A] dark:text-blue-300" : "text-slate-700 dark:text-slate-200"}`}>
                                  {t.client_name}{isMe ? " (you)" : ""}
                                </p>
                              </div>
                              <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                isPaid    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                                : isCurrent ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
                                : isSkipped ? "bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400"
                                : "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                              }`}>
                                {isPaid ? "Received" : isCurrent ? "Current" : isSkipped ? "Skipped" : "Upcoming"}
                              </span>
                            </div>
                          );
                        })}
                        {(rd.turns || []).length === 0 && !rd.round && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">No active round — your agent will start one when the group is ready</p>
                        )}
                      </div>
                      {myTurnStatus === "paid" && (
                        <div className="px-3.5 py-2.5 rounded-xl border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10">
                          <p className="text-xs font-bold text-green-700 dark:text-green-400">You have received your pot</p>
                          <p className="text-[10px] text-green-600 dark:text-green-500 mt-0.5">Your payout has been credited to your balance</p>
                        </div>
                      )}
                      {myTurnStatus === "current" && (
                        <div className="px-3.5 py-2.5 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/10">
                          <p className="text-xs font-bold text-[#16255A] dark:text-blue-300">It&apos;s your turn this period!</p>
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">Once all members contribute, the pot will be disbursed to your account by your savings agent</p>
                        </div>
                      )}
                      {myTurnStatus === "upcoming" && (
                        <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30">
                          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Your turn is coming</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Keep contributing each period — the pot will be yours when your turn arrives</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
    {txnPin && <AjoTxnPinModal {...txnPin} clientId={client?.id} onCancel={() => setTxnPin(null)} />}
    </>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ client, contributions, cycles = [], rotationsData = [], rotationLoading, onWithdrawClick, onPayClick, onDepositClick, ownerInfo, withdrawRequests = [], onBillsClick, userEmail, onGoToMe }) {
  const t = useT();
  const { lang } = useLanguage();
  const toast = useToast();

  const [goal,         setGoal]        = useState(0);
  const [editGoal,     setEditGoal]    = useState(false);
  const [goalInput,    setGoalInput]   = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);

  const [balanceHidden, setBalanceHidden] = useState(() =>
    sessionStorage.getItem("ajo_balance_hidden") === "1"
  );
  const [savingsDash, setSavingsDash] = useState(null); // { grp, myTotal, details:{loading,pot,members} }

  const openSavingsDash = async (grp, myTotal) => {
    setSavingsDash({ grp, myTotal, details: { loading: true, pot: 0, members: [] } });
    try {
      const data = await ajoFn("get-savings-group-details", { group_id: grp.id, client_id: client.id });
      setSavingsDash(prev =>
        prev?.grp?.id === grp.id
          ? { ...prev, details: { loading: false, pot: data.pot || 0, members: data.members || [] } }
          : prev
      );
    } catch {
      setSavingsDash(prev =>
        prev?.grp?.id === grp.id ? { ...prev, details: { loading: false, pot: 0, members: [] } } : prev
      );
    }
  };

  const [feeCardDismissed, setFeeCardDismissed] = useState(() =>
    !client?.id || localStorage.getItem("ajo_fee_intro_" + client.id) === "1"
  );
  const dismissFeeCard = () => {
    if (client?.id) localStorage.setItem("ajo_fee_intro_" + client.id, "1");
    setFeeCardDismissed(true);
  };
  const toggleBalance = () => {
    setBalanceHidden(h => {
      const next = !h;
      sessionStorage.setItem("ajo_balance_hidden", next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    if (!client?.id) return;
    ajoFn("get-goal", { client_id: client.id }).then(res => {
      if (res?.goal) setGoal(res.goal);
    }).catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  const nowKey      = new Date().toISOString().slice(0, 7);
  const prevKey     = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

  const totalThisMonth = contributions
    .filter(c => c.type === "contribution" && (c.created_at || "").startsWith(nowKey))
    .reduce((s, c) => s + (c.amount || 0), 0);
  const totalLastMonth = contributions
    .filter(c => c.type === "contribution" && (c.created_at || "").startsWith(prevKey))
    .reduce((s, c) => s + (c.amount || 0), 0);

  const streak = (() => {
    const months = [...new Set(
      contributions.filter(c => c.type === "contribution" && c.status === "confirmed")
        .map(c => c.created_at?.slice(0, 7)).filter(Boolean)
    )].sort().reverse();
    let s = 0;
    for (let i = 0; i < months.length; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      if (months[i] === d.toISOString().slice(0, 7)) s++; else break;
    }
    return s;
  })();

  const healthScore = (() => {
    if (!contributions.length) return 0;
    const confirmed = contributions.filter(c => c.type === "contribution" && c.status === "confirmed").length;
    return Math.min(
      Math.round((confirmed / Math.max(contributions.length, 1)) * 60) + Math.min(streak * 5, 30) + (client.current_balance > 0 ? 10 : 0),
      100
    );
  })();

  const avgMonthly  = totalThisMonth > 0 ? totalThisMonth : totalLastMonth;
  const monthsNeeded = avgMonthly > 0 && goal > 0
    ? (() => { const rem = Math.max(0, goal - (client.current_balance || 0)); return rem > 0 ? Math.ceil(rem / avgMonthly) : 0; })()
    : null;

  const insightData = streak >= 3
    ? { type: "fire", text: `${streak}-month savings streak — you're on a roll!` }
    : totalLastMonth > 0 && totalThisMonth > totalLastMonth
      ? { type: "up",   text: `You saved ${Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100)}% more than last month!` }
      : healthScore >= 80
        ? { type: "star", text: `Your savings health score is ${healthScore}/100 — excellent!` }
        : { type: "tip",  text: `${fmt(client.total_saved || 0)} deposited so far. Keep it up!` };

  const _now = new Date();
  const _todayStr = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
  const daysUntilDue = client.next_contribution_date
    ? Math.round(
        (new Date(client.next_contribution_date.slice(0,10) + "T00:00:00") -
         new Date(_todayStr + "T00:00:00")) / 86400000
      )
    : null;

  const recent = contributions.slice(0, 5);

  return (
    <div className="px-4 pt-5 pb-36 space-y-4">
      {/* Greeting */}
      <div>
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{greetingText(t)}</p>
        <h1 className="text-2xl font-black text-slate-800 dark:text-white leading-tight">
          {(client?.full_name || "").split(" ")[0] || "Member"} 👋
        </h1>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtLocaleDate(lang)}</p>
      </div>

      {/* AI insight chip — AMP-19: SVG icon, brand-tinted */}
      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/50 rounded-2xl px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center flex-shrink-0">
          {insightData.type === "fire" && (
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="#3DA829" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z" />
            </svg>
          )}
          {insightData.type === "up" && (
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="#3DA829" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
          )}
          {insightData.type === "star" && (
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="#3DA829" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
          {insightData.type === "tip" && (
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="#3DA829" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
        </div>
        <p className="text-[13px] font-semibold text-brand-700 dark:text-brand-200 leading-snug">{insightData.text}</p>
      </div>

      {/* Hero savings card — AMP-01 eye-toggle, AMP-11 FitText via AmountDisplay */}
      <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg bg-[linear-gradient(145deg,#16255A_0%,#1D3070_55%,#0F1A42_100%)]">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-6 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        {/* Eye toggle — AMP-01 */}
        <button onClick={toggleBalance} aria-label={balanceHidden ? "Show balance" : "Hide balance"}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:scale-90 transition-transform z-10">
          {balanceHidden
            ? <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white/70" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            : <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white/70" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
          }
        </button>
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Current Balance</p>
          {balanceHidden
            ? <p className="text-3xl font-black text-white/50 tracking-widest mb-3 leading-none select-none">₦ • • •</p>
            : <AmountDisplay amount={client.current_balance || 0} size="hero" align="left" className="text-white mb-3" />
          }
          <div className="flex items-center gap-2 mb-4">
            {streak > 0 && (
              <span className="bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1 text-[11px] font-bold text-white">
                🔥 {streak}mo streak
              </span>
            )}
            <span className="bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1 text-[11px] font-bold text-white">
              ⭐ {healthScore}/100
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Deposited</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={client.total_saved || 0} size="small" align="left" className="text-green-200" />
              }
            </div>
            <div className="px-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Withdrawn</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={client.total_withdrawn || 0} size="small" align="left" className="text-red-200" />
              }
            </div>
            <div className="pl-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">This Month</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={totalThisMonth} size="small" align="left" className="text-blue-200" />
              }
            </div>
          </div>
        </div>
      </div>

      {/* Status line — compact next-contribution status beneath hero */}
      {client.next_contribution_date && client.contribution_amount > 0 && (
        <div className={`flex items-center gap-1.5 text-[12px] font-semibold px-1 ${
          daysUntilDue != null && daysUntilDue < 0
            ? "text-red-500 dark:text-red-400"
            : daysUntilDue === 0
              ? "text-amber-500 dark:text-amber-400"
              : "text-slate-500 dark:text-slate-400"
        }`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>
            Next contribution: {balanceHidden ? "• • •" : fmt(client.contribution_amount)} &middot;{" "}
            {daysUntilDue != null && daysUntilDue < 0
              ? `${Math.abs(daysUntilDue)}d overdue`
              : daysUntilDue === 0 ? "due today"
              : daysUntilDue === 1 ? "due tomorrow"
              : `due in ${daysUntilDue}d`}
          </span>
        </div>
      )}

      {/* Quick Actions — AMP-08 Deposit elevated to primary grid slot */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 shadow-sm">
        <p className="text-sm font-extrabold text-slate-800 dark:text-white mb-4">Quick Actions</p>
        <div className={`grid gap-4 ${client?.contribution_amount > 0 ? "grid-cols-2" : "grid-cols-3"}`}>
          {client?.contribution_amount > 0 && (
            <ActionBtn
              label="Pay Contribution"
              icon="M1 4h22|M1 10h22|M3 20h18a1 1 0 001-1V5a1 1 0 00-1-1H3a1 1 0 00-1 1v14a1 1 0 001 1z"
              bg="bg-gradient-to-br from-brand-500 to-brand-600"
              onClick={onPayClick}
            />
          )}
          <ActionBtn
            label="Withdraw"
            icon="M12 19V5|M5 12l7 7 7-7"
            bg="bg-gradient-to-br from-brand-500 to-brand-600"
            onClick={onWithdrawClick}
          />
          <ActionBtn
            label="Make a Deposit"
            icon="M12 5v14|M5 12l7-7 7 7"
            bg="bg-gradient-to-br from-brand-500 to-brand-600"
            onClick={onDepositClick}
          />
          <ActionBtn
            label="Pay Bills"
            icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 13h6|M9 17h4"
            bg="bg-gradient-to-br from-blue-500 to-blue-600"
            onClick={onBillsClick}
          />
        </div>
      </div>

      {/* ── Personal Savings ── */}
      {cycles.length > 0 && (
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">
          Personal Savings
        </p>
      )}
      {cycles.map((cyc, idx) => (
        <ContributionCard
          key={cyc.id}
          cycle={cyc}
          contributions={contributions}
          frequency={client?.contribution_frequency}
          clientName={client?.full_name || ""}
          businessName={ownerInfo?.owner?.business_name || ""}
          registrationCharge={client?.registration_charge || 0}
          isLegacyCycle={idx === 0}
        />
      ))}

      {/* Cashback Balance */}
      <CashbackCard userEmail={userEmail} />

      {/* Quick Services */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-extrabold text-slate-800 dark:text-white">Quick Services</p>
          <button onClick={onBillsClick}
            className="text-[11px] text-brand-500 dark:text-brand-400 font-bold">View all</button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_SERVICES.map(s => (
            <button key={s.id} onClick={onBillsClick}
              className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
                style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {s.d.split("|").map((p, i) => <path key={i} d={p} />)}
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">{s.label}</span>
            </button>
          ))}
        </div>
      </div>


      {/* Assigned savings officer */}
      {ownerInfo?.staff && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-brand-100 dark:bg-brand-900/40 relative flex items-center justify-center flex-shrink-0 overflow-hidden border border-brand-100 dark:border-brand-800">
            <span className="text-brand-500 dark:text-brand-400 font-black text-lg">{(ownerInfo.staff.full_name || "?")[0].toUpperCase()}</span>
            {ownerInfo.staff.profile_image_url && <img src={ownerInfo.staff.profile_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-0.5">Your Savings Officer</p>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate leading-tight">{ownerInfo.staff.full_name}</p>
            {ownerInfo.staff.phone && <p className="text-[11px] text-slate-400 mt-0.5">{ownerInfo.staff.phone}</p>}
          </div>
          <span className="text-[9px] bg-brand-100 dark:bg-brand-900/30 text-brand-500 dark:text-brand-400 font-bold px-2 py-1 rounded-full capitalize flex-shrink-0">
            {ownerInfo.staff.role || "staff"}
          </span>
        </div>
      )}

      {/* Fee info card */}
      {((client.registration_charge > 0) || (client.commission_model && client.commission_model !== "none")) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-brand-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Fees</p>
            {client.commission_model === "percent" ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {client.ajo_group_id ? "Group withdrawal fee:" : "Withdrawal fee:"} <span className="text-brand-500 dark:text-brand-400 font-bold">{client.commission_percent || 0}% of amount</span>
              </p>
            ) : client.commission_model === "first_period" ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Fee: <span className="text-brand-500 dark:text-brand-400 font-bold">first contribution period per cycle</span>
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* One-time fee intro card — shown once per client, dismissed to localStorage */}
      {!feeCardDismissed && (
        <div className="bg-brand-500 rounded-2xl px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="white" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-white leading-tight">Here's how fees work on your savings</p>
              <p className="text-[11px] text-white/75 mt-0.5 leading-relaxed">See your registration fee, withdrawal charges, and full breakdown in My Fees.</p>
            </div>
            <button onClick={dismissFeeCard}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-white/20 flex-shrink-0 text-white font-bold text-base leading-none active:bg-white/30">
              ×
            </button>
          </div>
          <button onClick={() => { dismissFeeCard(); onGoToMe?.(); }}
            className="mt-3 w-full py-2 bg-white/20 rounded-xl text-sm font-bold text-white active:bg-white/30 transition">
            View My Fees →
          </button>
        </div>
      )}

      {/* Savings goal — AMP-22: ring + projected date + confirm-before-clear */}
      {(goal > 0 || editGoal) ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Savings Goal</p>
            {!editGoal && !clearConfirm && (
              <div className="flex items-center gap-3">
                <button onClick={() => setClearConfirm(true)}
                  className="text-[11px] text-red-400 dark:text-red-500 font-semibold">Clear</button>
                <button onClick={() => { setEditGoal(true); setGoalInput(String(goal)); }}
                  className="text-[11px] text-brand-500 dark:text-brand-400 font-bold">Edit</button>
              </div>
            )}
          </div>

          {clearConfirm && (
            <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-3 mb-3 space-y-2">
              <p className="text-xs font-extrabold text-amber-700 dark:text-amber-400">Remove savings goal?</p>
              <p className="text-[11px] text-amber-600 dark:text-amber-500">Your balance stays — only the target is cleared.</p>
              <div className="flex gap-2">
                <button onClick={() => setClearConfirm(false)}
                  className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold">
                  Keep it
                </button>
                <button onClick={async () => {
                  setClearConfirm(false); setGoal(0);
                  try {
                    await ajoFn("delete-goal", { client_id: client.id });
                  } catch (e) {
                    toast({ type: "error", title: "Couldn't clear goal — try again", body: e?.message });
                    setGoal(prev => prev); // revert optimistic
                  }
                }} className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold">
                  Clear Goal
                </button>
              </div>
            </div>
          )}

          {editGoal ? (
            <div className="flex gap-2">
              <input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                placeholder="Target amount (₦)"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button onClick={async () => {
                const g = parseFloat(goalInput) || 0;
                if (g > 0) {
                  const prev = goal;
                  setGoal(g); setEditGoal(false);
                  try {
                    await ajoFn("set-goal", { client_id: client.id, target_amount: g });
                    toast({ type: "success", title: `Savings goal set — ${fmt(g)}` });
                  } catch (e) {
                    toast({ type: "error", title: "Couldn't save goal — try again", body: e?.message });
                    setGoal(prev);
                  }
                } else {
                  setEditGoal(false);
                }
              }} className="px-3 py-2 bg-brand-500 text-white rounded-xl text-sm font-bold">Save</button>
              <button onClick={() => setEditGoal(false)}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl text-sm font-bold">✕</button>
            </div>
          ) : (() => {
            const pct = Math.min(((client.current_balance || 0) / goal) * 100, 100);
            const R = 40; const C = 2 * Math.PI * R;
            return (
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0 w-[88px] h-[88px]">
                  <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="44" cy="44" r={R} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-700" />
                    <circle cx="44" cy="44" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
                      className="stroke-brand-500 transition-all duration-700"
                      strokeDasharray={C} strokeDashoffset={C - (pct / 100) * C} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[14px] font-black text-slate-800 dark:text-white leading-none">
                      {Math.round(pct)}%
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold">Saved</p>
                  <p className="text-base font-extrabold text-slate-800 dark:text-white leading-tight">{fmt(client.current_balance || 0)}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">of {fmt(goal)}</p>
                  {monthsNeeded != null && monthsNeeded > 0 && (
                    <p className="text-[11px] text-brand-500 dark:text-brand-400 font-semibold mt-1">
                      Est. {(() => {
                        const d = new Date(); d.setMonth(d.getMonth() + monthsNeeded);
                        return d.toLocaleDateString("en-NG", { month: "short", year: "numeric" });
                      })()}
                    </p>
                  )}
                  {pct >= 100 && (
                    <div className="flex items-center gap-1 mt-1">
                      <svg viewBox="0 0 24 24" fill="none" width="11" height="11" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      <p className="text-[11px] text-green-500 font-bold">Goal reached!</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <button onClick={() => setEditGoal(true)}
          className="w-full py-3 border-2 border-dashed border-brand-200 dark:border-brand-800/50 rounded-2xl text-sm font-semibold text-brand-500 dark:text-brand-400 flex items-center justify-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          Set a Savings Goal
        </button>
      )}

      {/* Pending withdrawal requests */}
      {withdrawRequests.filter(r => r.status === "pending").length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Pending Requests</p>
          <div className="space-y-2">
            {withdrawRequests.filter(r => r.status === "pending").map(r => (
              <div key={r.id} className="bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-3 border border-amber-200 dark:border-amber-800/60 flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-500" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Pending Review</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{fmtDate(r.requested_at)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">{fmt(r.amount)}</p>
                  <p className="text-[10px] text-green-600 dark:text-green-400">→ {fmt(r.net_amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Esusu Rotation groups ── */}
      {rotationsData.filter(rd => rd.group?.group_mode === "rotating").length > 0 && (
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1 mt-2">
          Esusu Rotation
        </p>
      )}
      {rotationLoading && rotationsData.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 animate-pulse h-24" />
      )}
      {rotationsData.filter(rd => rd.group?.group_mode === "rotating").map(rd => (
        <div key={rd.group?.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{rd.group?.name}</p>
          {rd.round ? (
            <EsusuRotationDashboard
              data={rd}
              loading={false}
              isOwner={false}
              myClientId={client?.id}
              onRefresh={null}
            />
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">No active rotation round yet.</p>
          )}
        </div>
      ))}

      {/* ── Savings Groups ── */}
      {rotationsData.filter(rd => rd.group?.group_mode !== "rotating").length > 0 && (
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1 mt-2">
          Savings Groups
        </p>
      )}
      {rotationsData.filter(rd => rd.group?.group_mode !== "rotating").map(rd => {
        const grp = rd.group;
        if (!grp) return null;
        const rs     = grp.round_status || "not_started";
        const target = Number(grp.target_amount || 0);
        const myContribs = contributions.filter(c =>
          c.group_id === grp.id &&
          c.contribution_context === "group_savings" &&
          c.type === "contribution" &&
          c.status === "completed" &&
          (!grp.started_at || new Date(c.created_at) >= new Date(grp.started_at))
        );
        const myTotal  = myContribs.reduce((s, c) => s + Number(c.amount), 0);
        const pct      = target > 0 ? Math.min(100, Math.round((myTotal / target) * 100)) : 0;
        const daysLeft = grp.target_deadline
          ? Math.ceil((new Date(grp.target_deadline) - new Date()) / 86400000)
          : null;
        const statusMap = {
          not_started: { label: "Not started", pill: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
          active:      { label: "Active",      pill: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
          target_met:  { label: "Target met",  pill: "bg-blue-100  dark:bg-blue-900/30  text-blue-700  dark:text-blue-400"  },
          closed:      { label: "Closed",      pill: "bg-slate-100 dark:bg-slate-700    text-slate-500 dark:text-slate-400" },
        };
        const st = statusMap[rs] || statusMap.not_started;
        return (
          <div key={grp.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-snug">{grp.name}</p>
              <span className={`shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ${st.pill}`}>
                {st.label}
              </span>
            </div>

            {/* Progress block — active or target met */}
            {(rs === "active" || rs === "target_met") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
                  <span>My contribution this round</span>
                  {daysLeft !== null && (
                    <span className={daysLeft < 0 ? "text-red-500" : ""}>
                      {daysLeft < 0 ? "Deadline passed" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`}
                    </span>
                  )}
                </div>
                {target > 0 && (
                  <>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${rs === "target_met" ? "bg-blue-500" : "bg-green-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(myTotal)}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">of {fmt(target)} target · {pct}%</p>
                    </div>
                  </>
                )}
                {target === 0 && (
                  <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(myTotal)} saved</p>
                )}
                {rs === "active" && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-amber-500 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Locked until the round closes</p>
                  </div>
                )}
                {rs === "target_met" && (
                  <p className="text-[10px] text-blue-600 dark:text-blue-400">Target reached — waiting for your savings agent to close the group</p>
                )}
              </div>
            )}

            {/* Not started */}
            {rs === "not_started" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Waiting for your savings agent to start the round
              </p>
            )}

            {/* Closed */}
            {rs === "closed" && (
              <p className="text-[11px] text-green-600 dark:text-green-400">
                {myTotal > 0 ? `${fmt(myTotal)} released to your balance` : "This round has closed"}
              </p>
            )}

            {/* Contribution frequency */}
            {Number(grp.contribution_amount) > 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-0.5 border-t border-slate-100 dark:border-slate-700">
                {fmt(grp.contribution_amount)} / {grp.contribution_frequency || "period"}
              </p>
            )}

            {/* Dashboard entry */}
            <button
              type="button"
              onClick={() => openSavingsDash(grp, myTotal)}
              className="w-full pt-2 pb-0.5 flex items-center justify-center gap-1.5 text-[11px] font-bold text-brand-600 dark:text-brand-400 active:opacity-70 transition">
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
              </svg>
              View Group Dashboard
            </button>
          </div>
        );
      })}

      {/* ── Savings group dashboard overlay ── */}
      {savingsDash && (() => {
        const { grp, myTotal, details } = savingsDash;
        const rs       = grp.round_status || "not_started";
        const target   = Number(grp.target_amount || 0);
        const pot      = details.pot || 0;
        const pct      = target > 0 ? Math.min(100, (pot / target) * 100) : 0;
        const myPct    = pot > 0 ? Math.round((myTotal / pot) * 100) : 0;
        const daysLeft = grp.target_deadline
          ? Math.ceil((new Date(grp.target_deadline) - new Date()) / 86400000)
          : null;
        const sortedMembers = [...(details.members || [])].sort((a, b) => (b.contributed || 0) - (a.contributed || 0));
        const maxContrib    = Math.max(...sortedMembers.map(m => m.contributed || 0), 1);
        const statusMap = {
          not_started: { label: "Not Started",  pill: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400" },
          active:      { label: "Active",        pill: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" },
          target_met:  { label: "Target Met ✓",  pill: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" },
          closed:      { label: "Closed",        pill: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400" },
        };
        const st = statusMap[rs] || statusMap.not_started;
        return (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "92dvh" }}>
              {/* Header */}
              <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                <button type="button" onClick={() => setSavingsDash(null)}
                  className="w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 transition">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-slate-800 dark:text-white text-sm truncate">{grp.name}</p>
                  <span className={`inline-block text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide mt-0.5 ${st.pill}`}>{st.label}</span>
                </div>
                <button type="button" onClick={() => setSavingsDash(null)}
                  className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {details.loading ? (
                  <div className="flex justify-center py-12">
                    <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Hero */}
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-700 dark:to-slate-800 rounded-2xl p-5 text-white">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Group Total Saved</p>
                      <p className="text-3xl font-extrabold tabular-nums leading-none">{fmt(pot)}</p>
                      {target > 0 && (
                        <p className="text-[11px] text-slate-400 mt-1">of {fmt(target)} target · <span className="text-white font-bold">{Math.round(pct)}%</span></p>
                      )}
                      <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">My Contribution</p>
                          <p className="text-base font-extrabold tabular-nums">{fmt(myTotal)}</p>
                        </div>
                        {pot > 0 && (
                          <span className="text-[10px] font-bold text-slate-300 bg-white/10 px-2 py-1 rounded-full">{myPct}% of pot</span>
                        )}
                      </div>
                      {rs === "active" && daysLeft !== null && daysLeft >= 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                          <span className="text-[10px] text-green-400 font-bold">{daysLeft} days remaining</span>
                        </div>
                      )}
                      {daysLeft !== null && daysLeft < 0 && (rs === "active" || rs === "target_met") && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <span className="text-[10px] text-amber-400 font-bold">Deadline passed</span>
                        </div>
                      )}
                    </div>

                    {/* Progress bar */}
                    {target > 0 && (
                      <div>
                        <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${rs === "target_met" ? "bg-gradient-to-r from-blue-400 to-blue-600" : "bg-gradient-to-r from-green-400 to-green-600"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{fmt(pot)} raised</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{fmt(Math.max(0, target - pot))} to go</span>
                        </div>
                      </div>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Members",      value: String(sortedMembers.length) },
                        { label: "Days Left",    value: daysLeft !== null ? (daysLeft >= 0 ? `${daysLeft}d` : "Overdue") : "—" },
                        { label: "Contribution", value: grp.contribution_amount ? fmt(grp.contribution_amount) : "—" },
                        { label: "Frequency",    value: grp.contribution_frequency || "—" },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700">
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
                          <p className="text-sm font-extrabold text-slate-800 dark:text-white mt-0.5 capitalize tabular-nums">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Saving strength */}
                    {sortedMembers.length > 0 && (
                      <div>
                        <p className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Saving Strength</p>
                        <div className="space-y-2">
                          {sortedMembers.map((m, idx) => {
                            const contributed = m.contributed ?? null;
                            const barPct   = contributed !== null && maxContrib > 0 ? (contributed / maxContrib) * 100 : 0;
                            const sharePct = contributed !== null && pot > 0 ? Math.round((contributed / pot) * 100) : null;
                            const barColor = idx === 0
                              ? "bg-gradient-to-r from-amber-400 to-amber-500"
                              : m.is_me
                                ? "bg-gradient-to-r from-brand-400 to-brand-600"
                                : "bg-gradient-to-r from-green-400 to-green-500";
                            return (
                              <div key={m.client_id} className={`rounded-xl px-3 py-2.5 border ${m.is_me ? "bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700"}`}>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 tabular-nums flex-shrink-0 w-5">#{idx + 1}</span>
                                    <p className={`text-[11px] font-extrabold truncate ${m.is_me ? "text-brand-700 dark:text-brand-300" : "text-slate-800 dark:text-white"}`}>
                                      {m.full_name}{m.is_me ? " (You)" : ""}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {contributed !== null ? (
                                      <span className="text-[10px] font-extrabold text-slate-600 dark:text-slate-300 tabular-nums">{fmt(contributed)}</span>
                                    ) : (
                                      <span className="text-[10px] text-slate-400">Hidden</span>
                                    )}
                                    {sharePct !== null && (
                                      <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{sharePct}%</span>
                                    )}
                                  </div>
                                </div>
                                {contributed !== null && (
                                  <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${barPct}%` }} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {grp.started_at && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                        Round started {new Date(grp.started_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    )}
                    <div className="h-4" />
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Activity calendar (always shown) */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700">
        <ContribCalendar contributions={contributions} />
      </div>

      {/* Recent activity — green in / navy out / amber pending */}
      {recent.length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Recent Activity</p>
          <div className="space-y-2">
            {recent.map(c => {
              const isCredit  = c.type === "contribution" || c.type === "esusu_payout";
              const isPending = c.status === "pending";
              const dotCls    = isPending ? "bg-amber-400" : isCredit ? "bg-green-500" : "bg-navy dark:bg-slate-400";
              const amtCls    = isPending ? "text-amber-500 dark:text-amber-400" : isCredit ? "text-green-600 dark:text-green-400" : "text-navy dark:text-slate-200";
              return (
                <div key={c.id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-3 border border-slate-100 dark:border-slate-700">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{ledgerTypeLabel(c)}</p>
                    <p className="text-[10px] text-slate-400">{fmtDate(c.created_at)} &middot; {c.payment_method || "cash"}</p>
                  </div>
                  <span className={`text-sm font-extrabold tabular flex-shrink-0 ${amtCls}`}>
                    {isCredit ? "+" : "−"}{balanceHidden ? "• • •" : fmt(c.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pending info sheet (AMP-07) ───────────────────────────────────────────
function PendingInfoSheet({ item, onClose }) {
  const isPendingManual = item.payment_method === "manual_transfer";
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-amber-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-slate-800 dark:text-white">Pending Confirmation</p>
            <p className="text-[11px] text-slate-400">{fmtDateTime(item.created_at || item.date)}</p>
          </div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 mb-4">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">
            {isPendingManual ? "Awaiting bank transfer verification" : "Awaiting approval"}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
            {isPendingManual
              ? "Your savings agent will verify the bank transfer you submitted. This usually takes a few hours during business days."
              : "Your savings agent will review and confirm this entry. You'll be notified by email once it's approved."}
          </p>
        </div>
        <div className="space-y-2 mb-5">
          {[
            { label: "Amount", value: fmt(item.amount) },
            { label: "Type",   value: ledgerTypeLabel(item) },
            item.payment_method && { label: "Method", value: item.payment_method.replace(/_/g, " ") },
            (item.claim_notes || item.notes) && { label: "Note", value: item.claim_notes || item.notes },
          ].filter(Boolean).map(row => (
            <div key={row.label} className="flex justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">{row.label}</span>
              <span className="font-bold text-slate-700 dark:text-slate-200 text-right max-w-[60%] truncate capitalize">{row.value}</span>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="w-full py-3.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-sm active:scale-[0.99] transition">
          Close
        </button>
      </div>
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────
function HistoryTab({ contributions, withdrawRequests = [], client, ownerInfo, cycles = [], rotationsData = [] }) {
  // Build lookup maps so each row can show its entity name
  const cycleNameMap = Object.fromEntries(cycles.map(c => [c.id, c.label || "Personal Savings"]));
  const groupNameMap = Object.fromEntries(
    rotationsData.filter(rd => rd.group?.id).map(rd => [rd.group.id, rd.group.name])
  );
  const [typeFilter,     setTypeFilter]     = useState("all");
  const [receipt,        setReceipt]        = useState(null);
  const [pendingSheet,   setPendingSheet]   = useState(null);
  const [disputeFor,     setDisputeFor]     = useState(null);
  const [disputeDesc,    setDisputeDesc]    = useState("");
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError,   setDisputeError]   = useState("");
  const [disputedIds,    setDisputedIds]    = useState(() => new Set());
  const toast = useToast();

  const withdrawItems = withdrawRequests.map(r => ({
    _type: "withdrawal_request",
    id: r.id, amount: r.amount, net_amount: r.net_amount,
    fee_amount: r.fee_amount, fee_type: r.fee_type,
    status: r.status, date: r.requested_at,
  }));
  const contribItems = contributions.map(c => ({ _type: "contribution", ...c, date: c.created_at }));
  const allItems = [...withdrawItems, ...contribItems].sort((a, b) => new Date(b.date) - new Date(a.date));

  const reversedIdSet = new Set(
    contributions
      .filter(c => c.type?.startsWith("reversal_") && c.reverses_contribution_id)
      .map(c => c.reverses_contribution_id)
  );

  const FILTERS = [
    { id: "all",         label: "All" },
    { id: "deposits",    label: "Deposits" },
    { id: "withdrawals", label: "Withdrawals" },
    { id: "fees",        label: "Fees" },
  ];

  const filtered = allItems.filter(item => {
    if (typeFilter === "deposits")    return item._type === "contribution" && (item.type === "contribution" || item.type === "esusu_payout");
    if (typeFilter === "withdrawals") return item._type === "withdrawal_request" || item.type === "withdrawal";
    if (typeFilter === "fees")        return item._type === "contribution" && (item.type === "withdrawal_fee" || item.type === "registration_fee" || item.type === "commission");
    return true;
  });

  // Group filtered list by calendar month, preserving desc order within each month
  const months = [];
  const monthMap = {};
  filtered.forEach(item => {
    const d   = new Date(item.date);
    const key = isNaN(d) ? "Unknown" : d.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
    if (!monthMap[key]) { monthMap[key] = []; months.push(key); }
    monthMap[key].push(item);
  });

  const statusCls = (s) => {
    if (s === "completed" || s === "approved") return "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400";
    if (s === "rejected")                      return "bg-red-50 dark:bg-red-900/20 text-red-500";
    if (s === "held_24h")                      return "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400";
    return "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400";
  };

  const bizName = ownerInfo?.owner?.business_name || ownerInfo?.business_name || ownerInfo?.full_name || "My Business";

  if (!allItems.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 bg-brand-50 dark:bg-brand-900/20 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-brand-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" />
          </svg>
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No history yet</p>
        <p className="text-slate-400 text-xs mt-1">Your contributions and withdrawal requests will appear here</p>
      </div>
    );
  }

  const handleExportPdf = async () => {
    const sorted = [...allItems].sort((a, b) => new Date(a.date || a.created_at || 0) - new Date(b.date || b.created_at || 0));
    let runBal = 0;
    const rows = sorted.map(item => {
      const amt     = parseFloat(item.amount) || 0;
      const isWdReq = item._type === "withdrawal_request";
      const isFee   = item.type === "withdrawal_fee" || item.type === "registration_fee";
      const isWd    = !isWdReq && (item.type === "withdrawal" || isFee || item.type === "commission" || (item.type || "").startsWith("reversal_"));
      const desc    = isWdReq ? "Withdrawal Request (Pending)" : ledgerTypeLabel(item);
      if (!isWdReq) { if (isWd) runBal -= amt; else runBal += amt; }
      return {
        date:        pdfFmtDate(item.created_at || item.date),
        description: desc,
        reference:   item.payment_method || item.status || "—",
        debit:       isWd || isWdReq ? pdfFmt(amt) : "",
        credit:      isWd || isWdReq ? "" : pdfFmt(amt),
        balance:     pdfFmt(runBal),
      };
    });
    const totC = contributions.filter(c => c.type === "contribution").reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    const totD = withdrawRequests.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const pdf = await createReportPdf({
      title: "Ajo Savings Statement", businessName: bizName,
      period: client?.full_name || "Member",
      headerRight: [
        { value: bizName },
        client?.full_name       ? { value: client.full_name,     sub: true } : null,
        ownerInfo?.staff?.phone ? { value: ownerInfo.staff.phone, sub: true } : null,
      ].filter(Boolean),
      entityDetails: [
        { label: "Member",          value: client?.full_name || "—" },
        { label: "Current Balance", value: pdfFmt(client?.current_balance || 0) },
        { label: "Total Deposited",  value: pdfFmt(client?.total_saved || totC) },
        { label: "Records",         value: String(allItems.length) },
      ],
    });
    pdf.addStats([
      { label: "Total Contributed", value: pdfFmt(totC), color: "#3DA829" },
      { label: "Total Withdrawn",   value: pdfFmt(totD), color: "#ef4444" },
      { label: "Current Balance",   value: pdfFmt(client?.current_balance || 0) },
      { label: "Records",           value: String(allItems.length) },
    ]);
    pdf.addStatement(rows, { openingBalance: 0, totalDebits: totD, totalCredits: totC });

    // Per-cycle period status
    const statementCycles = cycles.filter(c => c.status === "active" || c.status === "completed");
    if (statementCycles.length > 0) {
      const PERIOD_STATUS_LABELS = {
        paid: "Paid", paid_in_advance: "Paid ahead", partial: "Partial",
        pending: "Pending", missed: "Missed", current: "Current",
        upcoming: "Upcoming", collector: "Collector's",
      };
      const FREQ_COLS_PDF = { daily: 7, weekly: 5, monthly: 4 };
      pdf.addSectionTitle("Period Status by Cycle");
      statementCycles.forEach(cyc => {
        const cycContribs = contributions.filter(c => c.cycle_id === cyc.id);
        const freq = cyc.frequency || cyc.contribution_frequency || "monthly";
        const { periods: cyPeriods } = allocatePeriods(cyc, cycContribs, contributions);
        pdf.addGrid(cyPeriods, FREQ_COLS_PDF[freq] || 4);
        const pRows = cyPeriods.map(p => ({
          period: `#${p.idx + 1}`,
          paid:   pdfFmt(p.paid),
          status: PERIOD_STATUS_LABELS[p.status] || p.status,
        }));
        pdf.addTable(
          [
            { key: "period", label: "Period", w: 0.20 },
            { key: "paid",   label: "Paid",   w: 0.30, right: true },
            { key: "status", label: "Status", w: 0.50 },
          ],
          pRows
        );
      });
    }

    await pdf.save(`Ajo_Savings_${(client?.full_name || "Statement").replace(/\s+/g, "_")}.pdf`);
  };

  const renderItem = (item) => {
    const isWdReq    = item._type === "withdrawal_request";
    const isPending  = item.status === "pending";
    const isHeld24h  = item.status === "held_24h";
    const isReversal = item.type?.startsWith("reversal_");
    const isReversed = reversedIdSet.has(item.id);
    const isManual   = item.payment_method === "manual_transfer";
    const isRejected = item.status === "rejected";
    // Credits: contribution, esusu_payout, reversal_withdrawal*
    const isCredit   = !isWdReq && (
      item.type === "contribution" || item.type === "esusu_payout" ||
      item.type === "reversal_withdrawal" || item.type === "reversal_withdrawal_fee" || item.type === "reversal_registration_fee"
    );
    const sign = isCredit ? "+" : "−";

    const cardCls = isPending
      ? "bg-amber-50/70 dark:bg-amber-900/10 border-amber-200/70 dark:border-amber-800/40"
      : isRejected && isManual
        ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/60"
        : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700";

    const amtCls = isReversed  ? "line-through text-slate-400 dark:text-slate-500"
      : isReversal             ? "text-amber-600 dark:text-amber-400"
      : isPending              ? "text-amber-500 dark:text-amber-400"
      : isCredit               ? "text-green-600 dark:text-green-400"
      : "text-red-500 dark:text-red-400";

    const iconBg  = isReversal || isPending ? "bg-amber-100 dark:bg-amber-900/30"
      : isCredit ? "bg-green-50 dark:bg-green-900/20"
      : "bg-red-50 dark:bg-red-900/20";
    const iconCls = isReversal || isPending ? "text-amber-500 dark:text-amber-400"
      : isCredit ? "text-green-600 dark:text-green-400"
      : "text-red-500 dark:text-red-400";

    const handleTap = () => {
      if (isPending && !isWdReq) { setPendingSheet(item); return; }
      setReceipt(isWdReq ? { ...item, type: "withdrawal" } : item);
    };

    return (
      <button key={`${item._type}-${item.id}`} onClick={handleTap}
        className={`w-full text-left rounded-2xl px-4 py-3 border active:scale-[0.98] transition-transform ${cardCls}`}>
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
            {isReversal ? (
              <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${iconCls}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>
              </svg>
            ) : isCredit ? (
              <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${iconCls}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 5v14M5 12l7-7 7 7"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${iconCls}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 19V5M5 12l7 7 7-7"/>
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-xs font-semibold min-w-0 truncate ${isReversed ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200"}`}>
                {isWdReq ? "Withdrawal Request" : ledgerTypeLabel(item)}
              </p>
              <span className={`text-sm font-extrabold tabular flex-shrink-0 ${amtCls}`}>
                {sign}{fmt(item.amount)}
              </span>
            </div>
            {/* Status / badge row */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {isPending && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Pending · tap for info</span>}
              {isHeld24h && <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-1.5 py-0.5 rounded-full">Under review for your security — up to 24h</span>}
              {isReversed && <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full">Reversed</span>}
              {!isPending && !isHeld24h && !isReversed && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${statusCls(item.status)}`}>{item.status || "—"}</span>}
              {isWdReq && item.net_amount != null && <span className="text-[10px] text-slate-400 dark:text-slate-500">Net: {fmt(item.net_amount)}</span>}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {isManual ? "Bank transfer" : (item.payment_method || (isWdReq ? "withdrawal" : "cash"))}
              {item.paystack_ref && ` · Ref: ${item.paystack_ref.slice(-8)}`}
            </p>
            <p className="text-[10px] text-slate-400">{fmtDateTime(item.created_at || item.date)}</p>
            {!isWdReq && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                {item.cycle_id
                  ? (cycleNameMap[item.cycle_id] || "Personal Savings")
                  : item.group_id
                    ? (groupNameMap[item.group_id] || "Group")
                    : "Personal Savings"}
              </p>
            )}
            {(item.claim_notes || item.notes) && <p className="text-[10px] text-slate-400 italic mt-0.5">"{item.claim_notes || item.notes}"</p>}
            {isRejected && isManual && item.rejected_reason && (
              <p className="text-[10px] text-red-500 dark:text-red-400 mt-1 font-semibold">Reason: {item.rejected_reason}</p>
            )}
            {(item.dispute_ticket_no || disputedIds.has(item.id)) ? (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-semibold">
                Dispute filed{item.dispute_ticket_no ? ` · ${item.dispute_ticket_no}` : ""}
              </p>
            ) : (!isPending && item._type === "contribution" && (
              <button onClick={e => { e.stopPropagation(); setDisputeFor(item); setDisputeDesc(""); setDisputeError(""); }}
                className="text-[10px] text-slate-400 hover:text-red-500 dark:hover:text-red-400 mt-1 underline text-left">
                Report an issue
              </button>
            ))}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="px-4 pt-5 pb-36">
      {receipt && (
        <TransactionDetailModal
          data={
            receipt._type === "withdrawal_request"
              ? buildAjoWithdrawalReceipt(receipt, client?.full_name || "", bizName)
              : buildAjoContributionReceipt(receipt, client?.full_name || "", bizName)
          }
          onClose={() => setReceipt(null)}
        />
      )}

      {pendingSheet && (
        <PendingInfoSheet item={pendingSheet} onClose={() => setPendingSheet(null)} />
      )}

      {/* Filter chips + PDF export */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                typeFilter === f.id ? "bg-brand-500 text-white shadow-sm" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {allItems.length > 0 && (
          <button onClick={handleExportPdf}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 active:scale-95 transition ml-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
            </svg>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300">PDF</span>
          </button>
        )}
      </div>

      {/* Month-grouped rows */}
      {filtered.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-slate-400 dark:text-slate-500">No {typeFilter === "all" ? "transactions" : typeFilter} to show</p>
        </div>
      ) : (
        months.map(month => (
          <div key={month} className="mb-5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2.5 px-1">{month}</p>
            <div className="space-y-2">
              {monthMap[month].map(item => renderItem(item))}
            </div>
          </div>
        ))
      )}

      {/* Dispute modal */}
      {disputeFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-xl max-h-[80dvh] overflow-y-auto">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-1">Report an Issue</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              {fmtDate(disputeFor.created_at)} · {disputeFor.type === "contribution" ? "+" : "−"}{fmt(disputeFor.amount)}
            </p>
            <textarea
              value={disputeDesc}
              onChange={e => setDisputeDesc(e.target.value)}
              placeholder="Describe the issue (optional)…"
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-3"
            />
            {disputeError && (
              <p className="text-xs text-red-500 dark:text-red-400 mb-3">{disputeError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setDisputeFor(null); setDisputeError(""); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-500 dark:text-slate-400">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDisputeLoading(true);
                  setDisputeError("");
                  try {
                    await ajoFn("submit-dispute", {
                      client_id:       client.id,
                      owner_id:        client.user_id,
                      contribution_id: disputeFor.id,
                      description:     disputeDesc,
                    });
                    setDisputedIds(prev => new Set([...prev, disputeFor.id]));
                    setDisputeFor(null);
                    toast({ title: "Dispute submitted — we'll review your case", type: "success" });
                  } catch (err) {
                    setDisputeError(friendlyError(err));
                  } finally {
                    setDisputeLoading(false);
                  }
                }}
                disabled={disputeLoading}
                className="flex-1 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50">
                {disputeLoading ? "Submitting…" : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Me tab (Staff Portal structure) ───────────────────────────────────────
function AjoMemberMe({ client, session, clientId, pinLock, onChangePwdClick, onProfileUpdate, contributions = [], cycles = [] }) {
  const [view,           setView]           = useState("menu");
  const [editForm,       setEditForm]       = useState({
    full_name:      client?.full_name || "",
    phone:          client?.phone     || "",
    email:          client?.email     || session?.user?.email || "",
    address:        client?.address   || "",
    state:          client?.state     || "",
    lga:            client?.lga       || "",
    ward:           client?.ward      || "",
    nin:            client?.nin       || "",
    nok_name:       client?.next_of_kin_name    || "",
    nok_phone:      client?.next_of_kin_phone   || "",
    nok_email:      client?.next_of_kin_email   || "",
    nok_addr:       client?.next_of_kin_address || "",
    bank_code:      client?.bank_code      || "",
    account_number: client?.account_number || "",
    account_name:   client?.account_name   || "",
    bank_name:      client?.bank_name      || "",
  });
  // Keep editForm in sync when client data loads after initial mount
  const prevClientRef = useRef(client);
  useEffect(() => {
    if (client && client !== prevClientRef.current) {
      prevClientRef.current = client;
      setEditForm(f => ({
        full_name:      f.full_name      || client.full_name || "",
        phone:          f.phone          || client.phone     || "",
        email:          f.email          || client.email     || session?.user?.email || "",
        address:        f.address        || client.address   || "",
        state:          f.state          || client.state     || "",
        lga:            f.lga            || client.lga       || "",
        ward:           f.ward           || client.ward      || "",
        nin:            f.nin            || client.nin       || "",
        nok_name:       f.nok_name       || client.next_of_kin_name    || "",
        nok_phone:      f.nok_phone      || client.next_of_kin_phone   || "",
        nok_email:      f.nok_email      || client.next_of_kin_email   || "",
        nok_addr:       f.nok_addr       || client.next_of_kin_address || "",
        bank_code:      f.bank_code      || client.bank_code      || "",
        account_number: f.account_number || client.account_number || "",
        account_name:   f.account_name   || client.account_name   || "",
        bank_name:      f.bank_name      || client.bank_name      || "",
      }));
    }
  }, [client, session?.user?.email]);
  const [photoFile,      setPhotoFile]      = useState(null);
  const [photoPreview,   setPhotoPreview]   = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState("");
  const [lightboxOpen,   setLightboxOpen]   = useState(false);
  const [lbZoom,         setLbZoom]         = useState(1);
  const [lbPinchDist,    setLbPinchDist]    = useState(null);
  const [pendingEmail,      setPendingEmail]      = useState(null);
  const [emailOtp,          setEmailOtp]          = useState("");
  const [otpSending,        setOtpSending]        = useState(false);
  const [otpError,          setOtpError]          = useState("");
  const [pendingPhone,      setPendingPhone]      = useState(null);
  const [phoneOtp,          setPhoneOtp]          = useState("");
  const [phoneOtpSending,   setPhoneOtpSending]   = useState(false);
  const [phoneOtpError,     setPhoneOtpError]     = useState("");
  const [lockBusy,       setLockBusy]       = useState(false);
  const [showPinSetup,   setShowPinSetup]   = useState(false);
  const [isDark,         setIsDark]         = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [faqTab,         setFaqTab]         = useState("faq");
  const [faqSearch,      setFaqSearch]      = useState("");
  const [aiAnswer,       setAiAnswer]       = useState("");
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState("");
  const fileRef = useRef(null);

  const phoneRegex = /^(\+?234|0)[7-9][01]\d{8}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ── Security section state ────────────────────────────────────────────
  const [secView,      setSecView]      = useState(null); // null | "app-pin" | "txn-pin"
  const [secStep,      setSecStep]      = useState(1);
  const [secNewPin,    setSecNewPin]    = useState("");
  const [oldTxnPin,    setOldTxnPin]    = useState("");
  const [oldAppPin,    setOldAppPin]    = useState("");
  const [secErr,       setSecErr]       = useState("");
  const [secShake,     setSecShake]     = useState(false);
  const [secBusy,      setSecBusy]      = useState(false);
  const [txnPinSet,    setTxnPinSet]    = useState(false);
  const [txnResetAt,   setTxnResetAt]   = useState(null);
  const [showLockPick, setShowLockPick] = useState(false);
  const [neverCaution, setNeverCaution] = useState(false);
  const [legalView,     setLegalView]     = useState(null); // null | "terms" | "privacy"
  const [consentRecord, setConsentRecord] = useState(null); // { tnc_version, privacy_version, consented_at }

  // Bank account state for profile edit
  const [banks,         setBanks]         = useState([]);
  const [bankVerifying, setBankVerifying] = useState(false);
  const [bankVerified,  setBankVerified]  = useState(false);
  const [bankError,     setBankError]     = useState("");

  const autoLabel = pinLock.autoLockTimeout === 0 ? "Never" : (AUTO_LOCK_OPTIONS.find(o => o.secs === pinLock.autoLockTimeout)?.label || `${pinLock.autoLockTimeout}s`);

  useEffect(() => {
    ajoFn("get-txn-pin-status", { client_id: clientId })
      .then(d => { if (d?.pin_set != null) setTxnPinSet(!!d.pin_set); })
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    supabase
      .from("user_consents")
      .select("tnc_version, privacy_version, consented_at")
      .eq("user_id", uid)
      .order("consented_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setConsentRecord(data); })
      .catch(() => {});
  }, [session?.user?.id]);

  const triggerSecShake = useCallback(() => {
    setSecShake(true); setTimeout(() => setSecShake(false), 450);
  }, []);

  const resetSecView = useCallback(() => {
    setSecView(null); setSecStep(1); setSecNewPin(""); setOldTxnPin(""); setOldAppPin(""); setSecErr(""); setSecBusy(false);
  }, []);

  // App PIN change — step router (now wired to pinLock / pin-manager)
  const handleAppPinStep = useCallback(async (pin) => {
    setSecBusy(true); setSecErr("");
    try {
      if (secStep === 1) {
        // Capture current PIN — server verifies it in step 3 via changeAppPin
        setOldAppPin(pin);
        setSecStep(2);
      } else if (secStep === 2) {
        setSecNewPin(pin);
        setSecStep(3);
      } else if (secStep === 3) {
        if (pin !== secNewPin) { triggerSecShake(); setSecErr("PINs don't match — try again"); setSecBusy(false); return; }
        if (pinLock.appPinSet) {
          await pinLock.changeAppPin(oldAppPin, pin);
        } else {
          await pinLock.setupAppPin(pin);
        }
        resetSecView();
      }
    } catch (e) {
      const msg = (e?.message || "").toLowerCase();
      triggerSecShake();
      setSecErr(msg.includes("incorrect") || msg.includes("wrong") || msg.includes("invalid") ? "Incorrect PIN — try again" : "Something went wrong. Try again.");
    }
    setSecBusy(false);
  }, [secStep, secNewPin, oldAppPin, pinLock, triggerSecShake, resetSecView]);

  // Transaction PIN change — step 1 (old PIN) → 2 (OTP) → 3 (new PIN) → 4 (confirm)
  const handleTxnPinStep = useCallback(async (pin) => {
    setSecBusy(true); setSecErr("");
    try {
      if (secStep === 1) {
        // Capture old PIN, send OTP to their email, then move to OTP step
        setOldTxnPin(pin);
        await ajoFn("send-txn-pin-otp", { client_id: clientId });
        setSecStep(2);
      } else if (secStep === 2) {
        // Verify OTP
        await ajoFn("verify-txn-pin-otp", { client_id: clientId, otp: pin });
        setSecStep(3);
      } else if (secStep === 3) {
        setSecNewPin(pin); setSecStep(4);
      } else if (secStep === 4) {
        if (pin !== secNewPin) { triggerSecShake(); setSecErr("PINs don't match — try again"); setSecBusy(false); return; }
        await ajoFn("set-txn-pin", { client_id: clientId, old_pin: oldTxnPin || null, new_pin: pin });
        setTxnPinSet(true);
        setTxnResetAt(new Date().toISOString());
        resetSecView();
      }
    } catch (err) { setSecErr(friendlyError(err)); }
    setSecBusy(false);
  }, [secStep, secNewPin, oldTxnPin, clientId, triggerSecShake, resetSecView]);

  // Use server-side portal_pin_changed_at (survives page reload); fall back to local state for optimistic UI
  const _pinChangedAt = client?.portal_pin_changed_at || txnResetAt;
  const txnCooling = _pinChangedAt && (Date.now() - new Date(_pinChangedAt).getTime()) < 24 * 60 * 60 * 1000;

  const askAI = async (query) => {
    setAiLoading(true); setAiAnswer(""); setAiError("");
    try {
      const ctx = [
        `Member: ${client?.full_name || "Unknown"}`,
        `Balance: ₦${(client?.current_balance || 0).toLocaleString("en-NG")}`,
        `Group: ${client?.group_name || "N/A"}`,
        `Frequency: ${client?.contribution_frequency || "N/A"}`,
        `Total deposited: ₦${(client?.total_saved || 0).toLocaleString("en-NG")}`,
        `Recent contributions: ${contributions.slice(0, 5).map(c => `${c.type} ₦${c.amount} (${c.status})`).join("; ") || "none"}`,
      ].join(". ");
      const res = await fetch(`${ADMIN_URL}/api/public/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, context: ctx, portal: "ajo_member" }),
      });
      if (!res.ok) throw new Error("AI unavailable");
      const text = await res.text();
      setAiAnswer(text || "No answer returned.");
    } catch {
      setAiError("Couldn't get an AI answer right now. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const initials = (client?.full_name || "M").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  const doSave = async (confirmedEmail, confirmedPhone) => {
    setSaving(true); setSaveMsg("");
    try {
      let photoUrl = client?.profile_image_url;
      if (photoFile) {
        let prog = 0;
        const tick = setInterval(() => { prog = Math.min(90, prog + 15); setUploadProgress(prog); }, 200);
        try { photoUrl = await uploadAjoAvatar(photoFile, clientId); }
        finally { clearInterval(tick); setUploadProgress(100); setTimeout(() => setUploadProgress(0), 600); }
      }
      const payload = {
        full_name:           editForm.full_name,
        phone:               editForm.phone,
        address:             editForm.address,
        state:               editForm.state,
        lga:                 editForm.lga,
        ward:                editForm.ward,
        nin:                 editForm.nin,
        next_of_kin_name:    editForm.nok_name,
        next_of_kin_phone:   editForm.nok_phone,
        next_of_kin_email:   editForm.nok_email,
        next_of_kin_address: editForm.nok_addr,
        profile_image_url:   photoUrl,
      };
      if (confirmedEmail) payload.email = confirmedEmail;
      if (confirmedPhone) payload.phone = confirmedPhone;
      // Include bank details only if account_name is set (either from DB or freshly verified)
      if (editForm.account_name && editForm.account_number && editForm.bank_code) {
        payload.bank_code      = editForm.bank_code;
        payload.bank_name      = editForm.bank_name;
        payload.account_number = editForm.account_number;
        payload.account_name   = editForm.account_name;
      }
      // Route through edge function so service role bypasses RLS (direct client update is blocked)
      await ajoFn("update-profile", { client_id: clientId, fields: payload });
      const changedFields = Object.keys(payload).filter(k => k !== "profile_image_url");
      ajoFn("log-profile-update", { client_id: clientId, fields_changed: changedFields }).catch(() => {});
      onProfileUpdate?.(payload);
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("profile"); }, 1500);
    } catch (err) {
      console.error("[profile-save]", err);
      setSaveMsg(err?.message || "Save failed. Please try again.");
    }
    setSaving(false);
  };

  const sendEmailOtp = async () => {
    setOtpSending(true); setOtpError("");
    try {
      await ajoFn("send-profile-otp", { client_id: clientId, field: "email", new_value: editForm.email });
      setPendingEmail(editForm.email);
    } catch (err) {
      setOtpError(friendlyError(err));
    } finally { setOtpSending(false); }
  };

  const verifyEmailOtp = async () => {
    setOtpSending(true); setOtpError("");
    try {
      await ajoFn("verify-profile-otp", { client_id: clientId, field: "email", new_value: pendingEmail, otp: emailOtp });
      const confirmed = pendingEmail;
      setPendingEmail(null);
      setEmailOtp("");
      await doSave(confirmed);
    } catch (err) {
      setOtpError(friendlyError(err));
      setOtpSending(false);
    }
  };

  const sendPhoneOtp = async () => {
    setPhoneOtpSending(true); setPhoneOtpError("");
    try {
      await ajoFn("send-profile-otp", { client_id: clientId, field: "phone", new_value: editForm.phone });
      setPendingPhone(editForm.phone);
    } catch (err) {
      setPhoneOtpError(friendlyError(err));
    } finally { setPhoneOtpSending(false); }
  };

  const verifyPhoneOtp = async () => {
    setPhoneOtpSending(true); setPhoneOtpError("");
    try {
      await ajoFn("verify-profile-otp", { client_id: clientId, field: "phone", new_value: pendingPhone, otp: phoneOtp });
      const confirmed = pendingPhone;
      setPendingPhone(null);
      setPhoneOtp("");
      await doSave(null, confirmed);
    } catch (err) {
      setPhoneOtpError(friendlyError(err));
      setPhoneOtpSending(false);
    }
  };

  // Load bank list when entering edit view
  useEffect(() => {
    if (view !== "edit") return;
    if (banks.length > 0) return;
    supabase.functions.invoke("paystack", { body: { action: "list-banks" } })
      .then(({ data }) => setBanks(data?.data || []))
      .catch(() => {});
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveBank = async () => {
    if (!editForm.bank_code || editForm.account_number.length !== 10) {
      setBankError("Select a bank and enter a 10-digit account number"); return;
    }
    setBankVerifying(true); setBankError(""); setBankVerified(false);
    try {
      const { data } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: editForm.account_number, bank_code: editForm.bank_code },
      });
      if (!data?.status || !data?.data?.account_name) {
        setBankError(data?.message || "Could not verify account. Check the details and retry."); return;
      }
      const selectedBank = banks.find(b => b.code === editForm.bank_code);
      setEditForm(p => ({
        ...p,
        account_name: data.data.account_name,
        bank_name: selectedBank?.name || p.bank_name,
      }));
      setBankVerified(true);
    } catch { setBankError("Verification failed. Try again."); }
    finally { setBankVerifying(false); }
  };

  const saveProfile = async () => {
    setSaveMsg("");
    if (editForm.phone && !phoneRegex.test(editForm.phone)) { setSaveMsg("Enter a valid Nigerian phone number."); return; }
    if (editForm.email && !emailRegex.test(editForm.email)) { setSaveMsg("Enter a valid email address."); return; }
    const currentEmail = client?.email || session?.user?.email || "";
    const currentPhone = client?.phone || "";
    const emailChanged = editForm.email && editForm.email !== currentEmail;
    const phoneChanged = editForm.phone && editForm.phone !== currentPhone;
    if (emailChanged) { await sendEmailOtp(); }
    else if (phoneChanged) { await sendPhoneOtp(); }
    else { await doSave(null); }
  };

  const SubHeader = ({ title, onBack }) => (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
      <button onClick={onBack || (() => setView("menu"))} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
        <Svg d={P.back} size={18} color="#64748b" />
      </button>
      <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 flex-1">{title}</p>
    </div>
  );

  /* ── Profile preview ─────────────────────────────────────────────── */
  if (view === "fees") {
    const regFeeRow = contributions.find(c => c.type === "registration_fee");
    const isGroup   = !!client?.ajo_group_id;
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
          <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
            <Svg d={P.back} size={18} color="#64748b" />
          </button>
          <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 flex-1">My Fees</p>
        </div>
        <div className="flex-1 overflow-y-auto pb-10 px-4 pt-4 space-y-4">

          {/* Registration Fee */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <p className="px-4 pt-3 pb-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-50 dark:border-slate-700/30">Registration Fee</p>
            <div className="px-4 py-4">
              {(client?.registration_charge || 0) > 0 ? (
                <>
                  <p className="text-2xl font-extrabold text-slate-800 dark:text-white tabular-nums">{fmt(client.registration_charge)}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {regFeeRow ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Paid on {fmtDate(regFeeRow.created_at)}</p>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Will be deducted from your first deposit</p>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">No registration fee on your account</p>
              )}
            </div>
          </div>

          {/* Per-cycle fee breakdown — source of truth is the cycle, not the client row */}
          {isGroup && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
              <p className="px-4 pt-3 pb-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-50 dark:border-slate-700/30">Group Withdrawal Fee</p>
              <div className="px-4 py-4">
                {client?.commission_model === "percent" ? (
                  <>
                    <p className="text-2xl font-extrabold text-slate-800 dark:text-white tabular-nums">{client.commission_percent || 0}%</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your group&apos;s withdrawal fee: {client.commission_percent || 0}%</p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400">No withdrawal fees</p>
                )}
              </div>
            </div>
          )}

          {cycles.filter(cy => cy.status === "active").length > 0 ? (
            cycles.filter(cy => cy.status === "active").map(cy => (
              <div key={cy.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <p className="px-4 pt-3 pb-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-50 dark:border-slate-700/30">
                  {cy.label || "Personal Savings"} — Cycle Fee
                </p>
                <div className="px-4 py-4">
                  {cy.commission_model === "percent" ? (
                    <>
                      <p className="text-2xl font-extrabold text-slate-800 dark:text-white tabular-nums">{cy.commission_percent || 0}%</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{cy.commission_percent || 0}% deducted from each withdrawal</p>
                    </>
                  ) : cy.commission_model === "first_period" ? (
                    <>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">First deposit goes to your collector</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Savings in this cycle start from deposit 2</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">Funds are locked until this cycle completes</p>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">No fee on this cycle</p>
                  )}
                </div>
              </div>
            ))
          ) : !isGroup && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-4">
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Withdrawal Fee</p>
              <p className="text-sm text-slate-400 dark:text-slate-500">No active savings cycles</p>
            </div>
          )}

          {/* Combined first-deposit disclosure: reg fee + first_period on same cycle */}
          {cycles.some(cy => cy.status === "active" && cy.commission_model === "first_period") &&
           (client?.registration_charge || 0) > 0 &&
           !regFeeRow && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800 px-4 py-4">
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-1.5">First Deposit Note</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                From your first deposit of{" "}
                <span className="font-bold">{fmt(client.contribution_amount || 0)}</span>:{" "}
                <span className="font-semibold">{fmt(client.registration_charge)}</span> registration fee +
                the deposit itself goes to your collector. Your savings start from deposit 2.
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-2 leading-relaxed">
            Fees are set by your savings collector. Contact them for questions about your fee structure.
          </p>
        </div>
      </div>
    );
  }

  if (view === "profile") {
    const avatarSrc = photoPreview || client?.profile_image_url;
    const InfoRow = ({ label, value }) => (
      <div className="flex items-start py-[11px] border-b border-slate-50 dark:border-slate-700/30 last:border-0">
        <p className="text-[12px] text-slate-400 dark:text-slate-500 w-28 flex-shrink-0 leading-relaxed">{label}</p>
        <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 flex-1 leading-relaxed break-all">{value || "—"}</p>
      </div>
    );
    const InfoCard = ({ title, children }) => (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-hidden">
        <p className="px-4 pt-3 pb-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-50 dark:border-slate-700/30">{title}</p>
        <div className="px-4">{children}</div>
      </div>
    );
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
          <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
            <Svg d={P.back} size={18} color="#64748b" />
          </button>
          <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 flex-1">Profile</p>
          <button onClick={() => setView("edit")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/30 text-brand-500 dark:text-brand-400 text-[13px] font-bold active:scale-90 transition">
            <Svg d={P.pen} size={14} color="currentColor" />
            Edit
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-10">
          {/* Avatar hero */}
          <div className="flex flex-col items-center pt-7 pb-5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/30">
            <button
              onClick={() => { setLightboxOpen(true); setLbZoom(1); }}
              className="relative active:scale-95 transition">
              <div className="w-24 h-24 rounded-full bg-brand-500 relative flex items-center justify-center shadow-lg overflow-hidden ring-2 ring-brand-200 dark:ring-brand-800">
                <span className="text-2xl font-black text-white">{initials}</span>
                {avatarSrc && <img src={avatarSrc} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />}
              </div>
            </button>
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 mt-3">{client?.full_name || "Member"}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[11px] font-bold capitalize">
                {client?.status || "Active"}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">{client?.membership_number || "—"}</span>
            </div>
            {avatarSrc && <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-2">Tap photo to view full size</p>}
          </div>
          {/* Info cards */}
          <div className="px-4 pt-5 space-y-4">
            <InfoCard title="Personal">
              <InfoRow label="Full Name"  value={client?.full_name} />
              <InfoRow label="Phone"      value={client?.phone} />
              <InfoRow label="Email"      value={client?.email || session?.user?.email} />
              {client?.nin ? <InfoRow label="NIN" value={`••••••••${(client.nin || "").slice(-3)}`} /> : null}
            </InfoCard>
            <InfoCard title="Location">
              <InfoRow label="Address"    value={client?.address} />
              <InfoRow label="State"      value={client?.state} />
              <InfoRow label="LGA"        value={client?.lga} />
              <InfoRow label="Ward"       value={client?.ward} />
            </InfoCard>
            <InfoCard title="Next of Kin">
              <InfoRow label="Name"       value={client?.next_of_kin_name} />
              <InfoRow label="Phone"      value={client?.next_of_kin_phone} />
              <InfoRow label="Email"      value={client?.next_of_kin_email} />
              <InfoRow label="Address"    value={client?.next_of_kin_address} />
            </InfoCard>
            <InfoCard title="Bank Account">
              {client?.account_name ? (
                <>
                  <InfoRow label="Account Name"   value={client.account_name} />
                  <InfoRow label="Account No."    value={client.account_number ? `****${client.account_number.slice(-4)}` : "—"} />
                  <InfoRow label="Bank"           value={client.bank_name} />
                </>
              ) : (
                <div className="py-3">
                  <p className="text-[13px] text-slate-400 dark:text-slate-500 italic">No bank account added yet — tap Edit to add one.</p>
                </div>
              )}
            </InfoCard>
            <InfoCard title="Membership">
              <InfoRow label="Member No."  value={client?.membership_number} />
              <InfoRow label="Since"       value={client?.created_at ? new Date(client.created_at).toLocaleDateString("en-NG", { month: "short", year: "numeric" }) : "—"} />
              <InfoRow label="Group"       value={client?.group_name} />
              <InfoRow label="Frequency"   value={client?.contribution_frequency ? `${client.contribution_frequency.charAt(0).toUpperCase()}${client.contribution_frequency.slice(1)}` : "—"} />
              <InfoRow label="Amount"      value={client?.contribution_amount ? `₦${Number(client.contribution_amount).toLocaleString("en-NG")} / ${client?.contribution_frequency || "cycle"}` : "—"} />
            </InfoCard>
          </div>
        </div>
      </div>
    );
  }

  /* ── Edit profile ─────────────────────────────────────────────────── */
  if (view === "edit") {
    const avatarSrcEdit = photoPreview || client?.profile_image_url;
    const currentEmail  = client?.email || session?.user?.email || "";

    /* Phone OTP verification step */
    if (pendingPhone) return (
      <div className="h-full flex flex-col">
        <SubHeader title="Verify Phone Change" onBack={() => { setPendingPhone(null); setPhoneOtp(""); setPhoneOtpError(""); }} />
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5 pb-8">
          <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl p-4">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1">Check your email</p>
            <p className="text-[13px] text-brand-600/80 dark:text-brand-400/80 leading-relaxed">
              We sent a 6-digit code to your registered email. Enter it below to confirm your new phone number.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Verification Code</p>
            <input
              type="number" inputMode="numeric" value={phoneOtp}
              onChange={e => { setPhoneOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setPhoneOtpError(""); }}
              placeholder="000000"
              className="w-full h-14 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-xl font-bold text-center text-slate-700 dark:text-slate-200 tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          {phoneOtpError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600">
              <Svg d={P.alert} size={15} color="currentColor" />
              <p className="text-sm font-semibold">{phoneOtpError}</p>
            </div>
          )}
          <button onClick={verifyPhoneOtp} disabled={phoneOtp.length !== 6 || phoneOtpSending}
            className="w-full h-12 rounded-2xl bg-brand-500 text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition">
            {phoneOtpSending ? "Verifying…" : "Confirm Phone Change"}
          </button>
          <button onClick={sendPhoneOtp} disabled={phoneOtpSending}
            className="w-full py-3 text-[13px] text-slate-400 dark:text-slate-500 font-semibold">
            Didn&apos;t receive it? Resend code
          </button>
        </div>
      </div>
    );

    /* Email OTP verification step */
    if (pendingEmail) return (
      <div className="h-full flex flex-col">
        <SubHeader title="Verify New Email" onBack={() => { setPendingEmail(null); setEmailOtp(""); setOtpError(""); }} />
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5 pb-8">
          <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl p-4">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1">Check your inbox</p>
            <p className="text-[13px] text-brand-600/80 dark:text-brand-400/80 leading-relaxed">
              We sent a 6-digit code to <span className="font-bold">{pendingEmail}</span>. Enter it below to confirm your new email address.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Verification Code</p>
            <input
              type="number" inputMode="numeric" value={emailOtp}
              onChange={e => { setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
              placeholder="000000"
              className="w-full h-14 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-xl font-bold text-center text-slate-700 dark:text-slate-200 tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          {otpError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600">
              <Svg d={P.alert} size={15} color="currentColor" />
              <p className="text-sm font-semibold">{otpError}</p>
            </div>
          )}
          <button onClick={verifyEmailOtp} disabled={emailOtp.length !== 6 || otpSending}
            className="w-full h-12 rounded-2xl bg-brand-500 text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition">
            {otpSending ? "Verifying…" : "Confirm Email Change"}
          </button>
          <button onClick={sendEmailOtp} disabled={otpSending}
            className="w-full py-3 text-[13px] text-slate-400 dark:text-slate-500 font-semibold">
            Didn't receive it? Resend code
          </button>
        </div>
      </div>
    );

    return (
      <div className="h-full flex flex-col">
        <SubHeader title="Edit Profile" onBack={() => { setSaveMsg(""); setView("profile"); }} />
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6 pb-8">

          {/* Avatar */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-brand-500 relative flex items-center justify-center shadow-lg overflow-hidden ring-2 ring-brand-200 dark:ring-brand-800">
                <span className="text-2xl font-black text-white">{initials}</span>
                {avatarSrcEdit && <img src={avatarSrcEdit} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />}
              </div>
              <button onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-500 border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition">
                <Svg d={P.cam} size={15} color="#fff" />
              </button>
            </div>
            <p className="text-[12px] text-slate-400">Tap camera to change · Max 2 MB</p>
            {uploadProgress > 0 && (
              <div className="w-48">
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) { setSaveMsg("Photo must be under 2 MB."); return; }
                setPhotoFile(f);
                setPhotoPreview(URL.createObjectURL(f));
                setSaveMsg("");
              }} />
          </div>

          {/* Personal */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Personal</p>
            {[["Full Name", "full_name", "text"], ["Phone", "phone", "tel"]].map(([lbl, k, t]) => (
              <div key={k}>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{lbl}</p>
                <input type={t} value={editForm[k]} onChange={e => setEditForm(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email</p>
              <input type="email" value={editForm.email}
                onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              {editForm.email && editForm.email !== currentEmail && emailRegex.test(editForm.email) && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 px-1">Email changed — you'll receive a code to verify</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">NIN</p>
              <input type="text" inputMode="numeric" maxLength={11} value={editForm.nin} placeholder="11-digit NIN"
                onChange={e => setEditForm(p => ({ ...p, nin: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Location</p>
            {[["Address", "address"], ["State", "state"], ["LGA", "lga"], ["Ward", "ward"]].map(([lbl, k]) => (
              <div key={k}>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{lbl}</p>
                <input type="text" value={editForm[k]} onChange={e => setEditForm(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
          </div>

          {/* Next of Kin */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Next of Kin</p>
            {[["Name", "nok_name", "text"], ["Phone", "nok_phone", "tel"], ["Email", "nok_email", "email"], ["Address", "nok_addr", "text"]].map(([lbl, k, t]) => (
              <div key={k}>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{lbl}</p>
                <input type={t} value={editForm[k]} onChange={e => setEditForm(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
          </div>

          {/* Bank Account */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Bank Account (Payout)</p>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Bank</p>
              <select value={editForm.bank_code} onChange={e => {
                const sel = banks.find(b => b.code === e.target.value);
                setEditForm(p => ({ ...p, bank_code: e.target.value, bank_name: sel?.name || "", account_name: "" }));
                setBankVerified(false); setBankError("");
              }} className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
                <option value="">Select bank…</option>
                {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Account Number</p>
              <div className="flex gap-2">
                <input type="text" inputMode="numeric" maxLength={10} value={editForm.account_number} placeholder="10-digit number"
                  onChange={e => {
                    setEditForm(p => ({ ...p, account_number: e.target.value.replace(/\D/g, "").slice(0, 10), account_name: "" }));
                    setBankVerified(false); setBankError("");
                  }}
                  className="flex-1 h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                <button type="button" onClick={resolveBank}
                  disabled={bankVerifying || !editForm.bank_code || editForm.account_number.length !== 10}
                  className="h-12 px-4 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95 transition flex-shrink-0">
                  {bankVerifying ? "…" : "Verify"}
                </button>
              </div>
            </div>
            {bankVerified && editForm.account_name && (
              <div className="flex items-center gap-2 px-4 py-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                <Svg d={P.check} size={16} color="#16a34a" />
                <p className="text-sm font-bold text-green-700 dark:text-green-400">{editForm.account_name}</p>
              </div>
            )}
            {!bankVerified && editForm.account_name && (
              <div className="px-4 py-3 bg-slate-100 dark:bg-slate-700/50 rounded-xl">
                <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">{editForm.account_name} · {editForm.bank_name || "—"}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Saved account — re-verify to change</p>
              </div>
            )}
            {bankError && <p className="text-xs text-red-500 px-1">{bankError}</p>}
          </div>

          {/* Membership — read-only */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Membership (read-only)</p>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/30">
              {[
                ["Member No.", client?.membership_number],
                ["Since", client?.created_at ? new Date(client.created_at).toLocaleDateString("en-NG", { month: "short", year: "numeric" }) : null],
                ["Group", client?.group_name],
                ["Frequency", client?.contribution_frequency],
                ["Amount", client?.contribution_amount ? `₦${Number(client.contribution_amount).toLocaleString("en-NG")}` : null],
                ["Reg. Fee", client?.registration_charge != null ? `₦${Number(client.registration_charge).toLocaleString("en-NG")}` : null],
                ["Withdrawal Fee", client?.commission_model === "percent" ? `${client.commission_percent || 0}%` : client?.commission_model === "first_period" ? "First period/cycle" : client?.commission_model === "none" ? "None" : null],
              ].map(([lbl, val]) => (
                <div key={lbl} className="flex items-center px-4 py-3">
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 w-28 flex-shrink-0">{lbl}</p>
                  <p className="text-[13px] font-semibold text-slate-400 dark:text-slate-500">{val || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {saveMsg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${saveMsg.includes("saved") ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/30 text-red-600"}`}>
              <Svg d={saveMsg.includes("saved") ? P.check : P.alert} size={16} color="currentColor" />
              <p className="text-sm font-semibold">{saveMsg}</p>
            </div>
          )}
          <button onClick={saveProfile} disabled={saving}
            className="w-full h-12 rounded-2xl bg-brand-500 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    );
  }

  const Toggle = (
    <button onClick={e => { e.stopPropagation(); toggleDark(); }}
      className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${isDark ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-600"}`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: isDark ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );

  return (
    <div className="h-full overflow-y-auto pb-4">
      {/* Account */}
      <div className="px-4 mt-5 mb-5">
        <SectionLabel>Account</SectionLabel>
        <SettingsCard>
          {/* Profile summary row — full row taps to open profile preview */}
          <Row
            iconCls="bg-green-50 dark:bg-green-900/20"
            icon={<RowIcon d={P.doc} color="#16a34a" />}
            label="My Fees"
            sub="Registration fee, withdrawal charges"
            onClick={() => setView("fees")}
          />
          <button onClick={() => setView("profile")}
            className="w-full flex items-center gap-4 px-4 py-4 text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
<div className="w-12 h-12 rounded-full bg-brand-500 relative flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm ring-2 ring-brand-100 dark:ring-brand-900/40">
              <span className="text-base font-black text-white">{initials}</span>
              {(photoPreview || client?.profile_image_url) && <img src={photoPreview || client.profile_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-[15px] leading-snug text-slate-800 dark:text-slate-100 truncate">{client?.full_name || "Member"}</p>
              <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5 truncate capitalize">
                {[client?.contribution_frequency ? `${client.contribution_frequency} savings` : null, client?.membership_number].filter(Boolean).join(" · ") || "View profile"}
              </p>
            </div>
            <Svg d="M9 18l6-6-6-6" size={16} color="#cbd5e1" />
          </button>
        </SettingsCard>
      </div>

      {/* Security */}
      <div className="px-4 mb-5">
        <SectionLabel>Security</SectionLabel>
        <SettingsCard>
          {/* 1 — App Lock PIN */}
          <Row
            iconCls="bg-blue-50 dark:bg-blue-900/20"
            icon={<RowIcon d={P.lock} color="#3b82f6" />}
            label="App Lock PIN"
            sub={pinLock.appPinSet ? "Change your 6-digit unlock PIN" : "Set a 6-digit PIN to lock this app"}
            onClick={() => { setSecView("app-pin"); setSecStep(pinLock.appPinSet ? 1 : 2); setSecErr(""); setSecNewPin(""); }}
          />
          {/* 2 — Transaction PIN */}
          <Row
            iconCls="bg-blue-50 dark:bg-blue-900/20"
            icon={<RowIcon d={P.shield} color="#3b82f6" />}
            label="Transaction PIN"
            sub={txnCooling
              ? "Recently reset — high-value operations under 24h review"
              : txnPinSet ? "Change your 4-digit transaction PIN" : "Set a 4-digit transaction PIN"}
            onClick={() => {
              setSecView("txn-pin"); setSecStep(txnPinSet ? 1 : 3);
              setSecErr(""); setSecNewPin(""); setOldTxnPin("");
            }}
            right={txnCooling ? (
              <span className="text-[11px] font-bold text-amber-500 dark:text-amber-400 flex-shrink-0">24h</span>
            ) : undefined}
          />
          {/* 3 — Biometric Unlock (hidden when not supported) */}
          {pinLock.biometricAvailable && (
            <Row
              iconCls="bg-blue-50 dark:bg-blue-900/20"
              icon={<RowIcon d={P.finger} color="#3b82f6" />}
              label="Biometric Unlock"
              sub={pinLock.biometricEnabled ? "Fingerprint / Face ID enabled" : "Use fingerprint or face to unlock"}
              onClick={async () => {
                if (!pinLock.appPinSet) { setShowPinSetup(true); return; }
                setLockBusy(true);
                try {
                  if (pinLock.biometricEnabled) { await pinLock.disableBiometric(); }
                  else { await pinLock.registerBiometric(); }
                } catch {} finally { setLockBusy(false); }
              }}
              right={
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!pinLock.appPinSet) { setShowPinSetup(true); return; }
                    setLockBusy(true);
                    try {
                      if (pinLock.biometricEnabled) { await pinLock.disableBiometric(); }
                      else { await pinLock.registerBiometric(); }
                    } catch {} finally { setLockBusy(false); }
                  }}
                  className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${pinLock.biometricEnabled ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-600"}`}>
                  {lockBusy
                    ? <span className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /></span>
                    : <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200" style={{ left: pinLock.biometricEnabled ? "calc(100% - 22px)" : "2px" }} />
                  }
                </button>
              }
            />
          )}
          {/* 4 — Auto Lock */}
          <Row
            iconCls="bg-blue-50 dark:bg-blue-900/20"
            icon={<RowIcon d={P.lock} color="#3b82f6" />}
            label="Auto Lock"
            sub={pinLock.autoLockTimeout === 0 ? "Auto lock is disabled" : `Locks after ${autoLabel}`}
            onClick={() => setShowLockPick(true)}
          />
        </SettingsCard>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-5">
        <SectionLabel>Preferences</SectionLabel>
        <SettingsCard>
          <Row iconCls="bg-amber-50 dark:bg-amber-900/20" icon={<RowIcon d={isDark ? P.moon : P.sun} color="#f59e0b" />}
            label="Dark Mode" onClick={toggleDark} right={Toggle} />
        </SettingsCard>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-5">
        <SectionLabel>Help & Support</SectionLabel>
        <SettingsCard>
          <Row iconCls="bg-violet-50 dark:bg-violet-900/20" icon={<RowIcon d={P.faq} color="#7c3aed" />}
            label="FAQ & AI Help" sub="Search questions or ask AI" onClick={() => { setView("faq"); setFaqTab("faq"); }} />
          <Row iconCls="bg-violet-50 dark:bg-violet-900/20" icon={<RowIcon d={P.help} color="#7c3aed" />}
            label="Contact Support" sub="Submit a support ticket" onClick={() => { setView("faq"); setFaqTab("support"); }} />
        </SettingsCard>
      </div>

      {/* Legal */}
      <div className="px-4 mb-5">
        <SectionLabel>Legal</SectionLabel>
        <SettingsCard>
          <Row
            iconCls="bg-slate-100 dark:bg-slate-700"
            icon={<RowIcon d={P.doc} color="#475569" />}
            label="Terms & Conditions"
            sub="View the full terms of service"
            onClick={() => setLegalView("terms")}
          />
          <Row
            iconCls="bg-slate-100 dark:bg-slate-700"
            icon={<RowIcon d={P.doc} color="#475569" />}
            label="Privacy Policy"
            sub="How we collect and use your data"
            onClick={() => setLegalView("privacy")}
          />
          {consentRecord && (
            <div className="flex items-center gap-3.5 px-4 py-[14px]">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-50 dark:bg-emerald-900/20">
                <Svg d={P.check} size={20} color="#10b981" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[14px] leading-snug text-slate-700 dark:text-slate-200">Your consent record</p>
                <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
                  You accepted T&amp;C v{consentRecord.tnc_version} and Privacy Policy v{consentRecord.privacy_version} on{" "}
                  {new Date(consentRecord.consented_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
            </div>
          )}
        </SettingsCard>
      </div>

      {/* Change Password */}
      <div className="px-4 mb-3">
        <button onClick={onChangePwdClick}
          className="w-full py-[15px] bg-brand-50 dark:bg-brand-900/20 rounded-2xl font-bold text-sm border border-brand-100 dark:border-brand-900/40 active:bg-brand-100 transition-colors flex items-center justify-center gap-2.5 text-brand-500 dark:text-brand-400">
          <Svg d={P.shield} size={18} color="currentColor" />
          Change Password
        </button>
      </div>

      {/* Sign Out */}
      <div className="px-4 mb-4">
        <button onClick={() => supabase.auth.signOut()}
          className="w-full py-[15px] bg-red-50 dark:bg-red-950/30 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-900/40 active:bg-red-100 transition-colors flex items-center justify-center gap-2.5 text-red-500 dark:text-red-400">
          <Svg d={P.out2} size={18} color="currentColor" />
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="text-center py-4 px-8 space-y-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">KudiAI Track &middot; Savings Member Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">Powered by AMAYA &amp; Co. Technologies<br />All rights reserved &copy; {YEAR}</p>
      </div>

      {/* ── Auto Lock picker ───────────────────────────────────────────── */}
      {showLockPick && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) setShowLockPick(false); }}>
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl pb-safe px-4 pt-5"
            style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}>
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 mb-4 text-center">Auto Lock</p>
            {neverCaution && (
              <div className="mb-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30">
                <p className="text-[12px] text-amber-700 dark:text-amber-400 leading-relaxed">
                  Your app won&apos;t lock automatically. Anyone with access to your device can open it without a PIN.
                </p>
              </div>
            )}
            <div className="space-y-1">
              {AUTO_LOCK_OPTIONS.map(opt => (
                <button key={opt.secs} onClick={() => {
                  if (opt.secs === 0 && !neverCaution) { setNeverCaution(true); return; }
                  pinLock.updateSettings({ autoLockTimeout: opt.secs });
                  setShowLockPick(false);
                  setNeverCaution(false);
                }}
                  className={`w-full py-3.5 px-4 rounded-2xl text-sm font-semibold text-left flex items-center justify-between transition-colors ${
                    pinLock.autoLockTimeout === opt.secs
                      ? "bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400"
                      : "text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700/40"
                  }`}>
                  {opt.label}
                  {pinLock.autoLockTimeout === opt.secs && <Svg d={P.check} size={16} color="currentColor" />}
                </button>
              ))}
            </div>
            <button onClick={() => { setShowLockPick(false); setNeverCaution(false); }}
              className="mt-3 w-full py-3 text-sm text-slate-400 font-semibold">Cancel</button>
          </div>
        </div>
      )}

      {/* ── App Lock PIN flows (z-[300]) ────────────────────────────────── */}
      {secView === "app-pin" && secStep === 1 && (
        <AjoPinPad
          length={6}
          title="Enter current PIN"
          subtitle="Enter your 6-digit app unlock PIN"
          onComplete={handleAppPinStep}
          onCancel={resetSecView}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}
      {secView === "app-pin" && secStep === 2 && (
        <AjoPinPad
          length={6}
          title={pinLock.appPinSet ? "Enter new PIN" : "Set your PIN"}
          subtitle="Choose a 6-digit unlock PIN for this app"
          onComplete={handleAppPinStep}
          onCancel={resetSecView}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}
      {secView === "app-pin" && secStep === 3 && (
        <AjoPinPad
          length={6}
          title="Confirm new PIN"
          subtitle="Enter your new PIN one more time"
          onComplete={handleAppPinStep}
          onCancel={() => { setSecStep(2); setSecErr(""); }}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}

      {/* ── Transaction PIN flows (z-[300]) ─────────────────────────────── */}
      {secView === "txn-pin" && secStep === 1 && (
        <AjoPinPad
          length={4}
          title="Enter current transaction PIN"
          subtitle="Verify your identity before changing your transaction PIN"
          onComplete={handleTxnPinStep}
          onCancel={resetSecView}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}
      {secView === "txn-pin" && secStep === 2 && (
        <AjoPinPad
          length={6}
          title="Enter OTP"
          subtitle="We sent a 6-digit code to your registered email"
          onComplete={handleTxnPinStep}
          onCancel={() => { setSecStep(1); setSecErr(""); }}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}
      {secView === "txn-pin" && secStep === 3 && (
        <AjoPinPad
          length={4}
          title="Set new transaction PIN"
          subtitle="Choose a 4-digit PIN for authorising transactions"
          onComplete={handleTxnPinStep}
          onCancel={resetSecView}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}
      {secView === "txn-pin" && secStep === 4 && (
        <AjoPinPad
          length={4}
          title="Confirm new PIN"
          subtitle="Enter your new transaction PIN once more"
          onComplete={handleTxnPinStep}
          onCancel={() => { setSecStep(3); setSecErr(""); }}
          error={secErr} shaking={secShake} loading={secBusy}
        />
      )}

      {/* Help & Support overlay (FAQ + AI Search + Support Tickets) */}
      {view === "faq" && (
        <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pb-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0"
            style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
            <button onClick={() => { setView("menu"); setFaqSearch(""); setAiAnswer(""); setAiError(""); }}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
              <Svg d={P.back} size={18} color="#64748b" />
            </button>
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 flex-1">Help & Support</p>
            {/* Tabs */}
            <div className="flex gap-1 pb-0">
              {[["faq", "FAQ"], ["support", "Support"]].map(([id, lbl]) => (
                <button key={id} onClick={() => { setFaqTab(id); setFaqSearch(""); setAiAnswer(""); setAiError(""); }}
                  className={`px-3 py-2 text-[12px] font-bold rounded-t-xl border-b-2 transition ${
                    faqTab === id
                      ? "text-brand-500 dark:text-brand-400 border-brand-500 dark:border-brand-400"
                      : "text-slate-400 dark:text-slate-500 border-transparent"
                  }`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {faqTab === "faq" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Search bar */}
              <div className="px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0">
                <div className="relative flex items-center">
                  <div className="absolute left-3 pointer-events-none">
                    <svg viewBox="0 0 24 24" fill="none" width="15" height="15" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </div>
                  <input
                    value={faqSearch}
                    onChange={e => { setFaqSearch(e.target.value); setAiAnswer(""); setAiError(""); }}
                    onKeyDown={e => { if (e.key === "Enter" && faqSearch.trim()) askAI(faqSearch.trim()); }}
                    placeholder="Search or ask anything…"
                    className="w-full pl-9 pr-20 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  {faqSearch.trim() && (
                    <button onClick={() => askAI(faqSearch.trim())} disabled={aiLoading}
                      className="absolute right-2 px-2.5 py-1 bg-brand-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold">
                      Ask AI
                    </button>
                  )}
                </div>
              </div>
              {/* FAQ list */}
              <div className="flex-1 overflow-y-auto px-4 py-4 pb-6">
                <FAQ faqSearch={faqSearch} aiAnswer={aiAnswer} aiLoading={aiLoading} aiError={aiError} />
              </div>
            </div>
          )}

          {faqTab === "support" && (
            <div className="flex-1 overflow-y-auto px-4 py-4 pb-8">
              <SupportInline client={client} session={session} />
            </div>
          )}
        </div>
      )}

      {/* Avatar lightbox — z below PIN tier (z-[260] < z-[300]) */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[260] flex flex-col items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) { setLightboxOpen(false); setLbZoom(1); } }}>
          <button
            onClick={() => { setLightboxOpen(false); setLbZoom(1); }}
            style={{ top: "max(16px, env(safe-area-inset-top, 16px))" }}
            className="absolute right-4 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center active:scale-90 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" width={18} height={18}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div
            style={{ transform: `scale(${lbZoom})`, touchAction: "none", transition: lbPinchDist ? "none" : "transform 0.2s" }}
            className="w-72 h-72 rounded-full overflow-hidden flex-shrink-0 relative"
            onTouchStart={e => {
              if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                setLbPinchDist(Math.hypot(dx, dy));
              }
            }}
            onTouchMove={e => {
              if (e.touches.length === 2 && lbPinchDist !== null) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const newDist = Math.hypot(dx, dy);
                setLbZoom(prev => Math.min(5, Math.max(0.8, prev * (newDist / lbPinchDist))));
                setLbPinchDist(newDist);
              }
            }}
            onTouchEnd={() => setLbPinchDist(null)}
            onDoubleClick={() => setLbZoom(z => z > 1.1 ? 1 : 2.5)}>
            <div className="w-full h-full bg-brand-500 flex items-center justify-center">
              <span className="text-7xl font-black text-white">{initials}</span>
            </div>
            {(photoPreview || client?.profile_image_url) && (
              <img src={photoPreview || client.profile_image_url} alt={client?.full_name || "Avatar"}
                className="absolute inset-0 w-full h-full object-cover" draggable={false}
                onError={(e) => e.currentTarget.style.display = "none"} />
            )}
          </div>
          <p className="absolute bottom-8 text-white/30 text-[11px]">Pinch to zoom · Double-tap to toggle</p>
        </div>
      )}

      {/* PIN setup modal — shown when user tries to enable biometric without an app PIN */}
      {showPinSetup && (
        <PinSetupModal onClose={() => setShowPinSetup(false)} onDone={async (pin) => {
          setShowPinSetup(false);
          await pinLock.setupAppPin(pin);
          await pinLock.registerBiometric();
        }} />
      )}

      {legalView && <LegalScreen type={legalView} onBack={() => setLegalView(null)} />}
    </div>
  );
}

// ── Bills wrapper — mirrors same store shape as CoopMemberPortal ──────────
function AjoMemberBillsWrapper({ client, ownerInfo, session }) {
  const [bills, setBills] = useState([]);

  const addTransaction = useCallback(async (payload) => {
    try {
      const { data } = await supabase.from("transactions").insert({
        user_id:          session?.user?.id || null,
        type:             payload.type,
        category:         payload.category   || "sale",
        amount:           parseFloat(payload.amount) || 0,
        item_name:        payload.item_name  || "",
        quantity:         1,
        customer_name:    payload.customer_name || "",
        payment_type:     payload.payment_type  || "cash",
        note:             payload.note          || "",
        transaction_date: payload.transaction_date || new Date().toISOString().slice(0, 10),
        bill_status:      payload.bill_status !== undefined ? payload.bill_status : null,
      }).select().single();
      if (data) setBills(prev => [data, ...prev]);
    } catch (_) {}
  }, [session?.user?.id]);

  const store = useMemo(() => ({
    transactions: bills,
    addTransaction,
    profile: {
      email:         client?.email || session?.user?.email || "",
      owner_name:    client?.full_name || "",
      business_name: ownerInfo?.business_name || "",
      id:            session?.user?.id || null,
    },
  }), [bills, addTransaction, client, ownerInfo, session]);

  return (
    <BillPayments
      store={store}
      plan="basic"
      markup={1.098}
      pointsEnabled
      staffName={client?.full_name || null}
      staffEmail={client?.email || session?.user?.email || null}
      businessName={ownerInfo?.business_name || ""}
      excludeCats={["print-airtime", "print-data"]}
    />
  );
}

// ── Main portal ───────────────────────────────────────────────────────────
export default function AjoMemberPortal({ session, ajoClient, pinLock }) {
  const t = useT();
  const toast = useToast();

  const NAV = useMemo(() => makeNav(t), [t]);

  const [client,           setClient]           = useState(ajoClient || null);
  const [contributions,    setContributions]    = useState([]);
  const [cycles,           setCycles]           = useState([]);
  const [rotationsData,    setRotationsData]    = useState([]); // one entry per group membership
  const [rotationLoading,  setRotationLoading]  = useState(false);
  const [ownerInfo,        setOwnerInfo]        = useState(null);
  const [loadingData,      setLoadingData]      = useState(false);
  const [portalLoadError,  setPortalLoadError]  = useState(false);
  const [reloadKey,        setReloadKey]        = useState(0);
  const [tab,              setTab]              = useState(() => {
    // Auto-open Bills tab if returning from a Paystack bill payment redirect
    const p   = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem("ck_bill_pending_" + ref)) return "bills";
    // Also cover bfcache / in-app-browser close without redirect
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return "home";
  });
  const [showWithdraw,     setShowWithdraw]     = useState(false);
  const [showPay,          setShowPay]          = useState(false);
  const [showDeposit,      setShowDeposit]      = useState(false);
  const [withdrawRequests, setWithdrawRequests] = useState([]);
  const [showPwdModal,     setShowPwdModal]     = useState(false);

  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar","tab_card_quad","tab_card_duo"], "ajo_client", "ajo_client.home");
  const ajoTabCard = (camSlots.tab_card_quad || [])[0] ?? (camSlots.tab_card_duo || [])[0] ?? null;
  const annBars = camSlots.announcement_bar || [];
  const { offers: partnerOffers, loading: offersLoading, recordEvent: recordOfferEvent, ctaUrl } = usePartnerOffers("ajo_client");

  const mustChange = session?.user?.user_metadata?.must_change_password === true;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("kuditrack_dark") === "1");
  }, []);

  const retryLoad = useCallback(() => {
    setPortalLoadError(false);
    setLoadingData(true);
    setReloadKey(k => k + 1);
  }, []);

  const refreshWithdrawRequests = useCallback(async () => {
    if (!ajoClient?.id) return;
    try {
      const r = await ajoFn("get-withdrawal-requests", { client_id: ajoClient.id });
      if (r?.requests) setWithdrawRequests(r.requests);
    } catch (e) {
      console.error("Failed to load withdrawal requests:", e);
    }
  }, [ajoClient?.id, ajoClient?.owner_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPortalData = useCallback(async (silent = false) => {
    if (mustChange || !ajoClient?.id) return;
    if (!silent) { setLoadingData(true); setPortalLoadError(false); }
    try {
      const [clientRes, contribRes, ownerRes, reqRes, cycleRes] = await Promise.allSettled([
        ajoFn("get-client",             { client_id: ajoClient.id, owner_id: ajoClient.owner_id }),
        ajoFn("get-contributions",      { client_id: ajoClient.id }),
        ajoFn("get-owner-info",         { owner_id: ajoClient.user_id,  client_id: ajoClient.id }),
        ajoFn("get-withdrawal-requests",{ client_id: ajoClient.id }),
        ajoFn("get-active-cycle",       { client_id: ajoClient.id }),
      ]);
      let resolvedClient = null;
      if (clientRes.status === "fulfilled" && clientRes.value?.client) {
        resolvedClient = {
          ...clientRes.value.client,
          user_id: clientRes.value.client.user_id || ajoClient?.user_id,
        };
        if (resolvedClient.portal_active === false) {
          await supabase.auth.signOut();
          window.location.reload();
          return;
        }
        setClient(resolvedClient);
      }
      if (contribRes.status === "fulfilled" && contribRes.value?.contributions)
        setContributions(contribRes.value.contributions);
      if (ownerRes.status === "fulfilled" && ownerRes.value)
        setOwnerInfo(ownerRes.value);
      if (reqRes.status === "fulfilled" && reqRes.value?.requests)
        setWithdrawRequests(reqRes.value.requests);
      if (cycleRes.status === "fulfilled")
        setCycles(cycleRes.value?.cycles || []);
      if (!silent) {
        const allRejected = [clientRes, contribRes, ownerRes, reqRes, cycleRes]
          .every(r => r.status === "rejected");
        if (allRejected && ajoClient?.current_balance == null) setPortalLoadError(true);
      }
      // Load rotation data for every active group membership
      const memberships = ((resolvedClient || ajoClient)?.group_memberships || [])
        .filter(m => m.status === "active" && m.group_id);
      // Fallback: if group_memberships not yet hydrated but ajo_group_id exists, use it
      const legacyGroupId = (resolvedClient || ajoClient)?.ajo_group_id;
      const groupIds = memberships.length > 0
        ? memberships.map(m => m.group_id)
        : legacyGroupId ? [legacyGroupId] : [];
      if (groupIds.length > 0) {
        if (!silent) setRotationLoading(true);
        Promise.all(
          groupIds.map(gid =>
            ajoFn("get-rotation", { group_id: gid, client_id: ajoClient.id })
              .then(rd => (rd?.group ? rd : null))
              .catch(() => null)
          )
        )
          .then(results => setRotationsData(results.filter(Boolean)))
          .finally(() => { if (!silent) setRotationLoading(false); });
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoadingData(false);
    }
  }, [mustChange, ajoClient?.id, ajoClient?.owner_id, ajoClient?.user_id, ajoClient?.current_balance, ajoClient?.ajo_group_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Thin trigger: runs on initial load, ajoClient change, and manual reloadKey increments
  useEffect(() => {
    fetchPortalData(false);
  }, [fetchPortalData, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stale-closure fix: always call the latest fetchPortalData from refs (used by realtime + resume)
  const fetchPortalDataRef = useRef(fetchPortalData);
  useEffect(() => { fetchPortalDataRef.current = fetchPortalData; }, [fetchPortalData]);

  // Resume-on-foreground — 10 s debounce catches missed changes after backgrounding.
  const lastAjoResumeRef = useRef(0);
  useEffect(() => {
    if (!ajoClient?.id) return;
    const onResume = () => {
      if (Date.now() - lastAjoResumeRef.current < 10_000) return;
      lastAjoResumeRef.current = Date.now();
      fetchPortalDataRef.current?.(true);
    };
    const onVisibility = () => { if (!document.hidden) onResume(); };
    document.addEventListener("visibilitychange", onVisibility);
    let appListener;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) onResume(); })
        .then(l => { appListener = l; });
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      appListener?.remove();
    };
  }, [ajoClient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 20 s silent poll — safety net for when the WebSocket drops without triggering
  // a visibility/appState event (common in Android WebView and weak connections).
  // Realtime still fires immediately for in-range events; the poll only fills gaps.
  useEffect(() => {
    if (!ajoClient?.id) return;
    const id = setInterval(() => {
      if (!document.hidden) fetchPortalDataRef.current?.(true);
    }, 20_000);
    return () => clearInterval(id);
  }, [ajoClient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: sync balance/contributions from business side ────────────
  useEffect(() => {
    if (!ajoClient?.id) return;
    let rtReady = false; // true after first SUBSCRIBED; subsequent fires = reconnect

    const channel = supabase.channel(`ajo_client_sync_${ajoClient.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "aso_clients", filter: `id=eq.${ajoClient.id}` },
        async (payload) => {
          if (!payload.new) return;
          if (payload.new.portal_active === false) {
            await supabase.auth.signOut();
            window.location.reload();
            return;
          }
          setClient(prev => ({ ...prev, ...payload.new }));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ajo_contributions", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          if (!payload.new) return;
          setContributions(prev => [payload.new, ...prev]);
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_contributions", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          if (!payload.new) return;
          setContributions(prev => prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ajo_cycles", filter: `client_id=eq.${ajoClient.id}` },
        () => { fetchPortalDataRef.current(true); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_cycles", filter: `client_id=eq.${ajoClient.id}` },
        () => { fetchPortalDataRef.current(true); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_withdrawal_requests", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          refreshWithdrawRequests();
        })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (rtReady) setReloadKey(k => k + 1); // reconnect after offline — catch up missed changes
          else rtReady = true;
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [ajoClient?.id, ajoClient?.owner_id, ajoClient?.user_id, refreshWithdrawRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  usePushNotifications(session?.user?.id ?? null, (dl) => {
    if (!dl?.tab) return;
    setTab(["home","bills","history","me"].includes(dl.tab) ? dl.tab : "home");
  });

  if (mustChange) return <AjoMemberFirstLogin ajoClient={ajoClient} />;

  const clientId      = ajoClient?.id;

  const avatarInitial = (client?.full_name || ajoClient?.full_name || "M")[0].toUpperCase();

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Header */}
        <header className="flex-none z-sticky bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
          <div style={{ height: "env(safe-area-inset-top, 0px)" }} />
          <div className="h-14 flex items-center justify-between px-4">
          {/* Business identity — falls back to KudiAI brand until ownerInfo loads */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {ownerInfo?.owner?.business_name ? (
              <>
                {ownerInfo.owner.logo_url ? (
                  <div className="w-8 h-8 rounded-xl flex-shrink-0 overflow-hidden bg-navy relative flex items-center justify-center">
                    <span className="text-white font-black text-sm leading-none select-none">
                      {ownerInfo.owner.business_name[0].toUpperCase()}
                    </span>
                    <img src={ownerInfo.owner.logo_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />
                  </div>
                ) : (
                  <AppLogo className="h-8 w-8 flex-none" />
                )}
                <p className="text-[15px] font-black text-slate-800 dark:text-white leading-tight truncate" style={{ maxWidth: 160 }}>
                  {ownerInfo.owner.business_name}
                </p>
              </>
            ) : (
              <>
                <AppLogo className="h-8 w-8 flex-none" />
                <span className="text-[17px] font-black tracking-tight leading-none select-none">
                  <span className="bg-gradient-to-br from-brand-500 to-brand-600 bg-clip-text text-transparent">KudiAI</span>
                  <span className="text-navy dark:text-slate-200"> Track</span>
                </span>
              </>
            )}
          </div>

          <div className="flex-none flex items-center gap-2">
            {loadingData && <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />}
            <NotificationCenter
              userId={client?.client_user_id ?? session?.user?.id ?? null}
              onNavigate={(dl) => {
                if (!dl?.tab) return;
                setTab(["home","bills","history","me"].includes(dl.tab) ? dl.tab : "home");
              }}
              toast={toast}
            />
            <button onClick={() => setTab("me")}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 relative flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden">
              <span className="text-sm font-black text-white">{avatarInitial}</span>
              {client?.profile_image_url && <img src={client.profile_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = "none"} />}
            </button>
          </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordCamEvent} />
          {tab === "home" && client && (
            <OverviewTab
              client={client}
              userEmail={client?.email || null}
              contributions={contributions}
              cycles={cycles}
              rotationsData={rotationsData}
              rotationLoading={rotationLoading}
              onWithdrawClick={() => setShowWithdraw(true)}
              onPayClick={() => setShowPay(true)}
              onDepositClick={() => setShowDeposit(true)}
              ownerInfo={ownerInfo}
              withdrawRequests={withdrawRequests}
              onBillsClick={() => setTab("bills")}
              onGoToMe={() => setTab("me")}
            />
          )}
          {tab === "bills" && client && (
            <div className="h-full overflow-y-auto">
              <AjoMemberBillsWrapper
                client={client}
                ownerInfo={ownerInfo}
                session={session}
              />
            </div>
          )}
          {tab === "history" && client && (
            <HistoryTab
              contributions={contributions}
              withdrawRequests={withdrawRequests}
              client={client}
              ownerInfo={ownerInfo}
              cycles={cycles}
              rotationsData={rotationsData}
            />
          )}
          {tab === "me" && (
            <AjoMemberMe
              client={client || ajoClient}
              session={session}
              clientId={clientId}
              pinLock={pinLock}
              onChangePwdClick={() => setShowPwdModal(true)}
              onProfileUpdate={updates => setClient(prev => ({ ...prev, ...updates }))}
              contributions={contributions}
              cycles={cycles}
            />
          )}
          {!client && tab === "home" && <SkeletonHome />}
          {!client && tab === "bills" && <SkeletonBills />}
          {!client && tab === "history" && <SkeletonHistory />}
          {/* Offers section — max 1 per session on client portal */}
          {tab === "home" && (
            <>
              {ajoTabCard && ajoTabCard.slot === "tab_card_quad" && (
                <TabCardQuadSlot campaign={ajoTabCard} pageKey="ajo_client.home" recordEvent={recordCamEvent} />
              )}
              {ajoTabCard && ajoTabCard.slot === "tab_card_duo" && (
                <TabCardDuoSlot campaign={ajoTabCard} pageKey="ajo_client.home" recordEvent={recordCamEvent} />
              )}
              <OffersSection
                offers={partnerOffers}
                loading={offersLoading}
                recordEvent={recordOfferEvent}
                ctaUrl={ctaUrl}
                title="Offers for Members"
                maxShown={1}
              />
            </>
          )}
        </main>

        {/* Load-failure banner — all 5 RPCs rejected and no fallback balance available */}
        {portalLoadError && !loadingData && (
          <div className="absolute bottom-[70px] inset-x-0 z-50 px-4">
            <div className="bg-orange-600 text-white rounded-2xl px-4 py-3 shadow-xl flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Couldn't load your data</p>
                <p className="text-xs opacity-80 mt-0.5">Check your connection and try again.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={retryLoad}
                  disabled={loadingData}
                  className="text-xs font-bold bg-white/20 hover:bg-white/30 px-2 py-1 rounded-lg disabled:opacity-50 transition-opacity"
                >
                  Retry
                </button>
                <button onClick={() => setPortalLoadError(false)} className="text-white/70 hover:text-white">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Powered by card — always visible above bottom nav on client portals */}
        <PoweredByCardSlot portalType="ajo_client" businessId={client?.owner_id} />

        {/* Bottom nav */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-stretch h-[62px]">
            {NAV.map(n => {
              const active = tab === n.id;
              return (
                <button key={n.id} onClick={() => setTab(n.id)}
                  className="flex-1 flex items-center justify-center focus-visible:outline-none active:opacity-70 transition-opacity">
                  <div className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-all duration-200 ${
                    active ? "bg-brand-50 dark:bg-brand-900/30" : ""
                  }`}>
                    <Icon name={n.icon} size={20} className={active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
                    <span className={`text-[11px] font-bold leading-none ${active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
                      {n.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-slate-900" />
        </nav>

      </div>

      {showPay && client && (
        <PayContributionModal
          client={client}
          clientGroups={client?.group_memberships?.filter(m => m.status === "active") || []}
          cycles={cycles}
          onClose={() => setShowPay(false)}
          onSuccess={(ref, updatedClient) => {
            if (updatedClient) setClient(prev => ({ ...prev, ...updatedClient }));
          }}
        />
      )}
      {showWithdraw && client && (
        <WithdrawRequestModal
          client={client}
          cycles={cycles}
          clientGroups={client?.group_memberships?.filter(m => m.status === "active") || []}
          rotationsData={rotationsData}
          contributions={contributions}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { setShowWithdraw(false); refreshWithdrawRequests(); }}
        />
      )}
      {showDeposit && client && (
        <ManualDepositModal
          client={client}
          clientGroups={client?.group_memberships?.filter(m => m.status === "active") || []}
          cycles={cycles}
          ownerInfo={ownerInfo}
          onClose={() => setShowDeposit(false)}
          onSuccess={() => setShowDeposit(false)}
        />
      )}
      {showPwdModal && (
        <ChangePasswordModal onClose={() => setShowPwdModal(false)} />
      )}

      {client && (
        <AIChatWidget
          portalContext={buildAjoMemberContext(client, contributions, ownerInfo)}
          greeting={`${greetingText(t)}${client.full_name ? `, ${client.full_name.split(" ")[0]}` : ""}! I'm **KudiAI**, your Ajo savings assistant.\n\nI know your balance, contributions, and savings history. Ask me anything!`}
          quickChips={[
            { label: t("aiChip.mySavings")         || "My Balance",           q: "What is my current savings balance?" },
            { label: t("portal.nextPayment")        || "Next Contribution",    q: "When is my next contribution due?" },
            { label: t("portal.history")            || "Contribution History", q: "Show my recent contribution history" },
            { label: t("aiChip.coopBenefits")       || "Savings Goal",        q: "How am I doing with my savings goal?" },
            { label: t("aiChip.mySavings") + " Tips"|| "Savings Tips",        q: "Give me tips to save more consistently" },
          ]}
          inputPlaceholder={t("aiChip.ajoPlaceholder") || "Ask about your savings…"}
        />
      )}
    </div>
  );
}


