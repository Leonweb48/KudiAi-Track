import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { openPaystackPopup } from "../utils/paystackCheckout";
import { supabase } from "../utils/supabase";
import BillPayments from "./BillPayments";
import CashbackCard from "../components/CashbackCard";
import { fmt, fmtDate, fmtDateTime, ledgerTypeLabel } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import { useBiometricLock } from "../hooks/useBiometricLock";
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

function Row({ icon, label, sub, onClick, right }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-[14px] text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
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

function RowIcon({ d }) {
  return <Svg d={d} size={20} color="#64748b" />;
}

// ── Skeleton loader ────────────────────────────────────────────────────────
function SkeletonHome() {
  const S = ({ w = "w-full", h = "h-4", r = "rounded-xl" }) => (
    <div className={`${w} ${h} ${r} bg-slate-200 dark:bg-slate-700 animate-pulse`} />
  );
  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      <S w="w-36" h="h-3" r="rounded-full" />
      <S w="w-48" h="h-3" r="rounded-full" />
      <S h="h-[130px]" r="rounded-3xl" />
      <S h="h-[52px]" />
      <S h="h-14" />
      <S h="h-14" />
      <S h="h-14" />
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
    if (active.length >= 4) return;
    const next = active + d;
    setActive(next);
    setError("");
    if (next.length === 4) {
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
          {step === 1 ? "Choose a 4-digit PIN to protect your app" : "Enter your PIN again to confirm"}
        </p>
        <div className="flex gap-4">
          {[0, 1, 2, 3].map(i => (
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

// ── Support ticket modal ───────────────────────────────────────────────────
function SupportModal({ onClose, clientName, clientEmail }) {
  const t = useT();
  const TICKET_TYPES = makeTicketTypes(t);

  const [form, setForm]      = useState({ subject: "", description: "", type: "general", priority: "medium", user_name: clientName || "", user_email: clientEmail || "" });
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

  return (
    <Modal title="Help & Support" onClose={onClose}>
      {done ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Svg d={P.check} size={24} color="#10b981" sw={2.5} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">Ticket Submitted!</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your ticket number is <span className="font-bold text-brand-500 dark:text-brand-400">#{done}</span></p>
            <p className="text-xs text-slate-400 mt-2">Our team will respond to {form.user_email} shortly.</p>
          </div>
          <button onClick={onClose} className="mt-2 w-full py-3 bg-brand-500 text-white rounded-xl font-bold text-sm transition">Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[["Your Name","user_name","text","Your name"],["Email *","user_email","email","your@email.com"]].map(([l, k, t, ph]) => (
              <div key={k}>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{l}</label>
                <input type={t} placeholder={ph} value={form[k]} onChange={e => setForm(f => ({...f, [k]: e.target.value}))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
            <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none">
              {TICKET_TYPES.map(tt => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Subject *</label>
            <input placeholder="Brief summary of your issue" value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} required
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Description</label>
            <textarea placeholder="Describe the problem in detail…" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={3}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 rounded-xl">⚠ {err}</p>}
          <button type="submit" disabled={submitting}
            className="w-full py-3 bg-brand-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2">
            {submitting && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </form>
      )}
    </Modal>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────
const FAQS = [
  { q: "How do I pay my contribution?",          a: "On the Home tab, tap the green 'Pay Contribution' button. You'll be redirected to a secure Paystack payment page." },
  { q: "How do I check my savings balance?",     a: "Your current balance is shown on the Home tab in the hero card at the top of the screen." },
  { q: "How do I request a withdrawal?",         a: "On the Home tab, tap 'Request Withdrawal'. Enter the amount and submit — your savings agent will review and approve it." },
  { q: "How do I view my contribution history?", a: "Tap the History tab at the bottom. You can filter by contributions or withdrawals." },
  { q: "What is the contribution calendar?",     a: "The calendar on the Home tab shows your activity for the last 90 days — each green square is a day you contributed." },
  { q: "What fees apply to withdrawals?",        a: "Check the fee info card on your Home tab. First withdrawals may have a registration fee; subsequent ones may have a percentage fee." },
  { q: "What is the PIN lock for?",              a: "The PIN lock protects your portal when you step away. Go to Me → Security to set it up." },
  { q: "How do I update my profile photo?",      a: "Go to Me → Edit Profile, then tap the camera icon on your avatar." },
  { q: "How do I change my password?",           a: "Go to the Me tab and tap 'Change Password' at the bottom of the page." },
];

function FAQ() {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-2">
      {FAQS.map((f, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm overflow-hidden">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-4 text-left gap-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">{f.q}</span>
            <Svg d={open === i ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} size={16} color="#94a3b8" />
          </button>
          {open === i && <div className="px-4 pb-4"><p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p></div>}
        </div>
      ))}
    </div>
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
    <div className="mb-4">
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Contributing to</p>
      <div className="space-y-2">
        {opts.map(opt => (
          <button key={opt.key} type="button" onClick={() => onChange(opt.key)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition ${
              value === opt.key
                ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                : "border-slate-200 dark:border-slate-700"
            }`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{opt.label}</p>
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
      setMessage(e.message || "Payment not confirmed yet. Tap below to retry.");
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
      setMessage(e.message || "Payment failed. Please try again.");
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
    if (err) { setError(err.message); setSaving(false); return; }
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
    if (err) { setError(err.message); setSaving(false); return; }
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
  const [amount,     setAmount]     = useState("");
  const [payerName,  setPayerName]  = useState("");
  const [notes,      setNotes]      = useState("");
  const [proofFile,  setProofFile]  = useState(null);
  const [proofPrev,  setProofPrev]  = useState(null);
  const [uploading,  setUploading]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");
  const [done,       setDone]       = useState(false);
  const [contribCtx, setContribCtx] = useState("personal_savings");
  const fileRef = useRef(null);

  // Prefer the client's own dedicated account; fall back to the owner's business account
  const clientBank = ownerInfo?.client_bank;
  const ownerBank  = ownerInfo?.owner;
  const hasBank = clientBank?.account_number
    ? true
    : !!(ownerBank?.bank_account_number && ownerBank?.bank_name);
  const amtNum  = parseFloat(amount) || 0;

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch { /* fallback silent */ }
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
      setError(e.message || "Failed to submit claim");
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
            <div className="w-14 h-14 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-brand-500 dark:text-brand-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Claim Submitted!</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">Your savings agent will verify the transfer and confirm your deposit. You'll be notified by email.</p>
            <button onClick={onClose} className="mt-5 w-full py-3.5 bg-brand-500 text-white rounded-xl font-bold text-sm">
              Close
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">Make a Deposit</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Transfer to the account below, then submit your claim here.</p>

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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Account Number</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-800 dark:text-white tracking-wider">{acctNum}</span>
                        <button onClick={() => copyText(acctNum)}
                          className="text-[10px] font-bold text-brand-500 dark:text-brand-400 bg-brand-100 dark:bg-brand-900/40 px-2 py-0.5 rounded-md active:scale-95 transition">
                          Copy
                        </button>
                      </div>
                    </div>
                    {acctName && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Account Name</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 text-right max-w-[60%] truncate">{acctName}</span>
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

            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount Transferred (₦) <span className="text-red-500">*</span></label>
            <input
              type="number" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Enter the exact amount you transferred"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            />

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
            {proofPrev ? (
              <div className="relative mb-3">
                <img src={proofPrev} alt="Proof" className="w-full rounded-xl object-cover max-h-40 border border-slate-200 dark:border-slate-600" />
                <button onClick={() => { setProofFile(null); setProofPrev(null); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center text-white text-xs font-bold">✕</button>
              </div>
            ) : (
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
              disabled={saving || !amtNum || amtNum <= 0}
              className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm flex items-center justify-center gap-2">
              {uploading ? "Uploading proof…" : saving ? "Submitting…" : "Submit Deposit Claim"}
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
      setError(e.message || "Failed to submit request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
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
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">Request Withdrawal</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Balance: <strong className="text-slate-600 dark:text-slate-300">{fmt(client.current_balance || 0)}</strong>
            </p>

            {isFirst && regFee > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold">
                  First withdrawal — Registration fee: {fmt(regFee)} will be deducted
                </p>
              </div>
            )}
            {!isFirst && pctFee > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
                  Withdrawal fee: {pctFee}% will be deducted
                </p>
              </div>
            )}

            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦)</label>
            <input
              type="number" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            />

            {amtNum > 0 && (
              <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-4 py-3 mb-3 space-y-1.5 border border-slate-100 dark:border-slate-600">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Requested</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{fmt(amtNum)}</span>
                </div>
                {feeAmt > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      {isFirst ? "Registration fee" : `Fee (${pctFee}%)`}
                    </span>
                    <span className="font-bold text-red-500">−{fmt(feeAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs border-t border-slate-200 dark:border-slate-600 pt-1.5">
                  <span className="font-bold text-slate-600 dark:text-slate-300">You receive</span>
                  <span className="font-extrabold text-green-600 dark:text-green-400">{fmt(Math.max(0, netAmt))}</span>
                </div>
              </div>
            )}

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

  const [goal,      setGoal]      = useState(0);
  const [editGoal,  setEditGoal]  = useState(false);
  const [goalInput, setGoalInput] = useState("");

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
    ajoFn("get-goal", { client_id: client.id }).then(({ data }) => {
      if (data?.goal) setGoal(data.goal);
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

  const insight = streak >= 3
    ? `🔥 ${streak}-month savings streak! You're on fire!`
    : totalLastMonth > 0 && totalThisMonth > totalLastMonth
      ? `📈 You saved ${Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100)}% more than last month!`
      : healthScore >= 80
        ? `⭐ Your savings health score is ${healthScore}/100 — excellent!`
        : `💡 ${fmt(client.total_saved || 0)} saved so far. Keep it up!`;

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

      {/* AI insight card */}
      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/50 rounded-2xl px-4 py-3">
        <p className="text-[13px] font-semibold text-brand-700 dark:text-brand-200">{insight}</p>
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

      {/* Savings goal */}
      {(goal > 0 || editGoal) ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Savings Goal</p>
            <button onClick={() => { setEditGoal(true); setGoalInput(String(goal)); }} className="text-[11px] text-brand-500 dark:text-brand-400 font-bold">Edit</button>
          </div>
          {editGoal ? (
            <div className="flex gap-2">
              <input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                placeholder="Target amount (₦)"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button onClick={() => {
                const g = parseFloat(goalInput) || 0;
                setGoal(g);
                setEditGoal(false);
                if (g > 0) ajoFn("set-goal", { client_id: client.id, target_amount: g }).catch(() => null);
                else ajoFn("delete-goal", { client_id: client.id }).catch(() => null);
              }} className="px-3 py-2 bg-brand-500 text-white rounded-xl text-sm font-bold">Save</button>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{fmt(client.current_balance || 0)}</span>
                <span className="text-slate-400 dark:text-slate-500">{fmt(goal)}</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700"
                  style={{ width: `${Math.min(((client.current_balance || 0) / goal) * 100, 100).toFixed(1)}%` }} />
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                {Math.round(((client.current_balance || 0) / goal) * 100)}% of your goal reached
              </p>
            </>
          )}
        </div>
      ) : (
        <button onClick={() => setEditGoal(true)}
          className="w-full py-3 border-2 border-dashed border-brand-200 dark:border-brand-800/50 rounded-2xl text-sm font-semibold text-brand-500 dark:text-brand-400 flex items-center justify-center gap-2">
          🎯 Set a Savings Goal
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

// ── History tab ───────────────────────────────────────────────────────────
function HistoryTab({ contributions, withdrawRequests = [], client, ownerInfo }) {
  const [typeFilter,     setTypeFilter]     = useState("all");
  const [receipt,        setReceipt]        = useState(null);
  const [disputeFor,     setDisputeFor]     = useState(null);
  const [disputeDesc,    setDisputeDesc]    = useState("");
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputedIds,    setDisputedIds]    = useState(() => new Set());

  const withdrawItems = withdrawRequests.map(r => ({
    _type: "withdrawal_request",
    id: r.id,
    amount: r.amount,
    net_amount: r.net_amount,
    fee_amount: r.fee_amount,
    fee_type: r.fee_type,
    status: r.status,
    date: r.requested_at,
  }));
  const contribItems = contributions.map(c => ({ _type: "contribution", ...c, date: c.created_at }));
  const allItems = [...withdrawItems, ...contribItems].sort((a, b) => new Date(b.date) - new Date(a.date));

  const filtered = allItems.filter(item => {
    if (typeFilter === "contributions") return item._type === "contribution" && item.type === "contribution";
    if (typeFilter === "withdrawals")   return item._type === "withdrawal_request" || item.type === "withdrawal";
    return true;
  });

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "contributions", label: "Contributions" },
    { id: "withdrawals", label: "Withdrawals" },
  ];

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

  const statusCls = (s) => {
    if (s === "completed" || s === "approved") return "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400";
    if (s === "rejected") return "bg-red-50 dark:bg-red-900/20 text-red-500";
    return "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400";
  };

  const bizName = ownerInfo?.business_name || ownerInfo?.full_name || "My Business";

  const handleExportPdf = async () => {
    const sorted = [...allItems].sort((a, b) => new Date(a.date || a.created_at || 0) - new Date(b.date || b.created_at || 0));
    let runBal = 0;
    const rows = sorted.map(item => {
      const amt      = parseFloat(item.amount) || 0;
      const isWdReq  = item._type === "withdrawal_request";
      const isFee    = item.type === "withdrawal_fee" || item.type === "registration_fee";
      const isWd     = !isWdReq && (item.type === "withdrawal" || isFee || item.type === "commission" || (item.type || "").startsWith("reversal_"));
      const desc     = isWdReq ? "Withdrawal Request (Pending)" : ledgerTypeLabel(item.type);
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
        client?.full_name                ? { value: client.full_name,          sub: true } : null,
        ownerInfo?.staff?.phone          ? { value: ownerInfo.staff.phone,      sub: true } : null,
      ].filter(Boolean),
      entityDetails: [
        { label: "Member",          value: client?.full_name || "—" },
        { label: "Current Balance", value: pdfFmt(client?.current_balance || 0) },
        { label: "Total Saved",     value: pdfFmt(client?.total_saved || totC) },
        { label: "Records",         value: String(allItems.length) },
      ],
    });
    pdf.addStats([
      { label: "Total Contributed", value: pdfFmt(totC),                        color: "#3DA829" },
      { label: "Total Withdrawn",   value: pdfFmt(totD),                        color: "#ef4444" },
      { label: "Current Balance",   value: pdfFmt(client?.current_balance || 0) },
      { label: "Records",           value: String(allItems.length) },
    ]);
    pdf.addStatement(rows, { openingBalance: 0, totalDebits: totD, totalCredits: totC });
    await pdf.save(`Ajo_Savings_${(client?.full_name || "Statement").replace(/\s+/g, "_")}.pdf`);
  };

  return (
    <div className="px-4 pt-5 pb-28">
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

      {/* Type filter chips + PDF export */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <button key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold flex-shrink-0 transition-colors
                ${typeFilter === f.id
                  ? "bg-brand-500 text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}>
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

      <div className="space-y-2">
        {filtered.map(item => item._type === "withdrawal_request" ? (
          <button key={`wr-${item.id}`} onClick={() => setReceipt({ ...item, type: "withdrawal" })}
            className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 active:scale-[0.98] transition-transform">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-brand-50 dark:bg-brand-900/20">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-brand-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M12 19V5M5 12l7 7 7-7"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold tabular text-brand-500 dark:text-brand-400">−{fmt(item.amount)}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusCls(item.status)}`}>{item.status}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Withdrawal request · Net: {fmt(item.net_amount)}
                  {item.fee_amount > 0 && ` · Fee: ${fmt(item.fee_amount)}`}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {fmtDateTime(item.date)}
                </p>
              </div>
            </div>
          </button>
        ) : (() => {
          const isPending         = item.type === "contribution" && item.status === "pending";
          const isPendingManual   = isPending && item.payment_method === "manual_transfer";
          const isPendingRecorded = isPending && item.payment_method !== "manual_transfer";
          const isRejectedManual  = item.payment_method === "manual_transfer" && item.status === "rejected";
          const isManual          = item.payment_method === "manual_transfer";
          const isContrib         = item.type === "contribution";
          const cardCls = isPending
            ? "bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800/60"
            : isRejectedManual
              ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/60"
              : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700";

          const pendingLabel = isPendingManual   ? "Awaiting bank transfer confirmation"
                             : isPendingRecorded ? "Pending approval"
                             : null;

          const Row = isPending ? "div" : "button";
          const rowProps = isPending
            ? { key: `c-${item.id}`, className: `w-full text-left rounded-2xl px-4 py-3 border ${cardCls}` }
            : { key: `c-${item.id}`, onClick: () => setReceipt(item), className: `w-full text-left rounded-2xl px-4 py-3 border active:scale-[0.98] transition-transform ${cardCls}` };

          return (
            <Row {...rowProps}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isPending        ? "bg-brand-100 dark:bg-brand-900/40" :
                  isRejectedManual ? "bg-red-100 dark:bg-red-900/30" :
                  isContrib        ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"
                }`}>
                  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${
                    isPending        ? "text-brand-500 dark:text-brand-400" :
                    isRejectedManual ? "text-red-500" :
                    isContrib        ? "text-green-600 dark:text-green-400" : "text-red-500"
                  }`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    {isContrib ? <path d="M12 5v14M5 12l7-7 7 7" /> : <path d="M12 19V5M5 12l7 7 7-7" />}
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-extrabold tabular ${
                      isPending        ? "text-brand-500 dark:text-brand-400" :
                      isRejectedManual ? "text-red-500 dark:text-red-400" :
                      isContrib        ? "text-green-600 dark:text-green-400" : "text-red-500"
                    }`}>
                      {isContrib ? "+" : "−"}{fmt(item.amount)}
                    </span>
                    {!isPending && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusCls(item.status)}`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                  {isPending && pendingLabel && (
                    <p className="text-[10px] font-bold text-brand-500 dark:text-brand-400 mt-0.5">{pendingLabel}</p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {ledgerTypeLabel(item.type)}{isManual ? " · Bank transfer" : ` · ${item.payment_method || "cash"}`}
                    {item.paystack_ref && ` · Ref: ${item.paystack_ref.slice(-8)}`}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {fmtDateTime(item.created_at)}
                  </p>
                  {item.claim_notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{item.claim_notes}"</p>}
                  {!item.claim_notes && item.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{item.notes}"</p>}
                  {isRejectedManual && item.rejected_reason && (
                    <p className="text-[10px] text-red-500 dark:text-red-400 mt-1 font-semibold">Reason: {item.rejected_reason}</p>
                  )}
                  {(item.dispute_ticket_no || disputedIds.has(item.id)) ? (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-semibold">
                      Dispute filed{item.dispute_ticket_no ? ` · ${item.dispute_ticket_no}` : ""}
                    </p>
                  ) : !isPending && isContrib && (
                    <button onClick={e => { e.stopPropagation(); setDisputeFor(item); setDisputeDesc(""); }}
                      className="text-[10px] text-slate-400 hover:text-red-500 dark:hover:text-red-400 mt-1 underline text-left">
                      Report an issue
                    </button>
                  )}
                </div>
              </div>
            </Row>
          );
        })())}
      </div>
      {disputeFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-1">Report an Issue</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              {fmtDate(disputeFor.created_at)} &middot; {disputeFor.type === "contribution" ? "+" : "−"}{fmt(disputeFor.amount)}
            </p>
            <textarea
              value={disputeDesc}
              onChange={e => setDisputeDesc(e.target.value)}
              placeholder="Describe the issue (optional)…"
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setDisputeFor(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-500 dark:text-slate-400">
                Cancel
              </button>
              <button onClick={async () => {
                setDisputeLoading(true);
                try {
                  await ajoFn("submit-dispute", {
                    client_id:       client.id,
                    owner_id:        client.user_id,
                    contribution_id: disputeFor.id,
                    description:     disputeDesc,
                  });
                  setDisputedIds(prev => new Set([...prev, disputeFor.id]));
                } catch {}
                setDisputeLoading(false);
                setDisputeFor(null);
              }} disabled={disputeLoading}
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
function AjoMemberMe({ client, session, clientId, lock, onChangePwdClick, onProfileUpdate }) {
  const [view,         setView]        = useState("menu");
  const [editForm,     setEditForm]    = useState({ full_name: client?.full_name || "", phone: client?.phone || "" });
  const [photoFile,    setPhotoFile]   = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving,       setSaving]      = useState(false);
  const [saveMsg,      setSaveMsg]     = useState("");
  const [showSupport,  setShowSupport] = useState(false);
  const [lockBusy,     setLockBusy]    = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [isDark,       setIsDark]      = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const fileRef = useRef(null);

  const initials = (client?.full_name || "M").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  const saveProfile = async () => {
    setSaving(true); setSaveMsg("");
    try {
      let photoUrl = client?.profile_image_url;
      if (photoFile) photoUrl = await uploadAjoAvatar(photoFile, clientId);
      await supabase.from("aso_clients").update({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl }).eq("id", clientId);
      onProfileUpdate?.({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl });
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("menu"); }, 1500);
    } catch { setSaveMsg("Save failed. Please try again."); }
    setSaving(false);
  };

  const SubHeader = ({ title }) => (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
      <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
        <Svg d={P.back} size={18} color="#64748b" />
      </button>
      <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
    </div>
  );

  if (view === "edit") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Edit Profile" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-brand-500 flex items-center justify-center shadow-lg overflow-hidden">
              {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : client?.profile_image_url ? <img src={client.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-2xl font-black text-white">{initials}</span>}
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-500 border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition">
              <Svg d={P.cam} size={15} color="#fff" />
            </button>
          </div>
          <p className="text-[12px] text-slate-400">Tap camera to change photo</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }} />
        </div>
        <div className="space-y-3">
          {[["Full Name","full_name","text"],["Phone","phone","tel"]].map(([l, k, t]) => (
            <div key={k}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{l}</p>
              <input type={t} value={editForm[k]} onChange={e => setEditForm(p => ({...p, [k]: e.target.value}))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
          ))}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email</p>
            <input disabled value={client?.email || session?.user?.email || "—"}
              className="w-full h-12 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 text-sm text-slate-400 cursor-not-allowed" />
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

  const Toggle = (
    <button onClick={e => { e.stopPropagation(); toggleDark(); }}
      className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${isDark ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-600"}`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: isDark ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );

  return (
    <div className="h-full overflow-y-auto pb-4">
      {/* Profile card */}
      <div className="mx-4 mt-5 mb-5">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700/50 p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden">
            {client?.profile_image_url
              ? <img src={client.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-xl font-black text-white">{initials}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">{client?.full_name || "Member"}</p>
            <p className="text-[12px] font-bold text-brand-500 dark:text-brand-400 capitalize mt-0.5">{client?.contribution_frequency || ""} savings</p>
            <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{client?.membership_number || "—"}</p>
          </div>
          <button onClick={() => setView("edit")}
            className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center active:scale-90 transition flex-shrink-0">
            <Svg d={P.pen} size={16} color="#3DA829" />
          </button>
        </div>
      </div>

      {/* Account */}
      <div className="px-4 mb-5">
        <SectionLabel>Account</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.person} />} label="Edit Profile" sub="Update your name, phone, and photo" onClick={() => setView("edit")} />
        </SettingsCard>
      </div>

      {/* Security */}
      <div className="px-4 mb-5">
        <SectionLabel>Security</SectionLabel>
        <SettingsCard>
          <Row
            icon={<RowIcon d={P.lock} />}
            label="App Lock"
            sub={lock.enabled ? (lock.hasBiometric ? "Locked · Fingerprint / Face + PIN" : "Locked · PIN only") : lock.hasPIN ? "PIN set but lock is off" : "Protect app when you leave"}
            onClick={async () => {
              if (lock.enabled) { lock.disableLock(); }
              else if (lock.hasPIN) { setLockBusy(true); await lock.enableLock(); setLockBusy(false); }
              else {
                const evt = new CustomEvent("ajo_open_pin_setup");
                window.dispatchEvent(evt);
              }
            }}
            right={
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (lock.enabled) { lock.disableLock(); }
                  else if (lock.hasPIN) { setLockBusy(true); await lock.enableLock(); setLockBusy(false); }
                  else {
                    setShowPinSetup(true);
                  }
                }}
                className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${lock.enabled ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-600"}`}>
                {lockBusy
                  ? <span className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /></span>
                  : <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200" style={{ left: lock.enabled ? "calc(100% - 22px)" : "2px" }} />
                }
              </button>
            }
          />
          <Row
            icon={<RowIcon d={P.shield} />}
            label={lock.hasPIN ? "Change PIN" : "Set PIN"}
            sub={lock.hasPIN ? (lock.hasBiometric ? "Biometric registered · tap to change PIN" : "Change your 4-digit unlock PIN") : "Set a 4-digit PIN to enable App Lock"}
            onClick={() => { const evt = new CustomEvent("ajo_open_pin_setup"); window.dispatchEvent(evt); }}
          />
        </SettingsCard>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-5">
        <SectionLabel>Preferences</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={isDark ? P.moon : P.sun} />} label="Dark Mode" onClick={toggleDark} right={Toggle} />
        </SettingsCard>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-5">
        <SectionLabel>Help & Support</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.faq} />}  label="Frequently Asked Questions" sub="Browse common questions" onClick={() => setView("faq")} />
          <Row icon={<RowIcon d={P.help} />} label="Contact Support"            sub="Submit a support ticket"  onClick={() => setShowSupport(true)} />
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

      {/* FAQ inline view */}
      {view === "faq" && (
        <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
          <div className="flex items-center gap-3 px-4 pb-4 border-b border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
            <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
              <Svg d={P.back} size={18} color="#64748b" />
            </button>
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">Frequently Asked Questions</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 pb-6"><FAQ /></div>
        </div>
      )}

      {/* Support modal */}
      {showSupport && (
        <SupportModal
          onClose={() => setShowSupport(false)}
          clientName={client?.full_name}
          clientEmail={client?.email || session?.user?.email || ""}
        />
      )}

      {/* PIN setup modal */}
      {showPinSetup && (
        <PinSetupModal onClose={() => setShowPinSetup(false)} onDone={async (pin) => {
          setShowPinSetup(false);
          await lock.setupPIN(pin);
          await lock.enableLock();
        }} />
      )}
    </div>
  );
}

// ── Bills wrapper — mirrors same store shape as CoopMemberPortal ──────────
function AjoMemberBillsWrapper({ client, ownerInfo, session, autoService, onAutoOpened }) {
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
      autoService={autoService}
      onAutoOpened={onAutoOpened}
    />
  );
}

// ── Main portal ───────────────────────────────────────────────────────────
export default function AjoMemberPortal({ session, ajoClient }) {
  const t = useT();

  const NAV = useMemo(() => makeNav(t), [t]);

  const [client,           setClient]           = useState(ajoClient || null);
  const [contributions,    setContributions]    = useState([]);
  const [cycle,            setCycle]            = useState(null);
  const [rotationData,     setRotationData]     = useState(null);
  const [rotationLoading,  setRotationLoading]  = useState(false);
  const [ownerInfo,        setOwnerInfo]        = useState(null);
  const [loadingData,      setLoadingData]      = useState(false);
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

  const lock  = useBiometricLock(ajoClient?.id);
  const notif = useNotifications(ajoClient?.id);
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar","tab_card_quad","tab_card_duo"], "ajo_client", "ajo_client.home");
  const ajoTabCard = (camSlots.tab_card_quad || [])[0] ?? (camSlots.tab_card_duo || [])[0] ?? null;
  const annBars = camSlots.announcement_bar || [];
  const { offers: partnerOffers, loading: offersLoading, recordEvent: recordOfferEvent, ctaUrl } = usePartnerOffers("ajo_client");

  const mustChange = session?.user?.user_metadata?.must_change_password === true;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("kuditrack_dark") === "1");
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

        // Fetch rotation data if the client belongs to a rotating group
        const groupId = (resolvedClient || ajoClient)?.ajo_group_id;
        if (groupId) {
          setRotationLoading(true);
          ajoFn("get-rotation", { group_id: groupId, client_id: ajoClient.id })
            .then(rd => {
              if (rd?.group) setRotationData(rd);
            })
            .catch(() => null)
            .finally(() => setRotationLoading(false));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [mustChange, ajoClient?.id, ajoClient?.owner_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {tab === "bills" && (
            <div className="h-full overflow-y-auto">
              <AjoMemberBillsWrapper
                client={client}
                ownerInfo={ownerInfo}
                session={session}
              />
            </div>
          )}
          {tab === "history" && (
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
              lock={lock}
              onChangePwdClick={() => setShowPwdModal(true)}
              onProfileUpdate={updates => setClient(prev => ({ ...prev, ...updates }))}
            />
          )}
          {!client && tab !== "me" && <SkeletonHome />}
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

        {/* Powered by card — always visible above bottom nav on client portals */}
        <PoweredByCardSlot portalType="ajo_client" businessId={client?.owner_id} />

        {/* Bottom nav */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex items-stretch h-[60px]">
            {NAV.map(n => {
              const active = tab === n.id;
              return (
                <button key={n.id} onClick={() => setTab(n.id)}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-500 dark:bg-brand-400" />}
                  <div className={`transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <Icon name={n.icon} size={21} className={active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${active ? "text-brand-500 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
                    {n.label}
                  </span>
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


