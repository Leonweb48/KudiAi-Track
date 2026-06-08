import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import { TransactionReceipt } from "../components/shared/Receipt";
import { fmt, today } from "../utils/helpers";
import { canDo, planLimits } from "../utils/plans";

const CATEGORIES   = ["sale", "expense", "stock", "credit sale", "debt repayment", "other"];
const PAYMENT_TYPES = ["cash", "transfer", "pos", "mobile money"];

function AddTxnModal({ onAdd, onClose, defaultType = "in", inventory = null }) {
  const [f, setF] = useState({
    type:             defaultType,
    category:         "sale",
    amount:           "",
    unit_price:       "",
    item_name:        "",
    quantity:         "1",
    customer_name:    "",
    payment_type:     "cash",
    note:             "",
    transaction_date: today(),
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const products = inventory?.products || [];

  /* ── Auto-calculate amount ── */
  const recalc = (up, qty) => {
    const u = parseFloat(up); const q = parseInt(qty) || 1;
    if (u > 0) set("amount", String(u * q));
  };
  const handleUnitPrice = (v) => { set("unit_price", v); recalc(v, f.quantity); };
  const handleQty       = (v) => { set("quantity",   v); recalc(f.unit_price, v); };

  /* ── Inventory lookup ── */
  const matchedProduct = f.item_name
    ? products.find(p => p.product_name.toLowerCase() === f.item_name.toLowerCase())
    : null;

  const suggestions = f.item_name && f.item_name.length >= 1 && !matchedProduct && showSuggestions
    ? products.filter(p => p.product_name.toLowerCase().includes(f.item_name.toLowerCase())).slice(0, 5)
    : [];

  const requestedQty = parseInt(f.quantity) || 1;
  const stockAfter   = matchedProduct && f.type === "in" ? matchedProduct.quantity - requestedQty : null;
  const overStock    = f.type === "in" && matchedProduct && requestedQty > matchedProduct.quantity;

  const selectSuggestion = (p) => {
    const qty = parseInt(f.quantity) || 1;
    setF(prev => ({
      ...prev,
      item_name:  p.product_name,
      unit_price: String(p.selling_price || ""),
      amount:     p.selling_price ? String(p.selling_price * qty) : prev.amount,
    }));
    setShowSuggestions(false);
  };

  const canSave = f.amount && f.item_name && !overStock;

  const handleSubmit = () => {
    if (!canSave) return;
    const qty       = parseInt(f.quantity) || 1;
    const unitPrice = parseFloat(f.unit_price) || (parseFloat(f.amount) / qty);
    onAdd({ ...f, amount: parseFloat(f.amount), quantity: qty, unit_price: unitPrice });

    /* Sync matched inventory product on sales */
    if (matchedProduct && f.type === "in" && inventory?.recordMovement) {
      inventory.recordMovement({
        product_id: matchedProduct.id,
        type:       "sale",
        quantity:   qty,
        unit_price: unitPrice,
        notes:      f.customer_name ? `Sale to ${f.customer_name}` : "Auto-synced from transaction",
      });
    }
    onClose();
  };

  return (
    <Modal title="Record Transaction" onClose={onClose}>
      {/* Type toggle */}
      <div className="flex gap-2 mb-5">
        {["in","out"].map(t => (
          <button key={t} onClick={() => set("type", t)}
            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-colors ${
              f.type === t
                ? t === "in" ? "bg-green-600 text-white shadow-sm" : "bg-red-500 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {t === "in" ? "Cash In (Sale)" : "Cash Out (Expense)"}
          </button>
        ))}
      </div>

      <Field label="Category" as="select" value={f.category} onChange={e => set("category", e.target.value)}>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </Field>

      {/* Item name + autocomplete */}
      <div className="relative">
        <Field label="Item / Description" placeholder="e.g. Samsung Galaxy A15" value={f.item_name}
          onChange={e => { set("item_name", e.target.value); setShowSuggestions(true); }} />

        {/* Autocomplete dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
            {suggestions.map(p => (
              <button key={p.id} onClick={() => selectSuggestion(p)}
                className="w-full px-3.5 py-2.5 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{p.product_name}</p>
                  {p.category && <p className="text-[10px] text-slate-400 dark:text-slate-500">{p.category}</p>}
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-xs font-bold text-green-600">₦{(p.selling_price||0).toLocaleString()}</p>
                  <p className={`text-[10px] font-bold ${p.quantity <= p.low_stock_threshold ? "text-amber-500" : "text-slate-400 dark:text-slate-500"}`}>
                    {p.quantity} in stock
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Matched product stock banner */}
      {matchedProduct && (
        <div className={`rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-bold -mt-1 ${
          overStock
            ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
            : stockAfter !== null && stockAfter <= matchedProduct.low_stock_threshold
            ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
            : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
        }`}>
          <span className={overStock ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}>
            📦 {matchedProduct.product_name}
          </span>
          <span className={overStock ? "text-red-600 dark:text-red-400" : stockAfter !== null && stockAfter <= matchedProduct.low_stock_threshold ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
            {f.type === "in"
              ? overStock
                ? `Only ${matchedProduct.quantity} available`
                : stockAfter !== null
                  ? `After sale: ${stockAfter} left`
                  : `${matchedProduct.quantity} in stock`
              : `${matchedProduct.quantity} in stock`
            }
          </span>
        </div>
      )}

      {/* Over-stock error */}
      {overStock && (
        <p className="text-xs font-bold text-red-500 dark:text-red-400 -mt-1">
          ✕ Cannot sell {requestedQty} — only {matchedProduct.quantity} unit{matchedProduct.quantity !== 1 ? "s" : ""} available in stock
        </p>
      )}

      {/* Unit Price × Qty → Amount */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit Price (₦)" type="number" inputMode="decimal" placeholder="0.00"
          value={f.unit_price} onChange={e => handleUnitPrice(e.target.value)} />
        <Field label="Qty" type="number" inputMode="numeric" placeholder="1"
          value={f.quantity} onChange={e => handleQty(e.target.value)} />
      </div>

      {/* Auto-calc display */}
      {parseFloat(f.unit_price) > 0 && (
        <div className="bg-slate-800 dark:bg-slate-700 rounded-xl px-4 py-2.5 flex items-center justify-between -mt-1">
          <span className="text-xs text-slate-400">
            ₦{parseFloat(f.unit_price).toLocaleString()} × {parseInt(f.quantity)||1}
          </span>
          <span className="text-sm font-extrabold text-white">
            = ₦{(parseFloat(f.unit_price) * (parseInt(f.quantity)||1)).toLocaleString()}
          </span>
        </div>
      )}

      <Field label="Total Amount (₦)" type="number" inputMode="decimal" placeholder="0.00"
        value={f.amount} onChange={e => set("amount", e.target.value)} />

      <Field label="Customer Name (optional)" placeholder="e.g. Chidi Okeke" value={f.customer_name}
        onChange={e => set("customer_name", e.target.value)} />

      <Field label="Payment Method" as="select" value={f.payment_type}
        onChange={e => set("payment_type", e.target.value)}>
        {PAYMENT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
      </Field>

      <Field label="Note (optional)" as="textarea" placeholder="Any extra notes…" value={f.note}
        onChange={e => set("note", e.target.value)} />

      <Field label="Date" type="date" value={f.transaction_date}
        onChange={e => set("transaction_date", e.target.value)} />

      <button onClick={handleSubmit} disabled={!canSave}
        className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm shadow-sm transition disabled:opacity-50 active:scale-[0.99]">
        Save Transaction
      </button>
    </Modal>
  );
}

export default function Transactions({ store, plan = "starter", onVoiceOpen, autoOpen, autoType, onAutoOpened, onUpgrade, readOnly, inventory = null }) {
  const [showAdd,    setShowAdd]    = useState(false);
  const [initType,   setInitType]   = useState("in");
  const [filter,     setFilter]     = useState("all");
  const [search,     setSearch]     = useState("");
  const [receipt,    setReceipt]    = useState(null); // txn to show receipt for
  const { transactions, addTransaction, deleteTransaction, profile, staffMap = {} } = store;

  const limits         = planLimits(plan);
  const now            = new Date();
  const thisMonthTx    = transactions.filter(t => {
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

  const filtered = transactions.filter(t => {
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
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Limit banner */}
      {txLimitReached && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-base flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Monthly limit reached</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Free plan: {limits.maxTxPerMonth} transactions/month. Upgrade to record more.
            </p>
          </div>
          <button onClick={onUpgrade}
            className="text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-200 dark:bg-amber-700 px-2.5 py-1 rounded-lg flex-shrink-0">
            Upgrade
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">Transactions</h1>
        <div className="flex gap-2">
          {onVoiceOpen && !txLimitReached && (
            <button onClick={onVoiceOpen}
              className="w-9 h-9 bg-slate-800 dark:bg-slate-700 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <Icon name="mic" size={16} className="text-white" />
            </button>
          )}
          <button onClick={txLimitReached ? onUpgrade : () => openAdd("in")}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform ${txLimitReached ? "bg-amber-400" : "bg-green-600"}`}>
            <Icon name={txLimitReached ? "lock" : "plus"} size={18} className="text-white" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-3.5 border border-green-100 dark:border-green-800/60">
          <p className="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase tracking-wide">Total In</p>
          <p className="text-lg font-extrabold text-green-700 dark:text-green-400 tabular mt-0.5">{fmt(totIn)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3.5 border border-red-100 dark:border-red-800/60">
          <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase tracking-wide">Total Out</p>
          <p className="text-lg font-extrabold text-red-600 dark:text-red-400 tabular mt-0.5">{fmt(totOut)}</p>
        </div>
      </div>

      {/* Quick add */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => openAdd("in")}
          className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform shadow-sm">
          + Cash In
        </button>
        <button onClick={() => openAdd("out")}
          className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform shadow-sm">
          + Cash Out
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-3">
        {["all","in","out"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
              filter === f
                ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {f === "all" ? "All" : f === "in" ? "Cash In" : "Cash Out"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search" placeholder="Search item or customer…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">No transactions found</p>
          <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Tap + or use Voice to record one</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(t => {
            const isIn = t.type === "in";
            return (
              <div key={t.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/60">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                    <span className={`text-base font-black leading-none ${isIn ? "text-green-600" : "text-red-500"}`}>
                      {isIn ? "+" : "−"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{t.item_name}</p>
                      <p className={`font-extrabold text-sm tabular flex-shrink-0 ${isIn ? "text-green-600" : "text-red-500"}`}>
                        {isIn ? "+" : "−"}{fmt(t.amount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-semibold">{t.category}</span>
                      <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">{t.payment_type}</span>
                      {t.quantity > 1 && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-semibold">×{t.quantity}</span>}
                      {t.customer_name && <span className="text-[10px] text-slate-400 dark:text-slate-500">{t.customer_name}</span>}
                      {staffMap[t.staff_id] && (
                        <span className="text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold">
                          {staffMap[t.staff_id]}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-300 dark:text-slate-600 ml-auto">{t.transaction_date}</span>
                    </div>
                    {t.note && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 italic">"{t.note}"</p>}
                  </div>
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-slate-50 dark:border-slate-700/60">
                  <button
                    onClick={() => setReceipt(t)}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 transition"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <path d="M14 2v6h6M16 13H8M16 17H8" />
                    </svg>
                    Receipt
                  </button>

                  {!pdfAllowed && (
                    <button onClick={onUpgrade}
                      className="text-[11px] font-semibold text-slate-300 dark:text-slate-600 hover:text-amber-500 transition">
                      🔒 PDF (Upgrade)
                    </button>
                  )}

                  {deleteTransaction && (
                    <button onClick={() => deleteTransaction(t.id)}
                      className="ml-auto text-[11px] text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 font-semibold transition">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddTxnModal defaultType={initType} onAdd={addTransaction} onClose={() => setShowAdd(false)} inventory={inventory} />
      )}

      {receipt && (
        <TransactionReceipt
          txn={receipt}
          profile={profile}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
