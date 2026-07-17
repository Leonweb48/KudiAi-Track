import { useState } from "react";
import { supabase } from "../../utils/supabase";
import { fmt, today } from "../../utils/helpers";
import { useT } from "../../contexts/LanguageContext";
import Modal from "../../components/shared/Modal";
import PinDots from "../../components/PinDots";
import { TxRow as _SharedTxRow } from "../../components/shared/TxRow";

/* ─ Palette tokens — matches business portal (emerald-600) ─────── */
export const NK  = "#059669"; // emerald-600 (primary, was navy)
export const GK  = "#059669"; // emerald-600 (accent, was lime)
export const GKL = "#ecfdf5"; // emerald-50 tint (was lime tint)

export const ADMIN_URL = "https://admin.kudiai.app";
export const YEAR      = new Date().getFullYear();

/* ─ Data helpers ────────────────────────────────────────────────── */
export function makeTicketTypes(t) {
  return [
    { value: "account",     label: t("ticket.account")     },
    { value: "transaction", label: t("ticket.transaction") },
    { value: "technical",   label: t("ticket.technical")   },
    { value: "ajo",         label: t("ticket.ajo")         },
    { value: "general",     label: t("ticket.general")     },
  ];
}

export function makeNav(t) {
  return [
    { id: "home",    icon: "home",      label: t("nav.home")    },
    { id: "sales",   icon: "txn",       label: t("nav.sales")   },
    { id: "records", icon: "credit",    label: t("nav.records") },
    { id: "stock",   icon: "inventory", label: t("nav.stock")   },
    { id: "me",      icon: "user",      label: t("nav.me")      },
  ];
}

export function makeBillServices(t) {
  return [
    { id: "mic",         label: t("bill.micSale"),     isMic: true, icon: "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8" },
    { id: "airtime",     label: t("bill.airtime"),     icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
    { id: "data",        label: t("bill.data"),        icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
    { id: "electricity", label: t("bill.electricity"), icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
    { id: "cable",       label: t("bill.cableTV"),     icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
    { id: "betting",     label: t("bill.betting"),     icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
  ];
}

export function greetingText(t) {
  const h = new Date().getHours();
  return h < 12 ? t("greet.morning") : h < 17 ? t("greet.afternoon") : t("greet.evening");
}

export function fmtDate(lang) {
  const locale = lang === "ha" ? "ha" : lang === "yo" ? "yo" : lang === "ig" ? "ig" : "en-NG";
  return new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function dateRange(period) {
  const now = new Date();
  if (period === "today") return today();
  if (period === "week")  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString().split("T")[0]; }
  if (period === "month") { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; }
  return null;
}

export async function uploadAvatar(file, staffId) {
  const ext  = file.name.split(".").pop();
  const path = `staff/${staffId}/avatar.${ext}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  const base = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return `${base}?v=${Date.now()}`;
}

/* ─ SVG primitive ───────────────────────────────────────────────── */
export function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ─ Icon path constants ─────────────────────────────────────────── */
export const P = {
  in:      "M12 19V5|M5 12l7-7 7 7",
  out:     "M12 5v14|M19 12l-7 7-7-7",
  credit:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  bank:    "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z",
  bills:   "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  report:  "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  mic:     "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8",
  share:   "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8|M16 6l-4-4-4 4|M12 2v13",
  check:   "M20 6L9 17l-5-5",
  lock:    "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  back:    "M19 12H5|M12 19l-7-7 7-7",
  cam:     "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M12 17a4 4 0 100-8 4 4 0 000 8",
  pen:     "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7|M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  doc:     "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  sun:     "M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 100 14A7 7 0 0012 5z",
  moon:    "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  out2:    "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9",
  faq:     "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z|M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
  person:  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
  finger:  "M12 10a2 2 0 00-2 2v4a2 2 0 004 0v-4a2 2 0 00-2-2z|M12 4a8 8 0 018 8|M4 12a8 8 0 018-8",
  alert:   "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01",
  search:  "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  help:    "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
};

/* ─ Section label — one standard everywhere ─────────────────────── */
export function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">
      {children}
    </p>
  );
}

/* ─ Settings card ───────────────────────────────────────────────── */
export function SettingsCard({ children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card divide-y divide-slate-100 dark:divide-slate-700/80">
      {children}
    </div>
  );
}

/* ─ Row icon — grey icon (matches business portal Settings rows) ── */
export function RowIcon({ d }) {
  return (
    <div className="text-slate-600 dark:text-slate-300">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {d.split("|").map((p, i) => <path key={i} d={p} />)}
      </svg>
    </div>
  );
}

/* ─ Settings row — grey rounded-xl tile (matches business portal) ─ */
export function Row({ icon, label, sub, onClick, right }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-[14px] text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors focus-visible:outline-none">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] leading-snug text-slate-800 dark:text-slate-100">{label}</p>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right !== undefined ? right : (
        <svg className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

/* ─ Stat card ───────────────────────────────────────────────────── */
export function StatCard({ label, value, icon, iconBg, iconColor, sub, onClick, loading }) {
  return (
    <button onClick={onClick}
      className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 text-left active:scale-95 transition-all duration-150 w-full">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={icon} size={16} color={iconColor} sw={2.5} />
        </div>
        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-tight">{label}</span>
      </div>
      {loading
        ? <div className="h-6 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        : <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{value}</p>
      }
      {sub && !loading && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </button>
  );
}

/* ─ Transaction row — adapter to shared canonical TxRow ─────────── */
export function TxRow({ t, onClick }) {
  return <_SharedTxRow tx={t} onClick={onClick} />;
}

/* ─ Change PIN modal — PinDots + shared numpad classes + ForgotPinFlow hook ─ */
export function ChangePinModal({ mode, onDone, onClose, onForgotPin }) {
  const digits = mode === "app" ? 6 : 4;
  const label  = mode === "app" ? "App Lock PIN" : "Transaction PIN";
  const [step,    setStep]    = useState(0);
  const [current, setCurrent] = useState("");
  const [newPin,  setNewPin]  = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  const [ok,      setOk]      = useState(false);

  const stepPins    = [current, newPin, confirm];
  const stepSetters = [setCurrent, setNewPin, setConfirm];
  const active      = stepPins[step];
  const setActive   = stepSetters[step];

  const handleDigit = async (d) => {
    if (busy || ok) return;
    if (active.length >= digits) return;
    const next = active + d;
    setActive(next);
    setErr("");
    if (next.length < digits) return;
    if (step === 0) { setTimeout(() => setStep(1), 250); return; }
    if (step === 1) { setTimeout(() => setStep(2), 250); return; }
    if (newPin !== next) {
      setErr("PINs don't match — try again");
      setNewPin(""); setConfirm("");
      setTimeout(() => setStep(1), 700);
      return;
    }
    setBusy(true);
    try {
      await onDone(current, newPin);
      setOk(true);
      setTimeout(onClose, 1400);
    } catch (e) {
      setErr(e.message || "Incorrect PIN — try again");
      setCurrent(""); setNewPin(""); setConfirm("");
      setTimeout(() => setStep(0), 700);
    }
    setBusy(false);
  };

  const handleDel = () => {
    if (busy || ok) return;
    setActive(v => v.slice(0, -1));
    setErr("");
  };

  const titles = ["Enter current " + label, "Enter new " + label, "Confirm new " + label];

  return (
    <Modal title={"Change " + label} onClose={onClose}>
      <div className="flex flex-col items-center gap-5 py-2">
        {ok ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <Svg d={P.check} size={24} color={GK} sw={2.5} />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">PIN changed!</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">{titles[step]}</p>
            <PinDots filled={active.length} count={digits} />
            {err  && <p className="text-xs text-red-500 font-semibold -mt-2 text-center">{err}</p>}
            {busy && <p className="text-xs text-slate-400">Verifying…</p>}
            <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => handleDigit(String(n))} disabled={busy}
                  className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100 disabled:opacity-50">
                  {n}
                </button>
              ))}
              <div />
              <button onClick={() => handleDigit("0")} disabled={busy}
                className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100 disabled:opacity-50">
                0
              </button>
              <button onClick={handleDel} disabled={busy}
                className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 flex items-center justify-center transition-all duration-100 disabled:opacity-50">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                  <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
                </svg>
              </button>
            </div>
            {step === 0 && onForgotPin && (
              <button onClick={onForgotPin}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1">
                Forgot PIN?
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ─ Support ticket modal ────────────────────────────────────────── */
export function SupportModal({ onClose, staffName, staffEmail }) {
  const t = useT();
  const TICKET_TYPES = makeTicketTypes(t);
  const [form, setForm]      = useState({ subject: "", description: "", type: "general", priority: "medium", user_name: staffName || "", user_email: staffEmail || "" });
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
        body: JSON.stringify({ ...form, source: "staff", submitter_type: "staff" }),
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
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
            <Svg d={P.check} size={24} color={GK} sw={2.5} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">Ticket Submitted!</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Ticket <span className="font-bold text-brand-600 dark:text-brand-400">#{done}</span></p>
            <p className="text-xs text-slate-400 mt-2">We'll respond to {form.user_email} shortly.</p>
          </div>
          <button onClick={onClose} className="mt-2 w-full py-3 text-white rounded-2xl font-bold text-sm" style={{ backgroundColor: GK }}>Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[["Your Name","user_name","text","Your name"],["Email *","user_email","email","your@email.com"]].map(([l, k, tp, ph]) => (
              <div key={k}>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{l}</label>
                <input type={tp} placeholder={ph} value={form[k]} onChange={e => setForm(f => ({...f, [k]: e.target.value}))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Category</label>
            <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none">
              {TICKET_TYPES.map(tt => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Subject *</label>
            <input placeholder="Brief summary of your issue" value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} required
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Description</label>
            <textarea placeholder="Describe the problem in detail…" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={3}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 rounded-xl">{err}</p>}
          <button type="submit" disabled={submitting}
            className="w-full py-3 disabled:opacity-50 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
            style={{ backgroundColor: GK }}>
            {submitting && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </form>
      )}
    </Modal>
  );
}

/* ─ FAQ ─────────────────────────────────────────────────────────── */
export const FAQS = [
  { q: "How do I record a sale?",            a: "Go to the Sales tab, then tap + New Transaction. Fill in the item, amount, category and payment type." },
  { q: "How do I use the mic to record?",    a: "On the Home tab, tap the Mic Sale tile. Speak naturally — e.g. 'I sold 3 bags of rice for ₦4,500 cash'." },
  { q: "How do I view and share a receipt?", a: "In the Sales tab, tap any transaction row. A receipt appears with a Share button." },
  { q: "How do I pay a bill?",               a: "On the Home tab tap a service tile, or go to Sales → Bill Payments." },
  { q: "How do I generate my statement?",    a: "Go to Me → Activity Statement. Choose a period and tap Share Statement." },
  { q: "What is the PIN lock for?",          a: "The PIN locks the portal when you step away. Go to Me → Security to set it up." },
  { q: "Why can't I see some features?",     a: "Your manager controls your access. Contact them if you think something is missing." },
  { q: "How do I change my profile photo?",  a: "Go to Me → Edit Profile, then tap the camera icon on your avatar." },
];

export function FAQ() {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-2">
      {FAQS.map((f, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-card overflow-hidden">
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
