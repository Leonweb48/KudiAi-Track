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
import { useNotifications } from "../hooks/useNotifications";
import { useCampaigns } from "../hooks/useCampaigns";
import { usePartnerOffers } from "../hooks/usePartnerOffers";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import OffersSection from "../components/slots/OffersSection";
import PoweredByCardSlot from "../components/slots/PoweredByCardSlot";
import TabCardQuadSlot from "../components/slots/TabCardQuadSlot";
import TabCardDuoSlot from "../components/slots/TabCardDuoSlot";
import TransactionPinModal from "../components/TransactionPinModal";
import NotificationCenter, { NotificationBell } from "../components/NotificationCenter";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildAjoContributionReceipt, buildAjoWithdrawalReceipt } from "../utils/receiptConfig";
import AIChatWidget from "../components/AIChatWidget";
import { buildAjoMemberContext } from "../utils/buildContext";
import AppLogo from "../components/AppLogo";
import { useT, useLanguage } from "../contexts/LanguageContext";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
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
  const ext  = file.name.split(".").pop();
  const path = `ajo/${clientId}/avatar.${ext}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  const base = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return `${base}?v=${Date.now()}`;
}

async function uploadAjoProof(file, clientId) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Image must be under 2 MB");
  const ext  = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${clientId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("ajo-proofs").upload(path, file, { contentType: file.type });
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
    a: "A registration fee may apply on your first withdrawal. Subsequent ones may carry a percentage fee. The breakdown is shown before you confirm any withdrawal." },
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

// ── Pay Contribution modal ────────────────────────────────────────────────
// Contribution type selector — shown only when client is in a group (2 options)
function ContribTypeSelector({ clientGroup, value, onChange }) {
  if (!clientGroup) return null;
  const opts = [
    { key: "personal_savings", label: "Personal Savings", desc: "Add to your personal savings balance" },
    clientGroup.group_mode === "rotating"
      ? { key: "esusu_rotation", label: clientGroup.name, desc: "Esusu Rotation — contribute to the pot" }
      : { key: "group_savings",  label: clientGroup.name, desc: "Savings Group — contribute to the pool" },
  ];
  return (
    <div className="mb-5">
      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Contributing to</p>
      <div className="space-y-2">
        {opts.map(opt => (
          <button key={opt.key} type="button" onClick={() => onChange(opt.key)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition ${
              value === opt.key
                ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                : "border-slate-200 dark:border-slate-700"
            }`}>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold text-slate-800 dark:text-white truncate">{opt.label}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{opt.desc}</p>
            </div>
            <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              value === opt.key ? "border-brand-500 bg-brand-500" : "border-slate-300 dark:border-slate-600"
            }`}>
              {value === opt.key && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PayContributionModal({ client, clientGroup, onClose, onSuccess }) {
  const [status,     setStatus]    = useState("idle"); // idle | loading | awaiting | verifying | done | error
  const [message,    setMessage]   = useState("");
  const [pendingRef, setPendingRef] = useState(null);
  const [paidAmt,    setPaidAmt]   = useState(0);
  const [customAmt,  setCustomAmt] = useState(String(client?.contribution_amount || ""));
  const [txnPin,     setTxnPin]    = useState(null);
  const [showShare,  setShowShare] = useState(false);
  const [contribCtx, setContribCtx] = useState("personal_savings");
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
      const res = await ajoFn("initialize-payment", { client_id: client.id, amount: amt, contribution_context: contribCtx });
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
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#16255A,#3DA829)" }} />

        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          {/* Checkmark */}
          <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6 shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 text-green-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <p className="text-[11px] font-bold text-green-500 uppercase tracking-widest mb-1">Transaction Successful</p>
          <AmountDisplay amount={paidAmt || client?.contribution_amount || 0} size="hero" align="center" style={{ marginBottom: 4 }} />
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 capitalize">
            {contribCtx === "esusu_rotation" ? "Esusu Rotation" : contribCtx === "group_savings" ? "Savings Group" : "Personal Savings"} · Paid via Paystack
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
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-2xl flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-extrabold text-slate-800 dark:text-white">Pay Contribution</p>
            <p className="text-[11px] text-slate-400">Secure payment via Paystack</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step indicator — visible during active payment flow */}
        {(status === "loading" || status === "awaiting" || status === "verifying") && (
          <div className="flex items-center mb-5 px-1">
            {["loading", "awaiting", "verifying"].map((step, i) => {
              const steps = ["loading", "awaiting", "verifying"];
              const cur = steps.indexOf(status);
              const isDone = i < cur;
              const isActive = i === cur;
              const labels = ["Opening", "Paying", "Confirming"];
              return (
                <div key={step} className="flex items-center flex-1">
                  {i > 0 && <div className={`flex-1 h-0.5 rounded-full mx-1 ${isDone ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />}
                  <div className="flex flex-col items-center gap-0.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold ${
                      isDone    ? "bg-brand-500 text-white"
                      : isActive ? "bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 ring-2 ring-brand-400"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-400"
                    }`}>
                      {isDone
                        ? <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        : <span className="text-[10px]">{i + 1}</span>}
                    </div>
                    <span className={`text-[9px] font-bold leading-none ${isActive ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>{labels[i]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ContribTypeSelector clientGroup={clientGroup} value={contribCtx} onChange={setContribCtx} />

        {/* Amount */}
        <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-4 mb-5">
          <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-2">Amount to Contribute</p>
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
              Reset to default (₦{fmt(client.contribution_amount)})
            </button>
          )}
          <p className="text-[11px] text-slate-400 mt-1 capitalize">{client?.contribution_frequency} contribution</p>
        </div>

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
              : "I've completed payment — tap to confirm"}
          </button>
        )}

        <button
          onClick={() => {
            const amt = parseFloat(customAmt);
            if (!amt || amt <= 0) { setMessage("Please enter a valid amount."); return; }
            setTxnPin({
              title: "Confirm Contribution",
              amount: Math.round(amt * 100),
              description: "Savings contribution via Paystack",
              onApprove: () => { setTxnPin(null); handlePay(); },
            });
          }}
          disabled={status === "loading" || status === "awaiting" || status === "verifying"}
          className="w-full py-4 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2 shadow-md">
          {status === "loading"
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Opening Paystack…</>
            : status === "awaiting" ? "Open Paystack again"
            : <>Pay ₦{fmt(parseFloat(customAmt) || 0)} now</>}
        </button>
        <button onClick={onClose} disabled={status === "loading" || status === "verifying"}
          className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center py-2">
          Cancel
        </button>
        {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
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
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
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
function ManualDepositModal({ client, clientGroup, ownerInfo, onClose, onSuccess }) {
  const [amount,      setAmount]      = useState("");
  const [payerName,   setPayerName]   = useState("");
  const [notes,       setNotes]       = useState("");
  const [proofFile,   setProofFile]   = useState(null);
  const [proofPrev,   setProofPrev]   = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [done,        setDone]        = useState(false);
  const [contribCtx,  setContribCtx]  = useState("personal_savings");
  const [copiedField, setCopiedField] = useState(null);
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
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Pending Review</p>
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-white mb-3">Transfer Submitted</h3>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 mb-5 text-left">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">Your balance has NOT been credited yet</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">Your savings agent will verify the bank transfer. Your balance will only be updated after confirmation — this may take a few hours.</p>
            </div>
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
                <p className="text-[11px] text-slate-400">Transfer then submit your claim below</p>
              </div>
            </div>

            <ContribTypeSelector clientGroup={clientGroup} value={contribCtx} onChange={setContribCtx} />

            {/* Bank details */}
            {hasBank ? (() => {
              const isClientAcct = !!clientBank?.account_number;
              const acctNum  = isClientAcct ? clientBank.account_number  : ownerBank.bank_account_number;
              const acctName = isClientAcct ? clientBank.account_name    : ownerBank.bank_account_name;
              const bankName = isClientAcct ? clientBank.bank_name       : ownerBank.bank_name;
              return (
                <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-4 mb-4">
                  <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-3">
                    {isClientAcct ? "Your Dedicated Savings Account" : "Business Bank Account"}
                  </p>
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

            <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-4 mb-3">
              <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-2">Amount Transferred <span className="text-red-400">*</span></p>
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

            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Sender Name (optional)</label>
            <input
              type="text"
              value={payerName} onChange={e => setPayerName(e.target.value)}
              placeholder="Name on the transfer receipt"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            />

            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Reference / Note (optional)</label>
            <input
              type="text"
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. January contribution"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            />

            {/* Proof upload */}
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Proof of Transfer (optional)</label>
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
                className="w-full py-3 mb-3 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-400 dark:text-slate-500 flex items-center justify-center gap-2 active:scale-[0.99] transition">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                </svg>
                Upload screenshot (≤ 2 MB)
              </button>
            )}

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving || uploading || !amtNum || amtNum <= 0}
              className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm flex items-center justify-center gap-2">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
                : "Submit Deposit Claim"}
            </button>

            <p className="text-[10px] text-slate-400 text-center mt-3">
              Your claim will be reviewed by your savings agent before your balance is updated.
            </p>
          </>
        )}
      </div>
    </div>
    </>
  );
}

// ── Withdrawal request modal ──────────────────────────────────────────────
function WithdrawRequestModal({ client, onClose, onSuccess }) {
  const [amount,  setAmount]  = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [done,    setDone]    = useState(false);
  const [txnPin,  setTxnPin]  = useState(null);

  const isFirst  = (client.total_withdrawn || 0) === 0;
  const regFee   = client.registration_charge || 0;
  const pctFee   = client.withdrawal_fee_percent || 0;
  const amtNum   = parseFloat(amount) || 0;
  const feeAmt   = isFirst ? regFee : (amtNum * pctFee / 100);
  const netAmt   = amtNum - feeAmt;

  const handleSubmit = async () => {
    if (!amtNum || amtNum <= 0)                   { setError("Enter a valid amount"); return; }
    if (amtNum > (client.current_balance || 0))   { setError("Amount exceeds your balance"); return; }
    if (netAmt <= 0)                              { setError("Amount too small after fee deduction"); return; }
    setSaving(true); setError("");
    try {
      await ajoFn("request-withdrawal", {
        client_id: client.id,
        owner_id:  client.user_id,
        amount:    amtNum,
      });
      setDone(true);
      onSuccess();
    } catch (e) {
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
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Request Submitted!</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">You'll be notified by email once your request is reviewed.</p>
            <button onClick={onClose} className="mt-5 w-full py-3.5 bg-brand-500 text-white rounded-xl font-bold text-sm">
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Header with balance */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M12 19V5M5 12l7 7 7-7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-slate-800 dark:text-white">Request Withdrawal</p>
                <p className="text-[11px] text-slate-400">Available: <strong className="text-slate-600 dark:text-slate-300">{fmt(client.current_balance || 0)}</strong></p>
              </div>
            </div>

            {/* Amount input */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-4 py-4 mb-3">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Withdrawal Amount</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-slate-700 dark:text-slate-200">₦</span>
                <input
                  type="number" inputMode="decimal" min="1"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-black text-slate-700 dark:text-slate-200 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              {amtNum > (client.current_balance || 0) && (
                <p className="text-[11px] text-red-500 mt-1">Exceeds available balance</p>
              )}
            </div>

            {/* Fee breakdown card — always visible, shows rule and live calculation */}
            <div className="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 mb-3 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {isFirst && regFee > 0 ? `First withdrawal · flat fee ${fmt(regFee)}`
                  : pctFee > 0 ? `Withdrawal fee · ${pctFee}%`
                  : "No withdrawal fee"}
              </p>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Requested</span>
                <span className="font-bold text-slate-700 dark:text-slate-200">{amtNum > 0 ? fmt(amtNum) : "—"}</span>
              </div>
              {feeAmt > 0 && amtNum > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{isFirst ? "Registration fee" : `Fee (${pctFee}%)`}</span>
                  <span className="font-bold text-red-500">−{fmt(feeAmt)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs border-t border-slate-200 dark:border-slate-600 pt-2">
                <span className="font-extrabold text-slate-600 dark:text-slate-300">You receive</span>
                <span className={`font-extrabold ${amtNum > 0 && netAmt > 0 ? "text-green-600 dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                  {amtNum > 0 ? fmt(Math.max(0, netAmt)) : "—"}
                </span>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <button
              onClick={() => {
                if (!amtNum || amtNum <= 0) { setError("Enter a valid amount"); return; }
                if (amtNum > (client.current_balance || 0)) { setError("Amount exceeds your balance"); return; }
                if (netAmt <= 0) { setError("Amount too small after fee deduction"); return; }
                setTxnPin({
                  title: "Request Withdrawal",
                  amount: Math.round(netAmt * 100),
                  description: "Savings withdrawal request",
                  onApprove: () => { setTxnPin(null); handleSubmit(); },
                });
              }}
              disabled={saving || !amtNum || amtNum <= 0}
              className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm">
              {saving ? "Submitting…" : "Submit Request"}
            </button>
          </>
        )}
      </div>
    </div>
    {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
    </>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ client, contributions, cycle, rotationData, rotationLoading, onWithdrawClick, onPayClick, onDepositClick, ownerInfo, withdrawRequests = [], onBillsClick, userEmail }) {
  const t = useT();
  const { lang } = useLanguage();

  const [goal,         setGoal]        = useState(0);
  const [editGoal,     setEditGoal]    = useState(false);
  const [goalInput,    setGoalInput]   = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);

  const [balanceHidden, setBalanceHidden] = useState(() =>
    sessionStorage.getItem("ajo_balance_hidden") === "1"
  );
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
        : { type: "tip",  text: `${fmt(client.total_saved || 0)} saved so far. Keep it up!` };

  const daysUntilDue = client.next_contribution_date
    ? Math.ceil((new Date(client.next_contribution_date) - new Date()) / 86400000)
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
      <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg"
        style={{ background: "linear-gradient(145deg,#16255A 0%,#1D3070 55%,#0F1A42 100%)" }}>
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
            : <AmountDisplay amount={client.current_balance || 0} size="hero" align="left" style={{ color: '#fff', marginBottom: 12 }} />
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
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Total Saved</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={client.total_saved || 0} size="small" align="left" style={{ color: '#bbf7d0' }} />
              }
            </div>
            <div className="px-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Withdrawn</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={client.total_withdrawn || 0} size="small" align="left" style={{ color: '#fecaca' }} />
              }
            </div>
            <div className="pl-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">This Month</p>
              {balanceHidden
                ? <p className="text-sm font-black text-white/40 tracking-widest select-none">• • •</p>
                : <AmountDisplay amount={totalThisMonth} size="small" align="left" style={{ color: '#bfdbfe' }} />
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
          <div className="w-11 h-11 rounded-xl bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center flex-shrink-0 overflow-hidden border border-brand-100 dark:border-brand-800">
            {ownerInfo.staff.profile_image_url
              ? <img src={ownerInfo.staff.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-brand-500 dark:text-brand-400 font-black text-lg">{(ownerInfo.staff.full_name || "?")[0].toUpperCase()}</span>
            }
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
      {((client.registration_charge > 0) || (client.withdrawal_fee_percent > 0)) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-brand-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Withdrawal Fees</p>
            {(client.total_withdrawn || 0) === 0 && client.registration_charge > 0 ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                First withdrawal: <span className="text-brand-500 dark:text-brand-400 font-bold">{fmt(client.registration_charge)} registration fee</span>
              </p>
            ) : client.withdrawal_fee_percent > 0 ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Withdrawal fee: <span className="text-brand-500 dark:text-brand-400 font-bold">{client.withdrawal_fee_percent}% of amount</span>
              </p>
            ) : null}
          </div>
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
                <button onClick={() => {
                  setClearConfirm(false); setGoal(0);
                  ajoFn("delete-goal", { client_id: client.id }).catch(() => null);
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
              <button onClick={() => {
                const g = parseFloat(goalInput) || 0;
                if (g > 0) { setGoal(g); ajoFn("set-goal", { client_id: client.id, target_amount: g }).catch(() => null); }
                setEditGoal(false);
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

      {/* Contribution card (shown when a cycle is active) */}
      {cycle && (
        <ContributionCard
          cycle={cycle}
          contributions={contributions}
          frequency={client?.contribution_frequency}
          clientName={client?.full_name || ""}
          businessName={ownerInfo?.owner?.business_name || ""}
        />
      )}

      {/* Esusu rotation dashboard (shown when member is in a rotating group with an active round) */}
      {(rotationData?.round || rotationLoading) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ajo Rotation</p>
          <EsusuRotationDashboard
            data={rotationData}
            loading={rotationLoading}
            isOwner={false}
            myClientId={client?.id}
            onRefresh={null}
          />
        </div>
      )}

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
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{ledgerTypeLabel(c.type)}</p>
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
            { label: "Type",   value: ledgerTypeLabel(item.type) },
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
function HistoryTab({ contributions, withdrawRequests = [], client, ownerInfo }) {
  const [typeFilter,     setTypeFilter]     = useState("all");
  const [receipt,        setReceipt]        = useState(null);
  const [pendingSheet,   setPendingSheet]   = useState(null);
  const [disputeFor,     setDisputeFor]     = useState(null);
  const [disputeDesc,    setDisputeDesc]    = useState("");
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError,   setDisputeError]   = useState("");
  const [disputeToast,   setDisputeToast]   = useState(false);
  const [disputedIds,    setDisputedIds]    = useState(() => new Set());

  const withdrawItems = withdrawRequests.map(r => ({
    _type: "withdrawal_request",
    id: r.id, amount: r.amount, net_amount: r.net_amount,
    fee_amount: r.fee_amount, fee_type: r.fee_type,
    status: r.status, date: r.requested_at,
  }));
  const contribItems = contributions.map(c => ({ _type: "contribution", ...c, date: c.created_at }));
  const allItems = [...withdrawItems, ...contribItems].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Build set of IDs that were reversed (reversal entries point back via reversal_of / source_id)
  const reversedIdSet = new Set(
    contributions
      .filter(c => c.type?.startsWith("reversal_"))
      .map(c => c.reversal_of || c.reversal_of_id || c.source_id || c.linked_id)
      .filter(Boolean)
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
      const desc    = isWdReq ? "Withdrawal Request (Pending)" : ledgerTypeLabel(item.type);
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
        { label: "Total Saved",     value: pdfFmt(client?.total_saved || totC) },
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
                {isWdReq ? "Withdrawal Request" : ledgerTypeLabel(item.type)}
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

      {/* Dispute success toast (AMP-21) */}
      {disputeToast && (
        <div className="fixed bottom-24 inset-x-4 z-[280] bg-green-600 text-white text-sm font-bold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-[fadeIn_0.2s_ease]">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Dispute submitted — we'll review your case
        </div>
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
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-xl">
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
                    setDisputeToast(true);
                    setTimeout(() => setDisputeToast(false), 3500);
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
function AjoMemberMe({ client, session, clientId, pinLock, onChangePwdClick, onProfileUpdate, contributions = [] }) {
  const [view,           setView]           = useState("menu");
  const [editForm,       setEditForm]       = useState({
    full_name: client?.full_name || "",
    phone:     client?.phone     || "",
    email:     client?.email     || session?.user?.email || "",
    address:   client?.address   || "",
    state:     client?.state     || "",
    lga:       client?.lga       || "",
    ward:      client?.ward      || "",
    nin:       client?.nin       || "",
    nok_name:  client?.next_of_kin_name    || "",
    nok_phone: client?.next_of_kin_phone   || "",
    nok_email: client?.next_of_kin_email   || "",
    nok_addr:  client?.next_of_kin_address || "",
  });
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
        `Total saved: ₦${(client?.total_saved || 0).toLocaleString("en-NG")}`,
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
      await supabase.from("aso_clients").update(payload).eq("id", clientId);
      const changedFields = Object.keys(payload).filter(k => k !== "profile_image_url");
      ajoFn("log-profile-update", { client_id: clientId, fields_changed: changedFields }).catch(() => {});
      onProfileUpdate?.(payload);
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("profile"); }, 1500);
    } catch { setSaveMsg("Save failed. Please try again."); }
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
              <div className="w-24 h-24 rounded-full bg-brand-500 flex items-center justify-center shadow-lg overflow-hidden ring-2 ring-brand-200 dark:ring-brand-800">
                {avatarSrc
                  ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-black text-white">{initials}</span>}
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
              <div className="w-24 h-24 rounded-full bg-brand-500 flex items-center justify-center shadow-lg overflow-hidden ring-2 ring-brand-200 dark:ring-brand-800">
                {avatarSrcEdit
                  ? <img src={avatarSrcEdit} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-black text-white">{initials}</span>}
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
                ["Withdrawal Fee", client?.withdrawal_fee_percent != null ? `${client.withdrawal_fee_percent}%` : null],
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
          <button onClick={() => setView("profile")}
            className="w-full flex items-center gap-4 px-4 py-4 text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
            <div className="w-12 h-12 rounded-full bg-brand-500 flex-shrink-0 overflow-hidden shadow-sm ring-2 ring-brand-100 dark:ring-brand-900/40">
              {(photoPreview || client?.profile_image_url)
                ? <img src={photoPreview || client.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="w-full h-full flex items-center justify-center text-base font-black text-white">{initials}</span>}
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
            className="w-72 h-72 rounded-full overflow-hidden flex-shrink-0"
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
            {(photoPreview || client?.profile_image_url)
              ? <img src={photoPreview || client.profile_image_url} alt={client?.full_name || "Avatar"}
                  className="w-full h-full object-cover" draggable={false} />
              : <div className="w-full h-full bg-brand-500 flex items-center justify-center">
                  <span className="text-7xl font-black text-white">{initials}</span>
                </div>}
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

  const NAV = useMemo(() => makeNav(t), [t]);

  const [client,           setClient]           = useState(ajoClient || null);
  const [contributions,    setContributions]    = useState([]);
  const [cycle,            setCycle]            = useState(null);
  const [rotationData,     setRotationData]     = useState(null);
  const [rotationLoading,  setRotationLoading]  = useState(false);
  const [ownerInfo,        setOwnerInfo]        = useState(null);
  const [loadingData,      setLoadingData]      = useState(false);
  const [isStale,          setIsStale]          = useState(false);
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

  const notif = useNotifications(ajoClient?.id);

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
    setIsStale(false);
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

  useEffect(() => {
    if (mustChange || !ajoClient?.id) return;
    setLoadingData(true);
    setPortalLoadError(false);
    Promise.allSettled([
      ajoFn("get-client",             { client_id: ajoClient.id, owner_id: ajoClient.owner_id }),
      ajoFn("get-contributions",      { client_id: ajoClient.id }),
      ajoFn("get-owner-info",         { owner_id: ajoClient.user_id,  client_id: ajoClient.id }),
      ajoFn("get-withdrawal-requests",{ client_id: ajoClient.id }),
      ajoFn("get-active-cycle",       { client_id: ajoClient.id }),
    ])
      .then(([clientRes, contribRes, ownerRes, reqRes, cycleRes]) => {
        let resolvedClient = null;
        if (clientRes.status === "fulfilled" && clientRes.value?.client) {
          resolvedClient = {
            ...clientRes.value.client,
            user_id: clientRes.value.client.user_id || ajoClient?.user_id,
          };
          setClient(resolvedClient);
        }
        if (contribRes.status === "fulfilled" && contribRes.value?.contributions)
          setContributions(contribRes.value.contributions);
        if (ownerRes.status === "fulfilled" && ownerRes.value)
          setOwnerInfo(ownerRes.value);
        if (reqRes.status === "fulfilled" && reqRes.value?.requests)
          setWithdrawRequests(reqRes.value.requests);
        if (cycleRes.status === "fulfilled" && cycleRes.value?.cycle)
          setCycle(cycleRes.value.cycle);

        // Determine error / stale state based on what succeeded
        const allRejected = [clientRes, contribRes, ownerRes, reqRes, cycleRes]
          .every(r => r.status === "rejected");
        if (clientRes.status === "fulfilled") {
          setIsStale(false);
        } else if (allRejected) {
          if (ajoClient?.current_balance != null) {
            setIsStale(true);
          } else {
            setIsStale(false);
            setPortalLoadError(true);
          }
        } else {
          // clientRes rejected but some calls succeeded — balance is auth-token fallback
          setIsStale(true);
        }

        // Fetch rotation data if the client belongs to a rotating group
        const groupId = (resolvedClient || ajoClient)?.ajo_group_id;
        if (groupId) {
          setRotationLoading(true);
          ajoFn("get-rotation", { group_id: groupId, client_id: ajoClient.id })
            .then(rd => {
              if (rd?.group) setRotationData(rd);
              else console.warn("[rotation] response missing group:", rd);
            })
            .catch(e => console.error("[rotation] fetch failed:", e?.message))
            .finally(() => setRotationLoading(false));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [mustChange, ajoClient?.id, ajoClient?.owner_id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: sync balance/contributions from business side ────────────
  useEffect(() => {
    if (!ajoClient?.id) return;

    const channel = supabase.channel(`ajo_client_sync_${ajoClient.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "aso_clients", filter: `id=eq.${ajoClient.id}` },
        (payload) => { if (payload.new) setClient(prev => ({ ...prev, ...payload.new })); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ajo_contributions", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          if (!payload.new) return;
          setContributions(prev => [payload.new, ...prev]);
          const amt = `₦${Number(payload.new.amount || 0).toLocaleString("en-NG")}`;
          if (payload.new.type === "withdrawal") {
            notif.addNotification("aso", "Payment Processed", `${amt} paid out to you`);
          } else if (payload.new.type === "reversal") {
            notif.addNotification("aso", "Transaction Reversed", `${amt} reversal applied to your account`);
          } else if (payload.new.status !== "pending") {
            notif.addNotification("aso", "Contribution Recorded", `${amt} saved successfully`);
          }
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_contributions", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          if (!payload.new) return;
          setContributions(prev => prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
          const amt = `₦${Number(payload.new.amount || 0).toLocaleString("en-NG")}`;
          if (payload.new.payment_method === "manual_transfer") {
            if (payload.new.status === "completed") {
              notif.addNotification("aso", "Deposit Confirmed", `${amt} bank transfer confirmed and added to your balance`);
            } else if (payload.new.status === "rejected") {
              notif.addNotification("aso", "Deposit Declined", `Your ${amt} bank transfer claim was not confirmed`);
            }
          } else if (payload.new.type === "contribution" && payload.new.status === "completed" && payload.old?.status === "pending") {
            notif.addNotification("aso", "Contribution Approved", `Your ${amt} contribution has been approved and added to your balance`);
          }
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_withdrawal_requests", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => {
          refreshWithdrawRequests();
          if (payload.new?.status === "rejected") {
            const amt = `₦${Number(payload.new.amount || 0).toLocaleString("en-NG")}`;
            notif.addNotification("aso", "Withdrawal Declined", `Your ${amt} withdrawal request was declined`);
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ajoClient?.id, ajoClient?.owner_id, ajoClient?.user_id, refreshWithdrawRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mustChange) return <AjoMemberFirstLogin ajoClient={ajoClient} />;

  const clientId      = ajoClient?.id;
  const avatarInitial = (client?.full_name || ajoClient?.full_name || "M")[0].toUpperCase();

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Header */}
        <header className="flex-none z-30 min-h-[56px] flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>

          {/* Business identity — falls back to KudiAI brand until ownerInfo loads */}
          <div className="flex items-center gap-2 flex-none min-w-0">
            {ownerInfo?.owner?.business_name ? (
              <>
                <div className="w-8 h-8 rounded-xl flex-shrink-0 overflow-hidden bg-navy flex items-center justify-center">
                  <span className="text-white font-black text-sm leading-none select-none">
                    {ownerInfo.owner.business_name[0].toUpperCase()}
                  </span>
                </div>
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
            <NotificationBell unreadCount={notif.unreadCount} onClick={() => notif.setOpen(true)} />
            <button onClick={() => setTab("me")}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden">
              {client?.profile_image_url
                ? <img src={client.profile_image_url} alt="" className="w-9 h-9 object-cover" />
                : <span className="text-sm font-black text-white">{avatarInitial}</span>}
            </button>
          </div>
        </header>

        {/* Stale-data indicator — shown when balance comes from auth-token fallback */}
        {isStale && (
          <div className="flex-none flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/30">
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-snug">
              {loadingData ? "Checking balance…" : "Showing last known balance — reconnect to refresh"}
            </p>
            {loadingData ? (
              <svg className="animate-spin h-4 w-4 text-amber-600 dark:text-amber-400 ml-3 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : (
              <button onClick={retryLoad} className="text-xs font-bold text-amber-700 dark:text-amber-400 ml-3 flex-shrink-0 active:opacity-60">
                Refresh
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordCamEvent} />
          {tab === "home" && client && (
            <OverviewTab
              client={client}
              userEmail={client?.email || session?.user?.email}
              contributions={contributions}
              cycle={cycle}
              rotationData={rotationData}
              rotationLoading={rotationLoading}
              onWithdrawClick={() => setShowWithdraw(true)}
              onPayClick={() => setShowPay(true)}
              onDepositClick={() => setShowDeposit(true)}
              ownerInfo={ownerInfo}
              withdrawRequests={withdrawRequests}
              onBillsClick={() => setTab("bills")}
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

        {/* Notification Center */}
        <NotificationCenter notif={notif} allowedTypeKeys={["aso", "bills", "system"]} />

      </div>

      {showPay && client && (
        <PayContributionModal
          client={client}
          clientGroup={rotationData?.group || null}
          onClose={() => setShowPay(false)}
          onSuccess={(ref, updatedClient) => {
            if (updatedClient) setClient(prev => ({ ...prev, ...updatedClient }));
          }}
        />
      )}
      {showWithdraw && client && (
        <WithdrawRequestModal
          client={client}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { setShowWithdraw(false); refreshWithdrawRequests(); }}
        />
      )}
      {showDeposit && client && (
        <ManualDepositModal
          client={client}
          clientGroup={rotationData?.group || null}
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


