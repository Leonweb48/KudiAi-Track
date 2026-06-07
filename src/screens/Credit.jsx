import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import { CreditReceipt } from "../components/shared/Receipt";
import { ClientProfile }  from "../components/shared/ClientProfile";
import { fmt } from "../utils/helpers";

export default function Credit({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [repaying, setRepaying] = useState(null);
  const [repayAmt, setRepayAmt] = useState("");
  const [receipt,  setReceipt]  = useState(null);
  const [profile_, setProfile_] = useState(null);
  const { credits, addCredit, repayCredit, updateCredit, profile } = store;

  const [f, setF] = useState({
    customer_name: "", phone: "", address: "",
    total_amount: "", due_date: "", notes: "",
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (autoOpen) { setShowAdd(true); onAutoOpened?.(); }
  }, [autoOpen, onAutoOpened]);

  const totalOut = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdue  = credits.filter(c => c.status === "overdue").length;

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">Credit Tracker</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Summary hero */}
      <div className="rounded-3xl px-6 py-5 mb-5 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(135deg,#f59e0b 0%,#d97706 55%,#b45309 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Total Outstanding</p>
          <p className="text-3xl font-black tabular mb-4">{fmt(totalOut)}</p>
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Debtors</p>
              <p className="text-base font-bold">{credits.length}</p>
            </div>
            {overdue > 0 && (
              <>
                <div className="w-px bg-white/20 self-stretch" />
                <div>
                  <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Overdue</p>
                  <p className="text-base font-bold text-red-200">⚠ {overdue}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-amber-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No credit records yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to add a debtor</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credits.map(c => {
            const pct = Math.min(100, ((c.amount_paid || 0) / (c.total_amount || 1)) * 100);
            return (
              <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/60">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="font-bold text-slate-800 dark:text-slate-100">{c.customer_name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {c.phone && <span>{c.phone} · </span>}Due: {c.due_date || "—"}
                    </p>
                  </div>
                  <Badge status={c.status} />
                </div>

                {/* Amounts */}
                <div className="flex gap-2 mb-3">
                  {[
                    { label: "Owed",  value: c.outstanding,  color: "text-red-500 dark:text-red-400" },
                    { label: "Paid",  value: c.amount_paid,  color: "text-green-600 dark:text-green-400" },
                    { label: "Total", value: c.total_amount, color: "text-slate-700 dark:text-slate-200" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex-1 bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-extrabold tabular ${color}`}>{fmt(value)}</p>
                    </div>
                  ))}
                </div>

                {/* Progress */}
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">
                    <span>Paid {Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                <div className="flex gap-2 pt-2.5 border-t border-slate-50 dark:border-slate-700/60">
                  {c.outstanding > 0 && (
                    <button onClick={() => setRepaying(c)}
                      className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 hover:bg-green-100 transition active:scale-[0.99]">
                      Record Payment
                    </button>
                  )}
                  <button onClick={() => setProfile_(c)}
                    className="py-2 px-3 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5 active:scale-[0.99]">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    </svg>
                    Profile
                  </button>
                  <button
                    onClick={() => setReceipt(c)}
                    className="py-2 px-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition flex items-center gap-1.5 active:scale-[0.99]">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8" />
                    </svg>
                    Statement
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add credit modal */}
      {showAdd && (
        <Modal title="Add Credit Record" onClose={() => setShowAdd(false)}>
          <Field label="Customer Name" value={f.customer_name}
            onChange={e => set("customer_name", e.target.value)} placeholder="e.g. Chidi Okeke" />
          <Field label="Phone" type="tel" value={f.phone}
            onChange={e => set("phone", e.target.value)} placeholder="0801 234 5678" />
          <Field label="Address (optional)" value={f.address}
            onChange={e => set("address", e.target.value)} placeholder="Optional" />
          <Field label="Amount Owed (₦)" type="number" inputMode="decimal" value={f.total_amount}
            onChange={e => set("total_amount", e.target.value)} placeholder="0.00" />
          <Field label="Due Date" type="date" value={f.due_date}
            onChange={e => set("due_date", e.target.value)} />
          <Field label="Notes (optional)" as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes…" />
          <button
            onClick={() => {
              if (!f.customer_name || !f.total_amount) return;
              addCredit({ ...f, total_amount: parseFloat(f.total_amount) });
              setShowAdd(false);
              setF({ customer_name: "", phone: "", address: "", total_amount: "", due_date: "", notes: "" });
            }}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm">
            Save Credit Record
          </button>
        </Modal>
      )}

      {/* Repayment modal */}
      {repaying && (
        <Modal title={`Record Payment — ${repaying.customer_name}`}
          onClose={() => { setRepaying(null); setRepayAmt(""); }}>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3 mb-4 border border-red-100 dark:border-red-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding balance</p>
            <p className="text-xl font-black text-red-500 dark:text-red-400 tabular">{fmt(repaying.outstanding)}</p>
          </div>
          <Field label="Payment Amount (₦)" type="number" inputMode="decimal" value={repayAmt}
            onChange={e => setRepayAmt(e.target.value)} placeholder="Enter amount paid" />
          <button
            onClick={() => {
              if (!repayAmt) return;
              repayCredit(repaying.id, parseFloat(repayAmt));
              setRepaying(null);
              setRepayAmt("");
            }}
            className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm">
            Confirm Payment
          </button>
        </Modal>
      )}

      {receipt && (
        <CreditReceipt
          credit={receipt}
          profile={profile}
          onClose={() => setReceipt(null)}
        />
      )}

      {profile_ && (
        <ClientProfile
          record={profile_}
          type="credit"
          onSave={updateCredit}
          onClose={() => setProfile_(null)}
        />
      )}
    </div>
  );
}
