import { useState, useEffect } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import Field from "../components/shared/Field";
import Badge from "../components/shared/Badge";
import { fmt } from "../utils/helpers";
import { canDo } from "../utils/plans";
import { exportCreditStatement } from "../utils/pdfExport";

export default function Credit({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [repaying, setRepaying] = useState(null);
  const [repayAmt, setRepayAmt] = useState("");
  const { credits, addCredit, repayCredit, profile } = store;

  const [f, setF] = useState({
    customer_name: "", phone: "", address: "",
    total_amount: "", due_date: "", notes: "",
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (autoOpen) {
      setShowAdd(true);
      onAutoOpened?.();
    }
  }, [autoOpen, onAutoOpened]);

  const totalOut   = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdue    = credits.filter((c) => c.status === "overdue").length;
  const pdfAllowed = canDo(plan, "pdfExport");

  return (
    <div className="px-4 pt-4 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">Credit Tracker</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Summary card */}
      <div className="rounded-2xl p-4 mb-5 shadow text-white"
        style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
        <div className="flex justify-between">
          <div>
            <p className="text-xs text-amber-100 font-semibold uppercase tracking-wider">Total Outstanding</p>
            <p className="text-2xl font-extrabold mt-0.5">{fmt(totalOut)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-amber-100 font-semibold">{credits.length} debtors</p>
            {overdue > 0 && (
              <p className="text-sm font-bold text-red-200 mt-1">⚠ {overdue} overdue</p>
            )}
          </div>
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">📋</span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">No credit records yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to add a debtor</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credits.map((c) => (
            <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-sm border border-slate-100 dark:border-slate-700">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-100">{c.customer_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{c.phone} · Due: {c.due_date}</p>
                </div>
                <Badge status={c.status} />
              </div>

              <div className="flex gap-2 mb-3">
                {[
                  { label: "Owed",  value: c.outstanding,  color: "text-red-500 dark:text-red-400" },
                  { label: "Paid",  value: c.amount_paid,  color: "text-green-600 dark:text-green-400" },
                  { label: "Total", value: c.total_amount, color: "text-slate-700 dark:text-slate-300" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-xl p-2">
                    <p className="text-[10px] text-slate-400 font-semibold">{label}</p>
                    <p className={`text-sm font-extrabold ${color}`}>{fmt(value)}</p>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mb-3 overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (c.amount_paid / c.total_amount) * 100)}%` }} />
              </div>

              {c.notes && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-2">"{c.notes}"</p>
              )}

              <div className="flex gap-2">
                {c.outstanding > 0 && (
                  <button onClick={() => setRepaying(c)}
                    className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 hover:bg-green-100 transition">
                    Record Payment
                  </button>
                )}
                {pdfAllowed ? (
                  <button onClick={() => exportCreditStatement(c, profile)}
                    className="py-2 px-3 bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 hover:bg-slate-100 transition flex items-center gap-1">
                    <Icon name="download" size={12} /> PDF
                  </button>
                ) : (
                  <button onClick={onUpgrade}
                    className="py-2 px-3 bg-slate-50 dark:bg-slate-700 text-slate-400 dark:text-slate-500 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 flex items-center gap-1">
                    🔒 PDF
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add credit modal */}
      {showAdd && (
        <Modal title="Add Credit Record" onClose={() => setShowAdd(false)}>
          <Field label="Customer Name" value={f.customer_name}
            onChange={(e) => set("customer_name", e.target.value)} placeholder="e.g. Chidi Okeke" />
          <Field label="Phone" type="tel" value={f.phone}
            onChange={(e) => set("phone", e.target.value)} placeholder="0801 234 5678" />
          <Field label="Address" value={f.address}
            onChange={(e) => set("address", e.target.value)} placeholder="Optional" />
          <Field label="Amount Owed (₦)" type="number" value={f.total_amount}
            onChange={(e) => set("total_amount", e.target.value)} placeholder="0.00" />
          <Field label="Due Date" type="date" value={f.due_date}
            onChange={(e) => set("due_date", e.target.value)} />
          <Field label="Notes" as="textarea" value={f.notes}
            onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes…" />
          <button
            onClick={() => {
              if (!f.customer_name || !f.total_amount) return;
              addCredit({ ...f, total_amount: parseFloat(f.total_amount) });
              setShowAdd(false);
              setF({ customer_name: "", phone: "", address: "", total_amount: "", due_date: "", notes: "" });
            }}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm transition">
            Save Credit Record
          </button>
        </Modal>
      )}

      {/* Repayment modal */}
      {repaying && (
        <Modal
          title={`Record Payment — ${repaying.customer_name}`}
          onClose={() => { setRepaying(null); setRepayAmt(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Outstanding: <strong className="text-red-500">{fmt(repaying.outstanding)}</strong>
          </p>
          <Field label="Payment Amount (₦)" type="number" value={repayAmt}
            onChange={(e) => setRepayAmt(e.target.value)} placeholder="Enter amount paid" />
          <button
            onClick={() => {
              if (!repayAmt) return;
              repayCredit(repaying.id, parseFloat(repayAmt));
              setRepaying(null);
              setRepayAmt("");
            }}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition">
            Confirm Payment
          </button>
        </Modal>
      )}
    </div>
  );
}
