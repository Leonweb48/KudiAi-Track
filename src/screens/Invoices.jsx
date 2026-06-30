import { useState } from "react";
import { useInvoices } from "../hooks/useInvoices";
import { canDo }       from "../utils/plans";
import { fmt }         from "../utils/helpers";
import InvoiceBuilder  from "../components/InvoiceBuilder";

const koboToNaira = (k) => (k || 0) / 100;
const fmtK        = (k) => fmt(koboToNaira(k));

const STATUS_CONFIG = {
  draft:           { label: "Draft",          color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  sent:            { label: "Sent",           color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  partially_paid:  { label: "Part Paid",      color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" },
  paid:            { label: "Paid",           color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  overdue:         { label: "Overdue",        color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
  cancelled:       { label: "Cancelled",      color: "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500" },
};

const FILTER_OPTIONS = ["all", "draft", "sent", "overdue", "paid", "cancelled"];

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

function InvoiceCard({ inv, onTap }) {
  const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
  const outstanding = inv.total_kobo - inv.amount_paid_kobo;

  return (
    <button onClick={() => onTap(inv)}
      className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 mb-2.5 shadow-sm active:scale-[0.98] transition-transform">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-wide">{inv.invoice_number}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
          </div>
          <p className="font-bold text-slate-800 dark:text-white truncate">{inv.customer_name}</p>
          {inv.due_date && inv.status !== "paid" && inv.status !== "cancelled" && (
            <p className={`text-xs mt-0.5 ${inv.status === "overdue" ? "text-red-500 font-semibold" : "text-slate-400"}`}>
              Due {new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-extrabold text-slate-800 dark:text-white text-base">{fmtK(inv.total_kobo)}</p>
          {outstanding > 0 && inv.status !== "draft" && inv.status !== "cancelled" && (
            <p className="text-xs text-slate-400">{fmtK(outstanding)} outstanding</p>
          )}
        </div>
      </div>
    </button>
  );
}

function InvoiceDetail({ inv, onClose, onSent, onCancel }) {
  const [acting, setActing] = useState(false);
  const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
  const outstanding = inv.total_kobo - inv.amount_paid_kobo;

  const handleSent = async () => {
    setActing(true);
    await onSent(inv.id);
    setActing(false);
    onClose();
  };

  const handleCancel = async () => {
    if (!window.confirm("Cancel this invoice?")) return;
    setActing(true);
    await onCancel(inv.id);
    setActing(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div>
            <p className="text-xs font-bold text-slate-400 dark:text-slate-500">{inv.invoice_number}</p>
            <p className="font-extrabold text-slate-800 dark:text-white">{inv.customer_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${sc.color}`}>{sc.label}</span>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Amounts */}
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4 space-y-1.5">
            <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
              <span>Subtotal</span><span>{fmtK(inv.subtotal_kobo)}</span>
            </div>
            {inv.discount_kobo > 0 && (
              <div className="flex justify-between text-sm text-red-500">
                <span>Discount</span><span>−{fmtK(inv.discount_kobo)}</span>
              </div>
            )}
            {inv.vat_kobo > 0 && (
              <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                <span>VAT (7.5%)</span><span>{fmtK(inv.vat_kobo)}</span>
              </div>
            )}
            <div className="flex justify-between font-extrabold text-slate-800 dark:text-white text-base pt-1.5 border-t border-slate-200 dark:border-slate-700">
              <span>Total</span><span>{fmtK(inv.total_kobo)}</span>
            </div>
            {inv.amount_paid_kobo > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Paid</span><span>{fmtK(inv.amount_paid_kobo)}</span>
                </div>
                <div className="flex justify-between font-bold text-amber-600">
                  <span>Outstanding</span><span>{fmtK(outstanding)}</span>
                </div>
              </>
            )}
          </div>

          {/* Line items */}
          {inv.invoice_items?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Items</p>
              {inv.invoice_items.map(item => (
                <div key={item.id} className="flex items-start justify-between mb-2">
                  <div className="flex-1 mr-4">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.description}</p>
                    <p className="text-xs text-slate-400">{item.quantity} × {fmtK(item.unit_price_kobo)}</p>
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-white">{fmtK(item.line_total_kobo)}</span>
                </div>
              ))}
            </div>
          )}

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
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 capitalize">{p.method.replace("_", " ")}</p>
                    <p className="text-xs text-slate-400">{new Date(p.paid_at).toLocaleDateString("en-NG", { day:"numeric", month:"short" })}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600">{fmtK(p.amount_kobo)}</span>
                </div>
              ))}
            </div>
          )}

          {inv.notes && (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">{inv.notes}</p>
          )}
        </div>

        {/* Actions */}
        {(inv.status === "draft" || inv.status === "sent" || inv.status === "overdue") && (
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3 flex-shrink-0">
            {inv.status === "draft" && (
              <>
                <button onClick={handleCancel} disabled={acting}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-slate-500 active:scale-95 transition">
                  Cancel
                </button>
                <button onClick={handleSent} disabled={acting}
                  className="flex-1 py-3 rounded-2xl bg-brand-600 text-white text-sm font-bold active:scale-95 transition">
                  {acting ? "Marking…" : "Mark as Sent"}
                </button>
              </>
            )}
            {(inv.status === "sent" || inv.status === "overdue") && (
              <button
                className="flex-1 py-3 rounded-2xl bg-green-600 text-white text-sm font-bold active:scale-95 transition opacity-60 cursor-not-allowed">
                Record Payment (Phase 4)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Invoices({ userId, plan, onUpgrade, profile, inventory }) {
  const { invoices, customers, loading, reload, createDraft, markSent, cancelInvoice } = useInvoices(userId);
  const [filter,      setFilter]      = useState("all");
  const [showBuilder, setShowBuilder] = useState(false);
  const [detailInv,   setDetailInv]   = useState(null);

  if (!canDo(plan, "invoices")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-amber-400">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
        <p className="font-bold text-slate-700 dark:text-slate-200 text-base mb-1">Invoice Generation</p>
        <p className="text-sm text-slate-400 mb-5">Available on Naira and Oga plans</p>
        <button onClick={onUpgrade}
          className="bg-brand-600 text-white font-bold px-6 py-3 rounded-2xl text-sm active:scale-95 transition">
          Upgrade Plan
        </button>
      </div>
    );
  }

  const filtered = filter === "all"
    ? invoices
    : invoices.filter(i => i.status === filter);

  const handleBuilderSave = async (data) => {
    const { _saveAs, ...rest } = data;
    return await createDraft(rest);
  };

  const summary = {
    outstanding: invoices.filter(i => ["sent", "overdue", "partially_paid"].includes(i.status))
      .reduce((s, i) => s + (i.total_kobo - i.amount_paid_kobo), 0),
    overdue: invoices.filter(i => i.status === "overdue").length,
  };

  return (
    <div className="pb-6">
      {/* Summary banner */}
      {invoices.length > 0 && (
        <div className="mx-4 mt-4 mb-3 bg-gradient-to-r from-brand-600 to-brand-700 rounded-2xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold opacity-75 uppercase tracking-widest mb-0.5">Outstanding</p>
              <p className="text-2xl font-extrabold">{fmtK(summary.outstanding)}</p>
            </div>
            {summary.overdue > 0 && (
              <div className="bg-red-500 rounded-xl px-3 py-1.5 text-center">
                <p className="text-xs font-bold">{summary.overdue}</p>
                <p className="text-[10px] opacity-90">overdue</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter chips */}
      {invoices.length > 0 && (
        <div className="flex gap-2 px-4 mb-4 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_OPTIONS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold capitalize transition ${
                filter === f
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
              }`}>
              {f === "all" ? `All (${invoices.length})` : f}
            </button>
          ))}
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
        <div className="px-4">
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-12 text-sm">No {filter} invoices</p>
          ) : (
            filtered.map(inv => (
              <InvoiceCard key={inv.id} inv={inv} onTap={setDetailInv} />
            ))
          )}
        </div>
      )}

      {/* FAB */}
      {invoices.length > 0 && (
        <button onClick={() => setShowBuilder(true)}
          className="fixed bottom-24 right-4 z-30 w-14 h-14 bg-brand-600 hover:bg-brand-700 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14"/></svg>
        </button>
      )}

      {/* Invoice builder modal */}
      {showBuilder && (
        <InvoiceBuilder
          userId={userId}
          profile={profile}
          customers={customers}
          products={inventory?.items || []}
          onClose={(saved) => {
            setShowBuilder(false);
            if (saved) reload();
          }}
          onSaved={handleBuilderSave}
        />
      )}

      {/* Invoice detail modal */}
      {detailInv && (
        <InvoiceDetail
          inv={detailInv}
          onClose={() => setDetailInv(null)}
          onSent={async (id) => { await markSent(id); reload(); }}
          onCancel={async (id) => { await cancelInvoice(id); reload(); }}
        />
      )}
    </div>
  );
}
