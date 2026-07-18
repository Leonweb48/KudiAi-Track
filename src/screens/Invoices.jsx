import { useState } from "react";
import TransactionPinModal from "../components/TransactionPinModal";
import { Capacitor }             from "@capacitor/core";
import { Browser }               from "@capacitor/browser";
import { Share }                 from "@capacitor/share";
import { canDo, planAvailableText } from "../utils/plans";
import { sendEmailTrigger }          from "../utils/emailTrigger";
import { fmt, today }            from "../utils/helpers";
import { AmountDisplay }         from "../components/shared/AmountDisplay";
import { exportInvoicePdf }      from "../utils/generateInvoicePdf";
import InvoiceBuilder            from "../components/InvoiceBuilder";
import { useInvoiceSettings }    from "../hooks/useInvoiceSettings";
import InvoiceSettingsModal      from "../components/InvoiceSettingsModal";

const koboToNaira = (k) => (k || 0) / 100;
const fmtK        = (k) => fmt(koboToNaira(k));

// ── Gradient pairs — single source; dark variants live in index.css .dark ───
const GRAD = {
  brand: "linear-gradient(135deg,var(--grad-brand-from),var(--grad-brand-to))",
  paid:  "linear-gradient(135deg,var(--grad-paid-from),var(--grad-paid-to))",
  red:   "linear-gradient(135deg,var(--grad-red-from),var(--grad-red-to))",
  blue:  "linear-gradient(135deg,var(--grad-blue-from),var(--grad-blue-to))",
  slate: "linear-gradient(135deg,var(--grad-slate-from),var(--grad-slate-to))",
  grey:  "linear-gradient(135deg,var(--grad-grey-from),var(--grad-grey-to))",
};

const STATUS_CONFIG = {
  draft:          { label: "Draft",     color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  sent:           { label: "Sent",      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  partially_paid: { label: "Part Paid", color: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400" },
  paid:           { label: "Paid",      color: "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400" },
  overdue:        { label: "Overdue",   color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
  cancelled:      { label: "Cancelled", color: "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500" },
};

const METHODS = [
  { value: "cash",         label: "Cash" },
  { value: "transfer",     label: "Bank Transfer" },
  { value: "pos",          label: "POS / Card" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "other",        label: "Other" },
];

// Card accent stripe — static Tailwind class strings (safe for JIT purge)
const CARD_ACCENT_CLS = {
  draft:          "bg-slate-300 dark:bg-slate-600",
  sent:           "bg-blue-500",
  partially_paid: "bg-indigo-500",
  paid:           "bg-brand-600",
  overdue:        "bg-red-500",
  cancelled:      "bg-slate-200 dark:bg-slate-700",
};

// iconColor values are mid-saturation so they read on both light and dark backgrounds
const STATUS_TILES = [
  { id: "all",       label: "All",       grad: GRAD.brand, iconColor: "#3DA829", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { id: "draft",     label: "Draft",     grad: GRAD.slate, iconColor: "#94a3b8", icon: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7|M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" },
  { id: "sent",      label: "Sent",      grad: GRAD.blue,  iconColor: "#60a5fa", icon: "M22 2L11 13|M22 2l-7 20-4-9-9-4 20-7z" },
  { id: "overdue",   label: "Overdue",   grad: GRAD.red,   iconColor: "#f87171", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01" },
  { id: "paid",      label: "Paid",      grad: GRAD.paid,  iconColor: "#3DA829", icon: "M22 11.08V12a10 10 0 11-5.93-9.14|M22 4L12 14.01l-3-3" },
  { id: "cancelled", label: "Cancelled", grad: GRAD.grey,  iconColor: "#94a3b8", icon: "M18 6L6 18|M6 6l12 12" },
];

// ── Share helpers ──────────────────────────────────────────────────────────
function buildWhatsAppUrl(inv, profile) {
  const raw = (inv.customer_phone || "").replace(/[^0-9]/g, "");
  const waPhone = raw.startsWith("0") ? "234" + raw.slice(1) : raw.startsWith("234") ? raw : raw ? "234" + raw : "";
  const outstanding = inv.total_kobo - inv.amount_paid_kobo;
  const lines = [
    `Hello ${inv.customer_name},`,
    ``,
    `Here is your invoice from ${profile?.business_name || "us"}:`,
    ``,
    `Invoice No: ${inv.invoice_number}`,
    `Total:      ${fmtK(inv.total_kobo)}`,
    outstanding > 0 ? `Outstanding: ${fmtK(outstanding)}` : "Status: FULLY PAID",
    inv.due_date ? `Due Date:   ${new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG")}` : "",
    ``,
    inv.payment_instructions || "",
    ``,
    "Thank you!",
  ].filter(l => l !== undefined).join("\n");

  const base = waPhone ? `https://wa.me/${waPhone}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(lines)}`;
}

function openWhatsApp(url) {
  if (Capacitor.isNativePlatform()) {
    Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

// ── Empty state ────────────────────────────────────────────────────────────
function EmptyInvoices({ onNew }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center mb-4">
        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-400">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="M9 12h6M9 16h4"/>
        </svg>
      </div>
      <p className="font-bold text-slate-700 dark:text-slate-200 text-base mb-1">No invoices yet</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">Create your first invoice to start tracking payments from customers.</p>
      <button onClick={onNew}
        className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-2xl text-sm active:scale-95 transition">
        Create Invoice
      </button>
    </div>
  );
}

// ── Avatar colour — deterministic hash of customer name ───────────────────
const AVATAR_COLORS = [
  "bg-brand-600 text-white",
  "bg-blue-600 text-white",
  "bg-purple-600 text-white",
  "bg-rose-600 text-white",
  "bg-teal-600 text-white",
  "bg-orange-500 text-white",
];
function avatarColor(name) {
  const h = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── Invoice card ───────────────────────────────────────────────────────────
function InvoiceCard({ inv, onTap }) {
  const sc        = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
  const accentCls = CARD_ACCENT_CLS[inv.status] || "bg-slate-300";
  const outstanding = inv.total_kobo - inv.amount_paid_kobo;
  const paidPct   = inv.total_kobo > 0 ? Math.min(100, (inv.amount_paid_kobo / inv.total_kobo) * 100) : 0;
  const initials  = (inv.customer_name || "?").slice(0, 2).toUpperCase();

  return (
    <button onClick={() => onTap(inv)}
      className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl mb-3 shadow-sm active:scale-[0.98] transition-transform overflow-hidden flex border border-slate-100 dark:border-slate-700/50">
      {/* Status accent stripe */}
      <div className={`w-[4px] shrink-0 self-stretch ${accentCls}`} />
      {/* Card body */}
      <div className="flex-1 px-3.5 py-3.5 min-w-0">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-extrabold flex-shrink-0 ${avatarColor(inv.customer_name)}`}>
            {initials}
          </div>
          {/* Content + amount */}
          <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wide">{inv.invoice_number}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide ${sc.color}`}>{sc.label}</span>
              </div>
              <p className="font-extrabold text-slate-800 dark:text-white text-[15px] truncate leading-tight">{inv.customer_name}</p>
              {inv.due_date && !["paid", "cancelled"].includes(inv.status) && (
                <p className={`text-[11px] mt-0.5 font-semibold flex items-center gap-1 ${inv.status === "overdue" ? "text-red-500 dark:text-red-400" : "text-slate-400"}`}>
                  {inv.status === "overdue" && (
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="flex-shrink-0">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  )}
                  {inv.status === "overdue" ? "Overdue · " : "Due "}
                  {new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                </p>
              )}
              {inv.status === "paid" && (
                <p className="text-[11px] mt-0.5 font-bold text-brand-600 dark:text-brand-400">Fully paid</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <AmountDisplay amount={inv.total_kobo} fromKobo size="row" align="right" />
              {outstanding > 0 && !["draft", "cancelled"].includes(inv.status) && (
                <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{fmtK(outstanding)} left</p>
              )}
            </div>
          </div>
        </div>
        {/* Partial-payment progress bar */}
        {inv.status === "partially_paid" && inv.total_kobo > 0 && (
          <div className="mt-2.5 ml-[52px]">
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${paidPct}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{Math.round(paidPct)}% paid</p>
          </div>
        )}
      </div>
      {/* Chevron */}
      <div className="flex items-center pr-3 pl-1 text-slate-300 dark:text-slate-600">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </button>
  );
}

// ── Record Payment modal ───────────────────────────────────────────────────
function RecordPaymentModal({ inv, onClose, onSave }) {
  const outstanding = koboToNaira(inv.total_kobo - inv.amount_paid_kobo);
  const [amount,    setAmount]    = useState(String(outstanding));
  const [method,    setMethod]    = useState("cash");
  const [reference, setReference] = useState("");
  const [paidAt,    setPaidAt]    = useState(today());
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) { setError("Enter a valid amount"); return; }
    if (parseFloat(amount) > outstanding)   { setError(`Max payable is ${fmtK(inv.total_kobo - inv.amount_paid_kobo)}`); return; }
    setSaving(true);
    const { error: err } = await onSave({ amount_naira: amount, method, reference, paidAt });
    setSaving(false);
    if (err) { setError(err.message || "Failed to record payment"); return; }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div>
            <p className="font-extrabold text-slate-800 dark:text-white">Record Payment</p>
            <p className="text-xs text-slate-400">{inv.invoice_number} · Outstanding {fmtK(inv.total_kobo - inv.amount_paid_kobo)}</p>
          </div>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-95">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Amount (₦) *</label>
            <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-base font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="0.00" />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Payment Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {method !== "cash" && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Reference (optional)</label>
              <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Transfer ref, POS ID…" />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">Date Paid</label>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm active:scale-95 transition">
            {saving ? "Recording…" : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice detail sheet ───────────────────────────────────────────────────
function InvoiceDetail({ inv, profile, invoiceSettings, onClose, onSent, onCancel, onPayment, onDelete, onResend, onEdit }) {
  const [acting,        setActing]        = useState(false);
  const [showPayment,   setShowPayment]   = useState(false);
  const [pdfLoading,    setPdfLoading]    = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type: "cancel"|"delete", label: string }

  const sc          = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
  const outstanding = inv.total_kobo - inv.amount_paid_kobo;

  const handleSent = async () => {
    setActing(true);
    await onSent(inv.id);
    setActing(false);
    onClose();
  };

  const handleCancel = () => {
    setConfirmAction({ type: "cancel", label: "Cancel this invoice?" });
  };

  const handleDelete = () => {
    setConfirmAction({ type: "delete", label: `Delete ${inv.invoice_number} permanently?` });
  };

  const executeConfirm = async () => {
    const ct = confirmAction.type;
    setActing(true);
    setConfirmAction(null);
    if (ct === "cancel") await onCancel(inv.id);
    else await onDelete(inv.id);
    setActing(false);
    onClose();
  };

  const handlePdf = async () => {
    setPdfLoading(true);
    try { await exportInvoicePdf(inv, profile, invoiceSettings || {}); }
    catch (e) { console.error("[PDF]", e); }
    setPdfLoading(false);
  };

  const handleReceipt = async () => {
    setPdfLoading(true);
    try { await exportInvoicePdf(inv, profile, invoiceSettings || {}, { isReceipt: true }); }
    catch (e) { console.error("[Receipt]", e); }
    setPdfLoading(false);
  };

  const handleEmail = () => {
    if (!inv.customer_email) return;
    const out = inv.total_kobo - inv.amount_paid_kobo;
    const subject = encodeURIComponent(`Invoice ${inv.invoice_number}`);
    const body = encodeURIComponent(
      `Hello ${inv.customer_name},\n\nPlease find your invoice details below.\n\n` +
      `Invoice No: ${inv.invoice_number}\nTotal: ${fmtK(inv.total_kobo)}\n` +
      (out > 0 ? `Outstanding: ${fmtK(out)}\n` : "Status: FULLY PAID\n") +
      (inv.due_date ? `Due Date: ${new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG")}\n` : "") +
      (inv.payment_instructions ? `\n${inv.payment_instructions}\n` : "") +
      `\nThank you!`
    );
    window.open(`mailto:${inv.customer_email}?subject=${subject}&body=${body}`, "_system");
  };

  const handleShare = async () => {
    const out = inv.total_kobo - inv.amount_paid_kobo;
    const text = [
      `Invoice: ${inv.invoice_number}`,
      `Customer: ${inv.customer_name}`,
      `Total: ${fmtK(inv.total_kobo)}`,
      out > 0 ? `Outstanding: ${fmtK(out)}` : "Status: FULLY PAID",
      inv.due_date ? `Due: ${new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG")}` : "",
      inv.payment_instructions || "",
    ].filter(Boolean).join("\n");
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: `Invoice ${inv.invoice_number}`, text, dialogTitle: "Share Invoice" });
      } else if (navigator.share) {
        await navigator.share({ title: `Invoice ${inv.invoice_number}`, text });
      } else {
        await navigator.clipboard?.writeText(text);
      }
    } catch {}
  };

  const handleWhatsApp = () => openWhatsApp(buildWhatsAppUrl(inv, profile));
  const handleResend   = () => onResend && onResend(inv);
  const handleEdit     = () => { onEdit && onEdit(inv); onClose(); };

  const canRecordPayment = ["sent", "overdue", "partially_paid"].includes(inv.status);
  const canReceipt       = inv.status === "paid" || inv.amount_paid_kobo > 0;

  // ── Action button grid data ──────────────────────────────────────────────
  const actionBtns = [
    { key:"pdf",      label: pdfLoading ? "…" : "PDF", disabled: pdfLoading, onClick: handlePdf,
      cls:"bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> },
    canReceipt && { key:"receipt", label:"Receipt", disabled: pdfLoading, onClick: handleReceipt,
      cls:"bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 14l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg> },
    inv.customer_email && { key:"email", label:"Email", onClick: handleEmail,
      cls:"bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
    { key:"share", label:"Share", onClick: handleShare,
      cls:"bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> },
    inv.customer_phone && { key:"whatsapp", label:"WhatsApp", onClick: handleWhatsApp,
      cls:"bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.385 5.608L0 24l6.585-1.328A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.85 0-3.596-.467-5.12-1.286l-.369-.213-3.811.97.997-3.701-.231-.381A9.972 9.972 0 012 12C2 6.478 6.478 2 12 2s10 4.478 10 10-4.478 10-10 10z"/></svg> },
    ["sent","overdue"].includes(inv.status) && { key:"resend", label:"Resend", onClick: handleResend,
      cls:"bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> },
    { key:"edit", label:"Edit", onClick: handleEdit,
      cls:"bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
    { key:"delete", label:"Delete", disabled: acting || !!confirmAction, onClick: handleDelete,
      cls:"bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
      icon:<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg> },
  ].filter(Boolean);

  return (
    <>
      <div className="fixed inset-0 z-sub-sheet flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl max-h-[92dvh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500">{inv.invoice_number}</p>
              <p className="font-extrabold text-slate-800 dark:text-white">{inv.customer_name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${sc.color}`}>{sc.label}</span>
              <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-95">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          {/* Action grid — 3 columns, icon over label, 56px min height */}
          <div className="grid grid-cols-3 gap-2 px-5 pt-3 pb-2 flex-shrink-0">
            {actionBtns.map(btn => (
              <button key={btn.key} onClick={btn.onClick} disabled={btn.disabled}
                className={`flex flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl text-[11px] font-bold active:scale-95 transition ${btn.cls} disabled:opacity-40`}>
                {btn.icon}
                {btn.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
            {/* Amounts */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                <span>Subtotal</span><span className="tabular-nums">{fmtK(inv.subtotal_kobo)}</span>
              </div>
              {inv.discount_kobo > 0 && (
                <div className="flex justify-between text-sm text-red-500">
                  <span>Discount</span><span className="tabular-nums">−{fmtK(inv.discount_kobo)}</span>
                </div>
              )}
              {inv.vat_kobo > 0 && (
                <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                  <span>VAT (7.5%)</span><span className="tabular-nums">{fmtK(inv.vat_kobo)}</span>
                </div>
              )}
              {(inv.other_charges_kobo || 0) > 0 && (
                <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                  <span>{inv.other_charges_label || "Other Charges"}</span><span className="tabular-nums">{fmtK(inv.other_charges_kobo)}</span>
                </div>
              )}
              <div className="flex justify-between font-extrabold text-slate-800 dark:text-white text-base pt-1.5 border-t border-slate-200 dark:border-slate-700">
                <span>Total</span><span className="tabular-nums">{fmtK(inv.total_kobo)}</span>
              </div>
              {inv.amount_paid_kobo > 0 && (
                <>
                  <div className="flex justify-between text-sm text-brand-600 dark:text-brand-400">
                    <span>Paid</span><span className="tabular-nums">{fmtK(inv.amount_paid_kobo)}</span>
                  </div>
                  {outstanding > 0 && (
                    <div className="flex justify-between font-bold text-slate-600 dark:text-slate-300">
                      <span>Outstanding</span><span className="tabular-nums">{fmtK(outstanding)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Line items — reconstructed hierarchy */}
            {inv.invoice_items?.length > 0 && (() => {
              const allRows = inv.invoice_items;
              const topRows = allRows.filter(r => !r.parent_item_id).sort((a, b) => (a.sort_order||0) - (b.sort_order||0));
              const children = allRows.filter(r => r.parent_item_id);
              return (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Items</p>
                  {topRows.map(item => {
                    const subs = children.filter(c => c.parent_item_id === item.id).sort((a, b) => (a.sort_order||0) - (b.sort_order||0));
                    return (
                      <div key={item.id} className="mb-3 last:mb-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 mr-4">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.description}</p>
                            <p className="text-xs text-slate-400">
                              {item.pricing_mode === "auto"
                                ? `${item.quantity}× bundle`
                                : `${item.quantity} × ${fmtK(item.unit_price_kobo)}`}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{fmtK(item.line_total_kobo)}</span>
                        </div>
                        {subs.length > 0 && (
                          <div className="ml-2 pl-3 border-l-2 border-slate-100 dark:border-slate-700 mt-1 space-y-0.5">
                            {subs.map(sub => (
                              <div key={sub.id} className="flex items-start justify-between">
                                <div className="flex-1 mr-3">
                                  <p className="text-xs text-slate-500 dark:text-slate-400">• {sub.description}</p>
                                  {sub.unit_price_kobo > 0 && (
                                    <p className="text-[10px] text-slate-400 tabular-nums">{sub.quantity} × {fmtK(sub.unit_price_kobo)}</p>
                                  )}
                                </div>
                                {sub.line_total_kobo > 0 && (
                                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{fmtK(sub.line_total_kobo)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Meta */}
            <div className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
              {inv.due_date && (
                <div className="flex items-center gap-2">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                  Due {new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" })}
                </div>
              )}
              {inv.customer_phone && (
                <div className="flex items-center gap-2">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.05 1.21 2 2 0 012.03 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
                  {inv.customer_phone}
                </div>
              )}
            </div>

            {/* Payment instructions */}
            {inv.payment_instructions && (
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Payment Instructions</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{inv.payment_instructions}</p>
              </div>
            )}

            {/* Payment history */}
            {inv.invoice_payments?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Payment History</p>
                {inv.invoice_payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {METHODS.find(m => m.value === p.method)?.label || p.method}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(p.paid_at).toLocaleDateString("en-NG", { day:"numeric", month:"short" })}{p.reference ? ` · ${p.reference}` : ""}</p>
                    </div>
                    <span className="text-sm font-bold text-brand-600 dark:text-brand-400 tabular-nums">{fmtK(p.amount_kobo)}</span>
                  </div>
                ))}
              </div>
            )}

            {inv.notes && (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">{inv.notes}</p>
            )}
          </div>

          {/* In-sheet confirmation strip */}
          {confirmAction && (
            <div className="mx-5 mb-2 flex-shrink-0 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-2xl px-4 py-3 flex items-center gap-2">
              <p className="flex-1 text-sm text-red-700 dark:text-red-300 font-semibold leading-snug">{confirmAction.label}</p>
              <button onClick={() => setConfirmAction(null)}
                className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-bold text-sm flex-shrink-0 active:scale-95 transition">
                No
              </button>
              <button onClick={executeConfirm} disabled={acting}
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-600 text-white font-bold text-sm flex-shrink-0 active:scale-95 transition disabled:opacity-50">
                Yes
              </button>
            </div>
          )}

          {/* Footer actions */}
          {(inv.status === "draft" || canRecordPayment) && (
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3 flex-shrink-0">
              {inv.status === "draft" && (
                <>
                  <button onClick={handleCancel} disabled={acting || !!confirmAction}
                    className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-slate-500 active:scale-95 transition disabled:opacity-40">
                    Cancel Invoice
                  </button>
                  <button onClick={handleSent} disabled={acting}
                    className="flex-1 py-3 rounded-2xl bg-brand-600 text-white text-sm font-bold active:scale-95 transition disabled:opacity-50">
                    {acting ? "Marking…" : "Mark as Sent"}
                  </button>
                </>
              )}
              {canRecordPayment && (
                <button onClick={() => setShowPayment(true)}
                  className="flex-1 py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold active:scale-95 transition">
                  Record Payment
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showPayment && (
        <RecordPaymentModal
          inv={inv}
          onClose={() => setShowPayment(false)}
          onSave={async (payData) => {
            const result = await onPayment(payData);
            if (!result?.error) { setShowPayment(false); onClose(); }
            return result;
          }}
        />
      )}
    </>
  );
}

// ── Main Invoices screen ───────────────────────────────────────────────────
export default function Invoices({ invoiceHook, plan, onUpgrade, profile, inventory, addTransaction, userId }) {
  const { invoices, customers, loading, reload, createDraft, updateDraft, markSent, cancelInvoice, deleteInvoice, recordInvoicePayment } = invoiceHook;
  const [filter,       setFilter]      = useState("all");
  const [showBuilder,  setShowBuilder] = useState(false);
  const [editInv,      setEditInv]     = useState(null);
  const [detailInv,    setDetailInv]   = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [txnPin,       setTxnPin]      = useState(null);
  const { settings: invoiceSettings, save: saveInvoiceSettings } = useInvoiceSettings(userId);

  if (!canDo(plan, "invoices")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center mb-4">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-400">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
        <p className="font-bold text-slate-700 dark:text-slate-200 text-base mb-1">Invoice Generation</p>
        <p className="text-sm text-slate-400 mb-5">{planAvailableText("invoices")}</p>
        <button onClick={onUpgrade}
          className="bg-brand-600 text-white font-bold px-6 py-3 rounded-2xl text-sm active:scale-95 transition">
          Upgrade Plan
        </button>
      </div>
    );
  }

  const filtered = filter === "all" ? invoices : invoices.filter(i => i.status === filter);

  const handleBuilderSave = async (data) => {
    const { _saveAs, _editId, ...rest } = data;
    if (_editId) return await updateDraft(_editId, rest);
    return await createDraft({ ...rest, business_name: profile?.business_name || "" });
  };

  const outstanding_total = invoices
    .filter(i => ["sent", "overdue", "partially_paid"].includes(i.status))
    .reduce((s, i) => s + (i.total_kobo - i.amount_paid_kobo), 0);
  const paid_total = invoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + i.amount_paid_kobo, 0);

  const counts = {
    all:       invoices.length,
    draft:     invoices.filter(i => i.status === "draft").length,
    sent:      invoices.filter(i => i.status === "sent").length,
    overdue:   invoices.filter(i => i.status === "overdue").length,
    paid:      invoices.filter(i => i.status === "paid").length,
    cancelled: invoices.filter(i => i.status === "cancelled").length,
  };

  const SUMMARY_AMT_CARDS = [
    { label: "Outstanding", kobo: outstanding_total, grad: GRAD.brand },
    { label: "Paid",        kobo: paid_total,        grad: GRAD.paid  },
  ];
  const SUMMARY_CNT_CARDS = [
    { label: "Overdue", value: String(counts.overdue), grad: GRAD.red   },
    { label: "Sent",    value: String(counts.sent),    grad: GRAD.blue  },
    { label: "Draft",   value: String(counts.draft),   grad: GRAD.slate },
  ];

  return (
    <div className="pb-36">
      {/* Summary cards */}
      {invoices.length > 0 && (
        <div className="mx-4 mt-4 mb-3">
          <div className="flex gap-2.5 mb-2.5">
            {SUMMARY_AMT_CARDS.map(c => (
              <div key={c.label} className="flex-1 min-w-0 rounded-2xl px-4 py-3.5 text-white shadow overflow-hidden"
                style={{ background: c.grad }}>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">{c.label}</p>
                <AmountDisplay amount={c.kobo} fromKobo size="stat" align="left" className="text-white" />
              </div>
            ))}
          </div>
          <div className="flex gap-2.5">
            {SUMMARY_CNT_CARDS.map(c => (
              <div key={c.label} className="flex-1 min-w-0 rounded-2xl px-3 py-3 text-white shadow overflow-hidden"
                style={{ background: c.grad }}>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">{c.label}</p>
                <p className="text-xl font-black leading-tight tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter tiles */}
      {invoices.length > 0 && (
        <div className="mx-4 mb-3">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Filter by Status</p>
              <button onClick={() => setShowSettings(true)}
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700 active:scale-90 transition">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-slate-500 dark:text-slate-400">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-y-4 gap-x-2">
              {STATUS_TILES.map(s => {
                const active = filter === s.id;
                return (
                  <button key={s.id} onClick={() => setFilter(s.id)}
                    className="flex flex-col items-center gap-1.5 active:scale-90 transition-transform duration-150 overflow-visible">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm relative transition-colors ${
                      active ? "" : "bg-transparent border-2 border-slate-200 dark:border-slate-600"
                    }`}
                      style={active ? { background: s.grad } : {}}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke={active ? "white" : s.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {s.icon.split("|").map((d, i) => <path key={i} d={d} />)}
                      </svg>
                      {counts[s.id] > 0 && (
                        <span className={`absolute -top-2 -right-2 min-w-[18px] text-center text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none tabular-nums ring-2 ring-white dark:ring-slate-800 ${
                          active ? "bg-white text-slate-800" : "text-white"
                        }`} style={active ? {} : { background: s.iconColor }}>
                          {counts[s.id]}
                        </span>
                      )}
                    </div>
                    <span className={`text-[11px] font-semibold text-center leading-tight ${
                      active ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"
                    }`}>
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full spinner" />
        </div>
      ) : filtered.length === 0 && filter === "all" ? (
        <EmptyInvoices onNew={() => setShowBuilder(true)} />
      ) : (
        <div className="px-4 mt-3">
          {filtered.length === 0
            ? <p className="text-center text-slate-400 py-12 text-sm">No {filter} invoices</p>
            : filtered.map(inv => <InvoiceCard key={inv.id} inv={inv} onTap={setDetailInv} />)
          }
        </div>
      )}

      {/* FAB */}
      <button onClick={() => setShowBuilder(true)}
        className="fixed bottom-24 right-4 z-sticky w-14 h-14 bg-brand-600 hover:bg-brand-700 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition">
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14"/></svg>
      </button>

      {/* Invoice builder — new */}
      {showBuilder && (
        <InvoiceBuilder
          profile={profile}
          customers={customers}
          products={inventory?.products || []}
          onClose={() => { setShowBuilder(false); }}
          onSaved={handleBuilderSave}
        />
      )}

      {/* Invoice builder — edit draft */}
      {editInv && (
        <InvoiceBuilder
          profile={profile}
          customers={customers}
          products={inventory?.products || []}
          initialData={editInv}
          onClose={() => { setEditInv(null); }}
          onSaved={handleBuilderSave}
        />
      )}

      {/* Invoice detail */}
      {detailInv && (
        <InvoiceDetail
          inv={detailInv}
          profile={profile}
          invoiceSettings={invoiceSettings}
          onClose={() => setDetailInv(null)}
          onSent={async (id) => {
            const { error } = await markSent(id);
            if (!error) {
              const _inv = { ...detailInv, status: "sent" };
              ;(async () => {
                let pdfBase64 = null;
                try { pdfBase64 = await exportInvoicePdf(_inv, profile, invoiceSettings || {}, { returnBase64: true }); } catch {}
                sendEmailTrigger("invoice_sent", {
                  owner_id:            userId,
                  owner_email:         profile?.email || "",
                  business_name:       profile?.business_name || "",
                  invoice_number:      _inv.invoice_number,
                  issue_date:          _inv.created_at ? new Date(_inv.created_at).toLocaleDateString("en-NG") : "",
                  due_date:            _inv.due_date || "",
                  customer_name:       _inv.customer_name,
                  customer_email:      _inv.customer_email || "",
                  customer_phone:      _inv.customer_phone || "",
                  items:               (() => {
                    const allRows  = _inv.invoice_items || [];
                    const topRows  = allRows.filter(r => !r.parent_item_id).sort((a, b) => (a.sort_order||0) - (b.sort_order||0));
                    const children = allRows.filter(r => r.parent_item_id);
                    return topRows.map(i => ({
                      description: i.description, quantity: i.quantity,
                      unit_price:  koboToNaira(i.unit_price_kobo), line_total: koboToNaira(i.line_total_kobo),
                      sub_items:   children.filter(c => c.parent_item_id === i.id).sort((a, b) => (a.sort_order||0) - (b.sort_order||0))
                        .map(sub => ({ description: sub.description, quantity: sub.quantity, unit_price: koboToNaira(sub.unit_price_kobo), line_total: koboToNaira(sub.line_total_kobo) })),
                    }));
                  })(),
                  subtotal:            koboToNaira(_inv.subtotal_kobo),
                  discount:            koboToNaira(_inv.discount_kobo || 0),
                  vat:                 koboToNaira(_inv.vat_kobo || 0),
                  other_charges:       koboToNaira(_inv.other_charges_kobo || 0),
                  other_charges_label: _inv.other_charges_label || "",
                  total:               koboToNaira(_inv.total_kobo),
                  pdf_base64:          pdfBase64,
                  pdf_filename:        `invoice_${(_inv.invoice_number || "").replace(/\//g, "-")}.pdf`,
                });
              })();
            }
            await reload();
          }}
          onCancel={async (id) => {
            const { error } = await cancelInvoice(id);
            if (!error) {
              sendEmailTrigger("invoice_cancelled", {
                owner_id:       userId,
                owner_email:    profile?.email || "",
                business_name:  profile?.business_name || "",
                invoice_number: detailInv.invoice_number,
                customer_name:  detailInv.customer_name,
                customer_email: detailInv.customer_email || "",
                total_amount:   koboToNaira(detailInv.total_kobo),
              });
            }
            await reload();
          }}
          onDelete={async (id) => {
            await deleteInvoice(id);
            await reload();
          }}
          onResend={(inv) => {
            ;(async () => {
              let pdfBase64 = null;
              try { pdfBase64 = await exportInvoicePdf(inv, profile, invoiceSettings || {}, { returnBase64: true }); } catch {}
              sendEmailTrigger("invoice_sent", {
                owner_id:            userId,
                owner_email:         profile?.email || "",
                business_name:       profile?.business_name || "",
                invoice_number:      inv.invoice_number,
                issue_date:          inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-NG") : "",
                due_date:            inv.due_date || "",
                customer_name:       inv.customer_name,
                customer_email:      inv.customer_email || "",
                customer_phone:      inv.customer_phone || "",
                items:               (inv.invoice_items || []).map(i => ({ description: i.description, quantity: i.quantity, unit_price: koboToNaira(i.unit_price_kobo), line_total: koboToNaira(i.line_total_kobo) })),
                subtotal:            koboToNaira(inv.subtotal_kobo),
                discount:            koboToNaira(inv.discount_kobo || 0),
                vat:                 koboToNaira(inv.vat_kobo || 0),
                other_charges:       koboToNaira(inv.other_charges_kobo || 0),
                other_charges_label: inv.other_charges_label || "",
                total:               koboToNaira(inv.total_kobo),
                pdf_base64:          pdfBase64,
                pdf_filename:        `invoice_${(inv.invoice_number || "").replace(/\//g, "-")}.pdf`,
              });
            })();
          }}
          onEdit={(inv) => { setDetailInv(null); setEditInv(inv); }}
          onPayment={(payData) => new Promise((resolve) => {
            setTxnPin({
              title: "Record Invoice Payment",
              amount: Math.round(parseFloat(payData.amount_naira || 0) * 100),
              recipient: detailInv?.customer_name,
              description: `Invoice ${detailInv?.invoice_number}`,
              onApprove: async () => {
                setTxnPin(null);
                const result = await recordInvoicePayment({ invoiceId: detailInv.id, ...payData });
                if (!result.error && parseFloat(payData.amount_naira) > 0) {
                  await addTransaction?.({
                    type:             "in",
                    category:         "invoice",
                    amount:           parseFloat(payData.amount_naira),
                    item_name:        `Invoice ${detailInv.invoice_number} — ${detailInv.customer_name}`,
                    payment_type:     payData.method || "cash",
                    customer_name:    detailInv.customer_name || "",
                    transaction_date: payData.paidAt ? payData.paidAt.slice(0, 10) : today(),
                  });
                  const _pd           = payData;
                  const paidKoboNow   = Math.round(parseFloat(_pd.amount_naira || 0) * 100);
                  const totalPaidKobo = (detailInv.amount_paid_kobo || 0) + paidKoboNow;
                  const balanceDue    = koboToNaira(Math.max(0, detailInv.total_kobo - totalPaidKobo));
                  const _newStatus    = totalPaidKobo >= detailInv.total_kobo ? "paid" : "partially_paid";
                  const _inv2 = { ...detailInv, status: _newStatus, amount_paid_kobo: totalPaidKobo };
                  ;(async () => {
                    let pdfBase64 = null;
                    try { pdfBase64 = await exportInvoicePdf(_inv2, profile, invoiceSettings || {}, { returnBase64: true }); } catch {}
                    sendEmailTrigger("invoice_paid", {
                      owner_id:            userId,
                      owner_email:         profile?.email || "",
                      business_name:       profile?.business_name || "",
                      invoice_number:      _inv2.invoice_number,
                      due_date:            _inv2.due_date || "",
                      customer_name:       _inv2.customer_name,
                      customer_email:      _inv2.customer_email || "",
                      customer_phone:      _inv2.customer_phone || "",
                      items:               (_inv2.invoice_items || []).map(i => ({ description: i.description, quantity: i.quantity, unit_price: koboToNaira(i.unit_price_kobo), line_total: koboToNaira(i.line_total_kobo) })),
                      subtotal:            koboToNaira(_inv2.subtotal_kobo),
                      discount:            koboToNaira(_inv2.discount_kobo || 0),
                      vat:                 koboToNaira(_inv2.vat_kobo || 0),
                      other_charges:       koboToNaira(_inv2.other_charges_kobo || 0),
                      other_charges_label: _inv2.other_charges_label || "",
                      total:               koboToNaira(_inv2.total_kobo),
                      amount_paid:         parseFloat(_pd.amount_naira),
                      balance_due:         balanceDue,
                      payment_method:      _pd.method || "cash",
                      pdf_base64:          pdfBase64,
                      pdf_filename:        `invoice_${(_inv2.invoice_number || "").replace(/\//g, "-")}.pdf`,
                    });
                  })();
                }
                await reload();
                resolve(result);
              },
            });
          })}
        />
      )}

      {/* Invoice settings */}
      {showSettings && (
        <InvoiceSettingsModal
          settings={invoiceSettings}
          onSave={saveInvoiceSettings}
          onClose={() => setShowSettings(false)}
          userId={userId}
        />
      )}
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
    </div>
  );
}
