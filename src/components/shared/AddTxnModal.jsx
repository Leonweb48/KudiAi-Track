import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { today } from "../../utils/helpers";
import { speakEvent } from "../../utils/tts";
import { getLang, speakConfirmation } from "../../utils/i18n";

/* ── Fuzzy near-match ──────────────────────────────────────────── */
function fuzzyMatch(query, target) {
  const a = query.toLowerCase().replace(/\s+/g, " ").trim();
  const b = target.toLowerCase().replace(/\s+/g, " ").trim();
  if (a === b || a.length < 3) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const min = Math.min(a.length, b.length);
  return min >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

/* ── Category sets ─────────────────────────────────────────────── */
const CATS_IN  = ["sale", "credit sale", "debt repayment"];
const CATS_OUT = ["expense", "stock", "other"];

const PAYMENT_TYPES = [
  { id: "cash",         label: "Cash" },
  { id: "transfer",     label: "Transfer" },
  { id: "pos",          label: "POS" },
  { id: "mobile money", label: "Mobile Money" },
];

const DUE_CHIPS = [
  { id: "tomorrow", label: "Tomorrow" },
  { id: "1week",    label: "1 Week"   },
  { id: "custom",   label: "Custom"   },
];

function calcDueDate(label, customDate) {
  if (label === "custom") return customDate || null;
  const d = new Date();
  if (label === "tomorrow") d.setDate(d.getDate() + 1);
  else if (label === "1week") d.setDate(d.getDate() + 7);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(n) {
  if (!n && n !== 0) return "";
  return Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Input: amount field (₦ prefix, native keyboard) ────────────── */
function AmountInput({ value, onChange, placeholder = "0.00", label, autoFocus, className }) {
  return (
    <div className={`relative flex items-center ${className || ""}`}>
      <span className="absolute left-3.5 text-slate-400 font-bold text-base select-none pointer-events-none">₦</span>
      <input
        type="number"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
        aria-label={label}
        className="w-full h-11 pl-8 pr-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30"
        style={{ fontVariantNumeric: "tabular-nums" }}
      />
    </div>
  );
}

/* ── Line item row in cart ─────────────────────────────────────── */
function LineItemRow({ item, index, onRemove, typeColor }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
          {item.name || <span className="text-slate-400 italic">Unnamed item</span>}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {item.qty > 1 ? `${item.qty} × ₦${fmtMoney(item.unitPrice)}` : `₦${fmtMoney(item.unitPrice)}`}
          {item.productId && (
            <span className="ml-1.5 text-green-600 dark:text-green-400 font-bold">· stock-linked</span>
          )}
        </p>
      </div>
      <span
        className="font-extrabold text-sm flex-shrink-0"
        style={{ color: typeColor, fontVariantNumeric: "tabular-nums" }}>
        ₦{fmtMoney(item.lineTotal)}
      </span>
      <button
        onClick={() => onRemove(index)}
        className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform">
        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-500" stroke="currentColor" strokeWidth={2.5}>
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AddTxnModal — multi-item, native keyboard
   Props interface frozen: onAdd, onClose, defaultType, defaultCategory, inventory
   ══════════════════════════════════════════════════════════════════ */
export function AddTxnModal({
  onAdd,
  onClose,
  defaultType     = "in",
  defaultCategory = "sale",
  inventory       = null,
}) {
  /* ── Transaction-level fields ── */
  const [type,         setType]         = useState(defaultType);
  const [category,     setCategory]     = useState(defaultCategory);
  const [customerName, setCustomerName] = useState("");
  const [paymentType,  setPaymentType]  = useState("cash");
  const [note,         setNote]         = useState("");
  const [txDate,       setTxDate]       = useState(today());
  const [dueLabel,     setDueLabel]     = useState(null);
  const [customDue,    setCustomDue]    = useState("");

  /* ── Cart (line items) ── */
  const [lineItems, setLineItems] = useState([]);

  /* ── Item-entry form ── */
  const [itemName,          setItemName]          = useState("");
  const [qty,               setQty]               = useState("1");
  const [unitPrice,         setUnitPrice]         = useState("");
  const [showSugs,          setShowSugs]          = useState(false);
  const [fuzzySugDismissed, setFuzzySugDismissed] = useState(false);

  /* ── UI state ── */
  const [showDetails,        setShowDetails]        = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [saveError,          setSaveError]          = useState("");
  const [saveSuccess,        setSaveSuccess]        = useState(false);

  /* ── Keyboard-aware sizing ── */
  const [vvHeight, setVvHeight] = useState(null);

  /* ── Sheet animation ── */
  const [sheetY,  setSheetY]  = useState("100%");
  const [sheetTx, setSheetTx] = useState("transform 0.3s cubic-bezier(0.34,1.56,0.64,1)");
  const sheetRef   = useRef(null);
  const bodyRef    = useRef(null);
  const dragRef    = useRef({ startY: 0, curDy: 0, active: false });
  const isDirtyRef = useRef(false);

  /* Entry animation */
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetY("0px")));
  }, []);

  /* Keyboard-aware sizing */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVvHeight(vv.height);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  /* Scroll focused input into view */
  const scrollIntoViewDelayed = (e) => {
    const el = e.target;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 320);
  };

  /* Reset category when type changes */
  useEffect(() => {
    const valid = type === "in" ? CATS_IN : CATS_OUT;
    if (!valid.includes(category)) setCategory(type === "in" ? "sale" : "expense");
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setFuzzySugDismissed(false); }, [itemName]);

  /* ── Derived values ── */
  const products      = inventory?.products || [];
  const qtyNum        = Math.max(1, parseInt(qty) || 1);
  const unitPriceVal  = parseFloat(unitPrice) || 0;
  const lineTotal     = unitPriceVal * qtyNum;
  const cartTotal     = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const canSave       = lineItems.length > 0;

  const matchedProduct = itemName
    ? products.find(p => p.product_name.toLowerCase().trim() === itemName.toLowerCase().trim())
    : null;
  const suggestions = itemName && itemName.length >= 1 && !matchedProduct && showSugs
    ? products.filter(p => p.product_name.toLowerCase().includes(itemName.toLowerCase().trim())).slice(0, 5)
    : [];
  const fuzzySuggestion = (!itemName || matchedProduct || suggestions.length > 0 || fuzzySugDismissed || type !== "in")
    ? null
    : (products.find(p => fuzzyMatch(itemName, p.product_name)) || null);

  const stockAfter    = matchedProduct && type === "in" ? matchedProduct.quantity - qtyNum : null;
  const itemOverStock = type === "in" && matchedProduct && qtyNum > matchedProduct.quantity;
  const canAddItem    = unitPriceVal > 0 && !itemOverStock;

  const isDirty = lineItems.length > 0 || itemName !== "" || unitPrice !== "" || customerName !== "" || note !== "";
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const typeColor = type === "in" ? "var(--brand-green)" : "var(--navy)";

  /* ── Animated close ── */
  const animClose = (thenClose) => {
    setSheetTx("transform 0.25s cubic-bezier(0.4,0,1,1)");
    setSheetY("100%");
    setTimeout(thenClose, 250);
  };

  const tryClose = () => {
    if (isDirtyRef.current) { setShowDiscardConfirm(true); return; }
    animClose(onClose);
  };

  /* ── Drag-to-dismiss ── */
  useEffect(() => {
    const handle = sheetRef.current?.querySelector("[data-drag-handle]");
    if (!handle) return;
    const onStart = (e) => {
      dragRef.current = { startY: e.touches[0].clientY, curDy: 0, active: true };
      setSheetTx("none");
    };
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      const dy = Math.max(0, e.touches[0].clientY - dragRef.current.startY);
      dragRef.current.curDy = dy;
      setSheetY(dy + "px");
    };
    const onEnd = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const dy = dragRef.current.curDy;
      if (dy > 100) {
        setSheetTx("transform 0.25s cubic-bezier(0.4,0,1,1)");
        setSheetY("100%");
        setTimeout(() => {
          if (isDirtyRef.current) {
            setSheetTx("transform 0.3s cubic-bezier(0.34,1.56,0.64,1)");
            setSheetY("0px");
            setShowDiscardConfirm(true);
          } else { onClose(); }
        }, 250);
      } else {
        setSheetTx("transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)");
        setSheetY("0px");
      }
    };
    handle.addEventListener("touchstart", onStart,  { passive: true });
    handle.addEventListener("touchmove",  onMove,   { passive: true });
    handle.addEventListener("touchend",   onEnd,    { passive: true });
    handle.addEventListener("touchcancel", onEnd,   { passive: true });
    return () => {
      handle.removeEventListener("touchstart",  onStart);
      handle.removeEventListener("touchmove",   onMove);
      handle.removeEventListener("touchend",    onEnd);
      handle.removeEventListener("touchcancel", onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Autocomplete suggestion pick ── */
  const selectSuggestion = (p) => {
    setItemName(p.product_name);
    setUnitPrice(String(p.selling_price || ""));
    setShowSugs(false);
  };

  /* ── Add current item form to cart ── */
  const addLineItem = () => {
    if (!canAddItem) return;
    setLineItems(prev => [...prev, {
      name:         itemName.trim(),
      qty:          qtyNum,
      unitPrice:    unitPriceVal,
      lineTotal,
      productId:    matchedProduct?.id    ?? null,
      costPrice:    matchedProduct?.cost_price ?? null,
      needsCosting: !matchedProduct || matchedProduct.needs_costing || !(matchedProduct.cost_price > 0),
    }]);
    setItemName("");
    setQty("1");
    setUnitPrice("");
    setShowSugs(false);
    setFuzzySugDismissed(false);
    setSaveError("");
  };

  const removeLineItem = (index) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  /* ── Build payload ── */
  const buildPayload = () => {
    const isSingle = lineItems.length === 1;
    const first    = lineItems[0] || {};
    const duePart  = dueLabel ? `Due: ${calcDueDate(dueLabel, customDue) || ""}` : "";
    const finalNote = [note.trim(), duePart].filter(Boolean).join(" · ");
    return {
      type,
      category,
      amount:           cartTotal,
      unit_price:       isSingle ? first.unitPrice : null,
      item_name:        isSingle ? (first.name || null) : null,
      quantity:         isSingle ? first.qty : null,
      customer_name:    customerName,
      payment_type:     paymentType,
      note:             finalNote,
      transaction_date: txDate,
      line_items:       isSingle ? undefined : lineItems,
    };
  };

  /* PIN security boundary: recording income/expense requires NO PIN.
     Same rule as before — additive operations are unpinned. */
  const handleSubmit = () => {
    if (!canSave || saving || saveSuccess) return;
    const payload = buildPayload();
    setSaving(true);
    setSaveError("");
    try {
      onAdd(payload);
      if (Capacitor.isNativePlatform()) {
        speakEvent(type === "in" ? "cashIn" : "cashOut", getLang(), { amount: cartTotal }).catch(() => {});
      } else {
        speakConfirmation(type === "in" ? "cashIn" : "cashOut", getLang());
      }

      /* Stock deduction: one recordMovement per stock-linked line item */
      if (type === "in" && inventory?.recordMovement) {
        lineItems.forEach(li => {
          if (!li.productId) return;
          inventory.recordMovement({
            product_id: li.productId,
            type:       "sale",
            quantity:   li.qty,
            unit_price: li.unitPrice,
            notes:      customerName ? `Sale to ${customerName}` : "Auto-synced from transaction",
          });
        });
      }

      /* Auto-stub for unrecognised item names (fire-and-forget) */
      if (type === "in" && inventory?.createAutoStub) {
        lineItems.forEach(li => {
          if (li.name && !li.productId) {
            inventory.createAutoStub(li.name, li.unitPrice, li.qty);
          }
        });
      }

      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => animClose(onClose), 1100);
    } catch (err) {
      setSaving(false);
      setSaveError(err?.message || "Something went wrong. Try again.");
    }
  };

  const cats = type === "in" ? CATS_IN : CATS_OUT;

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0"
        style={{ zIndex: "var(--z-sheet)", background: "rgba(0,0,0,0.55)" }}
        onClick={tryClose}
      />

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className="fixed left-0 right-0 bottom-0 bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
        style={{
          zIndex:        "calc(var(--z-sheet) + 1)",
          borderRadius:  "24px 24px 0 0",
          maxHeight:     vvHeight != null
            ? `calc(${vvHeight}px - env(safe-area-inset-top, 20px))`
            : "calc(100dvh - env(safe-area-inset-top, 20px))",
          paddingBottom: vvHeight != null && vvHeight < (window.innerHeight * 0.85)
            ? "8px"
            : "max(24px, env(safe-area-inset-bottom, 24px))",
          transform:  `translateY(${sheetY})`,
          transition: sheetTx,
        }}>

        {/* Drag handle + header */}
        <div data-drag-handle className="flex-shrink-0 cursor-grab">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="flex items-center justify-between px-5 py-2">
            <h2 className="text-base font-bold text-slate-800 dark:text-white">Record Transaction</h2>
            <button
              onClick={tryClose}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 active:scale-95 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400"
                stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-5 pt-2 pb-2">

          {/* Type toggle */}
          <div className="flex gap-2 mb-4">
            {[
              { id: "in",  label: "Money In",  activeStyle: { background: "var(--brand-green)" } },
              { id: "out", label: "Money Out", activeStyle: { background: "var(--navy)" } },
            ].map(btn => (
              <button key={btn.id} onClick={() => setType(btn.id)}
                className={`flex-1 min-h-[44px] py-3 rounded-xl font-bold text-sm transition-colors ${
                  type === btn.id ? "text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}
                style={type === btn.id ? btn.activeStyle : undefined}>
                {btn.label}
              </button>
            ))}
          </div>

          {/* ── Cart list ── */}
          {lineItems.length > 0 && (
            <div className="mb-4 space-y-2">
              {lineItems.map((li, i) => (
                <LineItemRow key={i} item={li} index={i} onRemove={removeLineItem} typeColor={typeColor} />
              ))}
              {/* Running total */}
              <div className="flex items-center justify-between px-3.5 py-3 rounded-xl border-2"
                style={{ borderColor: type === "in" ? "var(--brand-green)" : "var(--navy)" }}>
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
                  Total{lineItems.length > 1 ? ` (${lineItems.length} items)` : ""}
                </span>
                <span className="text-xl font-extrabold" style={{ color: typeColor, fontVariantNumeric: "tabular-nums" }}>
                  ₦{fmtMoney(cartTotal)}
                </span>
              </div>
            </div>
          )}

          {/* ── Item-entry form ── */}
          <div className="mb-4 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3"
            style={{ background: "rgba(0,0,0,0.015)" }}>

            <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              {lineItems.length === 0 ? "Add item" : "Add another item"}
            </p>

            {/* Item name + autocomplete */}
            <div className="relative">
              <input
                type="text"
                placeholder={type === "in" ? "Item or product name" : "Expense description"}
                value={itemName}
                onChange={e => { setItemName(e.target.value); setShowSugs(true); }}
                onFocus={scrollIntoViewDelayed}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                  {suggestions.map(p => (
                    <button key={p.id} onClick={() => selectSuggestion(p)}
                      className="w-full px-3.5 py-2.5 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-b border-slate-100 dark:border-slate-700 last:border-0">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{p.product_name}</p>
                        {p.category && <p className="text-[10px] text-slate-400">{p.category}</p>}
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-xs font-bold text-green-600">₦{(p.selling_price || 0).toLocaleString()}</p>
                        <p className={`text-[10px] font-bold ${p.quantity <= (p.low_stock_threshold || 0) ? "text-amber-500" : "text-slate-400"}`}>
                          {p.quantity} in stock
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fuzzy suggestion chip */}
            {fuzzySuggestion && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <span className="text-xs text-amber-700 dark:text-amber-300 flex-1 leading-snug">
                  Did you mean <strong>{fuzzySuggestion.product_name}</strong>?
                </span>
                <button onPointerDown={e => { e.preventDefault(); selectSuggestion(fuzzySuggestion); }}
                  className="text-xs font-bold text-amber-700 dark:text-amber-300 underline active:opacity-70 flex-shrink-0 px-1">
                  Link
                </button>
                <button onPointerDown={e => { e.preventDefault(); setFuzzySugDismissed(true); }}
                  className="text-[11px] text-amber-500 dark:text-amber-400 active:opacity-70 flex-shrink-0 px-1">
                  Ignore
                </button>
              </div>
            )}

            {/* Stock badge */}
            {matchedProduct && type === "in" && (
              <div className={`rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-bold ${
                itemOverStock
                  ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                  : stockAfter !== null && stockAfter <= (matchedProduct.low_stock_threshold || 0)
                  ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                  : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              }`}>
                <span className={itemOverStock ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}>
                  📦 {matchedProduct.product_name}
                </span>
                <span className={
                  itemOverStock ? "text-red-600 dark:text-red-400"
                  : stockAfter !== null && stockAfter <= (matchedProduct.low_stock_threshold || 0) ? "text-amber-600 dark:text-amber-400"
                  : "text-green-600 dark:text-green-400"
                }>
                  {itemOverStock
                    ? `Only ${matchedProduct.quantity} available`
                    : stockAfter !== null ? `After sale: ${stockAfter} left`
                    : `${matchedProduct.quantity} in stock`}
                </span>
              </div>
            )}

            {/* Qty + unit price row */}
            <div className="flex gap-2 items-end">
              {/* Qty stepper */}
              <div className="flex-shrink-0">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Qty</label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setQty(String(Math.max(1, qtyNum - 1)))}
                    className="w-9 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-lg flex items-center justify-center active:scale-95 transition-transform">
                    −
                  </button>
                  <input
                    type="number" inputMode="numeric" min="1" value={qty}
                    onChange={e => setQty(e.target.value)}
                    onFocus={scrollIntoViewDelayed}
                    className="w-12 h-11 text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  />
                  <button
                    onClick={() => setQty(String(qtyNum + 1))}
                    className="w-9 h-11 rounded-xl text-white font-bold text-lg flex items-center justify-center active:scale-95 transition-transform"
                    style={{ background: "var(--brand-green)" }}>
                    +
                  </button>
                </div>
              </div>

              {/* Unit price */}
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  {qtyNum > 1 ? "Unit price" : "Amount"}
                </label>
                <AmountInput
                  value={unitPrice}
                  onChange={v => setUnitPrice(v)}
                  placeholder="0.00"
                  label={qtyNum > 1 ? "Unit price" : "Amount"}
                />
              </div>
            </div>

            {/* Line total preview (only when qty > 1) */}
            {qtyNum > 1 && unitPriceVal > 0 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-right">
                Line total: <strong className="text-slate-700 dark:text-slate-200">₦{fmtMoney(lineTotal)}</strong>
              </p>
            )}

            {/* Add item button */}
            <button
              onClick={addLineItem}
              disabled={!canAddItem}
              className="w-full h-11 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 text-white flex items-center justify-center gap-2"
              style={{ background: canAddItem ? typeColor : undefined }}>
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}>
                <path d="M12 5v14M5 12h14"/>
              </svg>
              {lineItems.length === 0 ? "Add item" : "Add to cart"}
            </button>
          </div>

          {/* Error / success banners */}
          {saveError && (
            <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">{saveError}</p>
            </div>
          )}
          {saveSuccess && (
            <div className="mb-3 px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-800/40 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M20 6L9 17l-5-5" className="text-green-600 dark:text-green-400"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-green-700 dark:text-green-400">Saved</p>
                <p className="text-xs text-green-600 dark:text-green-500">
                  ₦{cartTotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  {type === "in" ? " recorded as income" : " recorded as expense"}
                </p>
              </div>
            </div>
          )}

          {/* ── Details accordion ── */}
          <div className="mb-4">
            <button
              onClick={() => setShowDetails(v => !v)}
              className="w-full flex items-center justify-between py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <span>{showDetails ? "Hide details ↑" : "Add details ↓"}</span>
              {!showDetails && (customerName || note || category !== (type === "in" ? "sale" : "expense")) && (
                <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                  edited
                </span>
              )}
            </button>

            {showDetails && (
              <div className="pt-1 space-y-4">

                {/* Category chips */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Category</label>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                    {cats.map(c => (
                      <button key={c} onClick={() => setCategory(c)}
                        className={`flex-shrink-0 px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors capitalize whitespace-nowrap ${
                          category === c ? "text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                        }`}
                        style={category === c ? { background: "var(--brand-green)" } : undefined}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment method chips */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Payment Method</label>
                  <div className="flex gap-2 flex-wrap">
                    {PAYMENT_TYPES.map(pm => (
                      <button key={pm.id} onClick={() => setPaymentType(pm.id)}
                        className={`px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors ${
                          paymentType === pm.id ? "text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                        }`}
                        style={paymentType === pm.id ? { background: "var(--brand-green)" } : undefined}>
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                    Customer {category === "credit sale" && <span className="text-red-400">*</span>}
                    {category !== "credit sale" && <span className="normal-case font-medium">(optional)</span>}
                  </label>
                  <input
                    type="text"
                    placeholder={category === "credit sale" ? "Customer name" : "Customer name (optional)"}
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    onFocus={scrollIntoViewDelayed}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  />
                </div>

                {/* Credit: due date chips */}
                {category === "credit sale" && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Due Date</label>
                    <div className="flex gap-2">
                      {DUE_CHIPS.map(d => (
                        <button key={d.id} onClick={() => setDueLabel(prev => prev === d.id ? null : d.id)}
                          className={`flex-shrink-0 px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors ${
                            dueLabel === d.id ? "text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                          }`}
                          style={dueLabel === d.id ? { background: "var(--navy)" } : undefined}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                    {dueLabel === "custom" && (
                      <input
                        type="date" value={customDue} onChange={e => setCustomDue(e.target.value)}
                        className="mt-2 w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                      />
                    )}
                  </div>
                )}

                {/* Note */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                    Note <span className="normal-case font-medium">(optional)</span>
                  </label>
                  <textarea
                    placeholder="Any extra notes…"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    onFocus={scrollIntoViewDelayed}
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30 resize-none"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Date</label>
                  <input
                    type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky save button */}
        <div className="flex-shrink-0 px-5 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!canSave || saving || saveSuccess}
            className="w-full h-12 rounded-xl text-white font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: typeColor }}>
            {saving && (
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {saveSuccess
              ? "Saved ✓"
              : canSave
              ? `Save ${type === "in" ? "Sale" : "Expense"}${cartTotal > 0 ? ` · ₦${fmtMoney(cartTotal)}` : ""}`
              : "Add at least one item"}
          </button>
        </div>
      </div>

      {/* Discard confirm */}
      {showDiscardConfirm && (
        <div
          className="fixed inset-0 flex items-end"
          style={{ zIndex: "var(--z-sub-sheet)" }}
          onClick={() => setShowDiscardConfirm(false)}>
          <div
            className="w-full bg-white dark:bg-slate-900 rounded-t-2xl p-6 shadow-2xl"
            style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-base font-bold text-slate-900 dark:text-white">Discard transaction?</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Your items and details will be lost.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm active:scale-95 transition">
                Keep editing
              </button>
              <button
                onClick={() => { setShowDiscardConfirm(false); animClose(onClose); }}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white font-semibold text-sm active:scale-95 transition">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AddTxnModal;
