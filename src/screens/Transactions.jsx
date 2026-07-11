import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import { useCampaigns }        from "../hooks/useCampaigns";
import AnnouncementBarSlot     from "../components/slots/AnnouncementBarSlot";
import TransactionPinModal from "../components/TransactionPinModal";
import Field  from "../components/shared/Field";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../utils/receiptConfig";
import { fmt, today } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { canDo, planLimits } from "../utils/plans";
import { createReportPdf, fmtCurrency, fmtDate } from "../utils/generateReportPdf";
import { useT } from "../contexts/LanguageContext";
import { getLang, speakConfirmation } from "../utils/i18n";
import { speakEvent } from "../utils/tts";
import { Capacitor } from "@capacitor/core";

const CATEGORIES   = ["sale", "expense", "stock", "credit sale", "debt repayment", "other"];
const PAYMENT_TYPES = ["cash", "transfer", "pos", "mobile money"];

export function AddTxnModal({ onAdd, onClose, defaultType = "in", inventory = null }) {
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
  const [txnPin, setTxnPin] = useState(null);
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
    if (Capacitor.isNativePlatform()) {
      speakEvent(f.type === "in" ? "cashIn" : "cashOut", getLang(), { amount: parseFloat(f.amount) }).catch(() => {});
    } else {
      speakConfirmation(f.type === "in" ? "cashIn" : "cashOut", getLang());
    }

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

      <button onClick={() => {
        if (!canSave) return;
        setTxnPin({
          title: f.type === "in" ? "Record Income" : "Record Expense",
          amount: Math.round(parseFloat(f.amount || 0) * 100),
          recipient: f.customer_name || undefined,
          description: f.item_name || undefined,
          onApprove: () => { setTxnPin(null); handleSubmit(); },
        });
      }} disabled={!canSave}
        className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm shadow-sm transition disabled:opacity-50 active:scale-[0.99]">
        Save Transaction
      </button>
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
    </Modal>
  );
}

export default function Transactions({ store, plan = "starter", onVoiceOpen, autoOpen, autoType, onAutoOpened, onUpgrade, readOnly, inventory = null }) {
  const t = useT();
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar", "upsell_inline"], "business", "business.sales");
  const salesAnnBars = camSlots.announcement_bar || [];
  const [showAdd,      setShowAdd]      = useState(false);
  const [initType,     setInitType]     = useState("in");
  const [filter,       setFilter]       = useState("all");
  const [search,       setSearch]       = useState("");
  const [receipt,      setReceipt]      = useState(null);
  const [ajoContribs,  setAjoContribs]  = useState(null);
  const { transactions, addTransaction, deleteTransaction, profile, staffMap = {}, asoClients = [] } = store;

  const asoClientMap = useMemo(() => {
    const m = {};
    asoClients.forEach(c => { m[c.id] = c; });
    return m;
  }, [asoClients]);

  useEffect(() => {
    if (filter !== "ajo") { setAjoContribs(null); return; }
    if (asoClients.length === 0) { setAjoContribs([]); return; }
    supabase
      .from("ajo_contributions")
      .select("id, aso_client_id, type, amount, payment_method, created_at, status")
      .in("aso_client_id", asoClients.map(c => c.id))
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setAjoContribs(data || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, asoClients.length]);

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

  const isAjoMode = filter === "ajo";
  const filtered = isAjoMode ? [] : transactions.filter(t => {
    if (filter === "in")          { if (t.type !== "in"  || t.payment_type === "bill_payment") return false; }
    else if (filter === "out")    { if (t.type !== "out" || t.payment_type === "bill_payment") return false; }
    else if (filter === "bills")  { if (t.payment_type !== "bill_payment") return false; }
    else if (filter === "credit") { if (t.category !== "credit sale" && t.category !== "debt repayment") return false; }
    if (search && !t.item_name?.toLowerCase().includes(search.toLowerCase()) &&
        !t.customer_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredAjo = isAjoMode
    ? (ajoContribs || []).filter(c =>
        !search || (asoClientMap[c.aso_client_id]?.full_name || "").toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const totIn  = transactions.reduce((s, t) => t.type === "in"  ? s + t.amount : s, 0);
  const totOut = transactions.reduce((s, t) => t.type === "out" ? s + t.amount : s, 0);

  const openAdd = (type = "in") => {
    if (txLimitReached) return;
    setInitType(type);
    setShowAdd(true);
  };

  const handleExportPdf = async () => {
    const biz    = store.profile?.business_name || store.profile?.owner_name || "My Business";
    const labels = { all: "All Transactions", in: "Income", out: "Expenses", bills: "Bill Payments", credit: "Credit" };
    const sorted = [...filtered].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
    let runBal = 0, totD = 0, totC = 0;
    const rows = sorted.map(t => {
      const isIn = t.type === "in";
      const amt  = parseFloat(t.amount) || 0;
      if (isIn) { runBal += amt; totC += amt; } else { runBal -= amt; totD += amt; }
      return {
        date:        fmtDate(t.transaction_date),
        description: t.item_name || "—",
        reference:   t.payment_type || "—",
        debit:       isIn ? "" : fmtCurrency(amt),
        credit:      isIn ? fmtCurrency(amt) : "",
        balance:     fmtCurrency(runBal),
      };
    });
    const pdf = await createReportPdf({
      title: "Transaction Statement", businessName: biz,
      period: labels[filter] || "All Transactions",
      headerRight: [
        { value: biz },
        store.profile?.owner_name ? { value: store.profile.owner_name, sub: true } : null,
        store.profile?.phone      ? { value: store.profile.phone,      sub: true } : null,
        store.profile?.email      ? { value: store.profile.email,      sub: true } : null,
      ].filter(Boolean),
      entityDetails: [
        { label: "Business", value: biz },
        { label: "Total Records", value: String(filtered.length) },
        { label: "Total Income", value: fmtCurrency(totIn) },
        { label: "Total Expenses", value: fmtCurrency(totOut) },
      ],
    });
    pdf.addStats([
      { label: "Total Income",   value: fmtCurrency(totIn),        color: "#22c55e" },
      { label: "Total Expenses", value: fmtCurrency(totOut),       color: "#ef4444" },
      { label: "Net Cash Flow",  value: fmtCurrency(totIn - totOut), color: totIn >= totOut ? "#22c55e" : "#ef4444" },
      { label: "Records",        value: String(filtered.length) },
    ]);
    pdf.addStatement(rows, { openingBalance: 0, totalDebits: totD, totalCredits: totC });
    await pdf.save("Transaction_Statement.pdf");
  };

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      <AnnouncementBarSlot campaigns={salesAnnBars} loading={camLoading} recordEvent={recordCamEvent} />

      {/* Limit banner */}
      {txLimitReached && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-base flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Monthly limit reached</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {limits.maxTxPerMonth} transactions/month limit reached. Upgrade to record more.
            </p>
          </div>
          <button onClick={onUpgrade}
            className="text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-200 dark:bg-amber-700 px-2.5 py-1 rounded-lg flex-shrink-0">
            Upgrade
          </button>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 -mx-4 px-4 py-3 mb-4 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">{t("txn.title")}</h1>
        <div className="flex gap-2">
          {pdfAllowed && filtered.length > 0 && (
            <button onClick={handleExportPdf}
              className="w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
              </svg>
            </button>
          )}
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
          <AmountDisplay amount={totIn} size="stat" align="left" style={{ color: '#15803d', marginTop: 2 }} />
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3.5 border border-red-100 dark:border-red-800/60">
          <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase tracking-wide">Total Out</p>
          <AmountDisplay amount={totOut} size="stat" align="left" style={{ color: '#dc2626', marginTop: 2 }} />
        </div>
      </div>

      {/* Net position chip */}
      {transactions.length > 0 && (
        <div className={`flex items-center justify-between rounded-2xl px-4 py-2.5 mb-4 ${
          totIn - totOut >= 0
            ? "bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40"
            : "bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40"
        }`}>
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Net Position</p>
          <p className={`text-sm font-extrabold tabular ${totIn - totOut >= 0 ? "text-green-600" : "text-red-500"}`}>
            {totIn - totOut >= 0 ? "+" : "−"}{fmt(Math.abs(totIn - totOut))}
          </p>
        </div>
      )}

      {/* Quick add */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => openAdd("in")}
          className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform shadow-sm">
          + {t("txn.cashIn")}
        </button>
        <button onClick={() => openAdd("out")}
          className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform shadow-sm">
          + {t("txn.cashOut")}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-0.5">
        {[
          { id: "all",    label: t("txn.all") },
          { id: "in",     label: t("txn.cashIn") },
          { id: "out",    label: t("txn.cashOut") },
          { id: "bills",  label: "Bills" },
          { id: "credit", label: "Credit" },
          { id: "ajo",    label: "Ajo" },
        ].map(opt => (
          <button key={opt.id} onClick={() => setFilter(opt.id)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
              filter === opt.id
                ? opt.id === "ajo"
                  ? "bg-violet-600 text-white"
                  : "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {opt.label}
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

      {/* Ajo events list (read-only) */}
      {isAjoMode && (
        ajoContribs === null ? (
          <div className="text-center py-14">
            <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">Loading Ajo events…</p>
          </div>
        ) : filteredAjo.length === 0 ? (
          <div className="text-center py-14">
            <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">No Ajo activity found</p>
            <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Ajo contributions and withdrawals appear here</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredAjo.map(c => {
              const client   = asoClientMap[c.aso_client_id];
              const isFee    = c.type === "withdrawal_fee" || c.type === "registration_fee";
              const isWd     = c.type === "withdrawal" || isFee;
              const amt      = parseFloat(c.amount) || 0;
              const typeLabel = isFee
                ? (c.type === "withdrawal_fee" ? "Withdrawal Fee" : "Reg. Fee")
                : c.type === "withdrawal" ? "Withdrawal"
                : c.payment_method === "manual_transfer" ? "Manual Deposit"
                : "Contribution";
              const dateStr  = c.created_at
                ? new Date(c.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                : "—";
              return (
                <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/60">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isWd ? "bg-red-100 dark:bg-red-900/30" : "bg-violet-100 dark:bg-violet-900/30"}`}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={isWd ? "#ef4444" : "#7c3aed"} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        {isWd
                          ? <><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></>
                          : <><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></>}
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{client?.full_name || "Unknown Client"}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{typeLabel} · {dateStr}</p>
                    </div>
                    <p className={`text-[14px] font-extrabold tabular flex-shrink-0 ${isWd ? "text-red-500" : "text-violet-600 dark:text-violet-400"}`}>
                      {isWd ? "−" : "+"}{fmt(amt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* List */}
      {!isAjoMode && filtered.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">No transactions found</p>
          <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Tap + or use Voice to record one</p>
        </div>
      ) : !isAjoMode && (
        <div className="space-y-2.5">
          {filtered.map(t => {
            const isIn = t.type === "in";
            const iconStyle = (() => {
              if (t.payment_type === "bill_payment") return { bg: "bg-cyan-100 dark:bg-cyan-900/30",   color: "#0891b2", paths: ["M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2","M9 5a2 2 0 002 2h2a2 2 0 002-2","M9 5a2 2 0 012-2h2a2 2 0 012 2","M9 13h6","M9 17h4"] };
              if (t.category === "credit sale")      return { bg: "bg-amber-100 dark:bg-amber-900/30", color: "#d97706", paths: ["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2","M9 11a4 4 0 100-8 4 4 0 000 8"] };
              if (t.category === "debt repayment")   return { bg: "bg-blue-100 dark:bg-blue-900/30",   color: "#2563eb", paths: ["M3 22h18","M6 18v-7","M10 18v-7","M14 18v-7","M18 18v-7","M12 2L2 7h20L12 2z"] };
              if (isIn) return { bg: "bg-green-100 dark:bg-green-900/30", color: "#16a34a", paths: ["M12 19V5","M5 12l7-7 7 7"] };
              return          { bg: "bg-red-100 dark:bg-red-900/30",     color: "#ef4444", paths: ["M12 5v14","M19 12l-7 7-7-7"] };
            })();
            return (
              <div key={t.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/60">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${iconStyle.bg}`}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={iconStyle.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      {iconStyle.paths.map((d, i) => <path key={i} d={d} />)}
                    </svg>
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
                    onClick={() => setReceipt(buildTransactionReceipt(t, profile))}
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
        <TransactionDetailModal
          data={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
