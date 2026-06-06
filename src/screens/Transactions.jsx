import { useState, useEffect } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import Field from "../components/shared/Field";
import { fmt, today } from "../utils/helpers";
import { canDo, planLimits } from "../utils/plans";
import { exportTransactionReceipt } from "../utils/pdfExport";

function AddTxnModal({ onAdd, onClose, defaultType = "in" }) {
  const [f, setF] = useState({
    type: defaultType, category: "sale", amount: "", item_name: "",
    quantity: 1, customer_name: "", payment_type: "cash", note: "",
    transaction_date: today(),
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal title="Record Transaction" onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {["in", "out"].map((t) => (
          <button key={t} onClick={() => set("type", t)}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
              f.type === t
                ? t === "in" ? "bg-green-600 text-white" : "bg-red-500 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {t === "in" ? "💰 Cash In" : "📤 Cash Out"}
          </button>
        ))}
      </div>

      <Field label="Category" as="select" value={f.category} onChange={(e) => set("category", e.target.value)}>
        {["sale", "expense", "stock", "credit sale", "debt repayment", "other"].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </Field>

      <Field label="Item / Description" placeholder="e.g. Ankara fabric" value={f.item_name}
        onChange={(e) => set("item_name", e.target.value)} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount (₦)" type="number" placeholder="0.00" value={f.amount}
          onChange={(e) => set("amount", e.target.value)} />
        <Field label="Qty" type="number" value={f.quantity}
          onChange={(e) => set("quantity", e.target.value)} />
      </div>

      <Field label="Customer Name" placeholder="Optional" value={f.customer_name}
        onChange={(e) => set("customer_name", e.target.value)} />

      <Field label="Payment Type" as="select" value={f.payment_type}
        onChange={(e) => set("payment_type", e.target.value)}>
        {["cash", "transfer", "pos", "mobile money"].map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </Field>

      <Field label="Note" as="textarea" placeholder="Optional note…" value={f.note}
        onChange={(e) => set("note", e.target.value)} />
      <Field label="Date" type="date" value={f.transaction_date}
        onChange={(e) => set("transaction_date", e.target.value)} />

      <button
        onClick={() => {
          if (!f.amount || !f.item_name) return;
          onAdd({ ...f, amount: parseFloat(f.amount) });
          onClose();
        }}
        className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm shadow-md transition">
        Save Transaction
      </button>
    </Modal>
  );
}

export default function Transactions({ store, plan = "starter", onVoiceOpen, autoOpen, autoType, onAutoOpened, onUpgrade }) {
  const [showAdd, setShowAdd]   = useState(false);
  const [initType, setInitType] = useState("in");
  const [filter,   setFilter]   = useState("all");
  const [search,   setSearch]   = useState("");
  const { transactions, addTransaction, deleteTransaction, profile } = store;

  // Month-limit check for Starter
  const limits = planLimits(plan);
  const now    = new Date();
  const thisMonthTx = transactions.filter((t) => {
    const d = new Date(t.transaction_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const txLimitReached = limits.maxTxPerMonth !== Infinity && thisMonthTx.length >= limits.maxTxPerMonth;
  const pdfAllowed     = canDo(plan, "pdfExport");

  useEffect(() => {
    if (autoOpen && !txLimitReached) {
      setInitType(autoType || "in");
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, autoType, onAutoOpened, txLimitReached]);

  const filtered = transactions.filter((t) => {
    if (filter !== "all" && t.type !== filter) return false;
    if (search && !t.item_name?.toLowerCase().includes(search.toLowerCase()) &&
        !t.customer_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totIn  = transactions.reduce((s, t) => t.type === "in"  ? s + t.amount : s, 0);
  const totOut = transactions.reduce((s, t) => t.type === "out" ? s + t.amount : s, 0);

  const openAdd = (type = "in") => {
    if (txLimitReached) return;
    setInitType(type);
    setShowAdd(true);
  };

  return (
    <div className="px-4 pt-4 pb-28 screen-enter">

      {/* Starter tx limit banner */}
      {txLimitReached && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Monthly limit reached</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Free plan allows {limits.maxTxPerMonth} transactions/month. Upgrade to record more.
            </p>
          </div>
          <button onClick={onUpgrade}
            className="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-200 dark:bg-amber-800 px-2 py-1 rounded-lg flex-shrink-0">
            Upgrade
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">Transactions</h1>
        <div className="flex gap-2">
          {onVoiceOpen && !txLimitReached && (
            <button onClick={onVoiceOpen}
              className="w-9 h-9 bg-slate-800 dark:bg-slate-700 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              aria-label="Voice input">
              <Icon name="mic" size={16} className="text-white" />
            </button>
          )}
          <button onClick={txLimitReached ? onUpgrade : () => openAdd("in")}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform ${txLimitReached ? "bg-amber-400" : "bg-green-600"}`}>
            <Icon name={txLimitReached ? "lock" : "plus"} size={18} className="text-white" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-3 border border-green-100 dark:border-green-800">
          <p className="text-[10px] text-green-600 font-bold uppercase">Total In</p>
          <p className="text-lg font-extrabold text-green-700 dark:text-green-400">{fmt(totIn)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3 border border-red-100 dark:border-red-800">
          <p className="text-[10px] text-red-500 font-bold uppercase">Total Out</p>
          <p className="text-lg font-extrabold text-red-600 dark:text-red-400">{fmt(totOut)}</p>
        </div>
      </div>

      {/* Quick add row */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => openAdd("in")}
          className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform">
          + Cash In
        </button>
        <button onClick={() => openAdd("out")}
          className="flex-1 py-2 bg-red-500 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform">
          + Cash Out
        </button>
      </div>

      {/* Filter + search */}
      <div className="flex gap-2 mb-3">
        {["all", "in", "out"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              filter === f
                ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {f === "all" ? "All" : f === "in" ? "Cash In" : "Cash Out"}
          </button>
        ))}
      </div>

      <input
        type="search"
        placeholder="Search item or customer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
      />

      {/* Transaction list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">No transactions found</p>
          <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Tap + or use Voice to record one</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={t.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100 dark:border-slate-700">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  t.type === "in" ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"
                }`}>
                  <span className={`text-base font-black ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
                    {t.type === "in" ? "+" : "−"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{t.item_name}</p>
                    <p className={`font-extrabold text-sm ml-2 flex-shrink-0 ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
                      {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-semibold">
                      {t.category}
                    </span>
                    <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">
                      {t.payment_type}
                    </span>
                    {t.customer_name && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{t.customer_name}</span>
                    )}
                    <span className="text-[10px] text-slate-300 dark:text-slate-600 ml-auto">{t.transaction_date}</span>
                  </div>
                  {t.note && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 italic">"{t.note}"</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                {pdfAllowed ? (
                  <button onClick={() => exportTransactionReceipt(t, profile)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-green-600 transition font-semibold">
                    <Icon name="download" size={11} /> Receipt
                  </button>
                ) : (
                  <button onClick={onUpgrade}
                    className="flex items-center gap-1 text-[10px] text-slate-300 dark:text-slate-600 hover:text-amber-500 transition font-semibold">
                    🔒 PDF (Upgrade)
                  </button>
                )}
                {deleteTransaction && (
                  <button onClick={() => deleteTransaction(t.id)}
                    className="ml-auto text-[10px] text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 font-semibold transition">
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddTxnModal
          defaultType={initType}
          onAdd={addTransaction}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
