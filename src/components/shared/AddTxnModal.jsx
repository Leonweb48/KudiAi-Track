import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { today } from "../../utils/helpers";
import { speakEvent } from "../../utils/tts";
import { getLang, speakConfirmation } from "../../utils/i18n";

/* ── Fuzzy near-match: catches typos / plurals the autocomplete misses ── */
function fuzzyMatch(query, target) {
  const a = query.toLowerCase().replace(/\s+/g, " ").trim();
  const b = target.toLowerCase().replace(/\s+/g, " ").trim();
  if (a === b || a.length < 3) return false; // exact → autocomplete; too short → skip
  if (b.includes(a) || a.includes(b)) return true;
  const min = Math.min(a.length, b.length);
  return min >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

/* ── Category sets per direction ─────────────────────────────────── */
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

/* ── Format raw digit string for the hero display ────────────────── */
function fmtHero(str) {
  if (!str || str === ".") return "0";
  const [intPart, decPart] = str.split(".");
  const n = parseInt(intPart || "0") || 0;
  const formatted = n.toLocaleString("en-NG");
  return decPart !== undefined ? formatted + "." + decPart : formatted;
}

function calcDueDate(label, customDate) {
  if (label === "custom") return customDate || null;
  const d = new Date();
  if (label === "tomorrow") d.setDate(d.getDate() + 1);
  else if (label === "1week") d.setDate(d.getDate() + 7);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

/* ── Backspace icon ──────────────────────────────────────────────── */
function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/>
      <line x1="18" y1="9" x2="13" y2="14"/>
      <line x1="13" y1="9" x2="18" y2="14"/>
    </svg>
  );
}

/* ── Big numpad ──────────────────────────────────────────────────── */
function BigNumpad({ onKey }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[1,2,3,4,5,6,7,8,9].map(n => (
        <button
          key={n}
          onPointerDown={e => { e.preventDefault(); onKey(String(n)); }}
          className="flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 font-bold text-xl active:scale-95 active:bg-slate-100 dark:active:bg-slate-700 transition-transform select-none touch-manipulation"
          style={{ minHeight: 50 }}>
          {n}
        </button>
      ))}
      <button
        onPointerDown={e => { e.preventDefault(); onKey("."); }}
        className="flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 font-bold text-xl active:scale-95 active:bg-slate-100 dark:active:bg-slate-700 transition-transform select-none touch-manipulation"
        style={{ minHeight: 64 }}>
        .
      </button>
      <button
        onPointerDown={e => { e.preventDefault(); onKey("0"); }}
        className="flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 font-bold text-xl active:scale-95 active:bg-slate-100 dark:active:bg-slate-700 transition-transform select-none touch-manipulation"
        style={{ minHeight: 64 }}>
        0
      </button>
      <button
        onPointerDown={e => { e.preventDefault(); onKey("backspace"); }}
        className="flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 active:scale-95 active:bg-slate-100 dark:active:bg-slate-700 transition-transform select-none touch-manipulation"
        style={{ minHeight: 64 }}>
        <BackspaceIcon />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AddTxnModal — bottom sheet rebuild (Gate 3)
   Props interface frozen: onAdd, onClose, defaultType, defaultCategory, inventory
   ══════════════════════════════════════════════════════════════════ */
export function AddTxnModal({
  onAdd,
  onClose,
  defaultType     = "in",
  defaultCategory = "sale",
  inventory       = null,
}) {
  /* ── Amount (numpad-driven) ── */
  const [amtStr,  setAmtStr]  = useState("");

  /* ── Form fields ── */
  const [type,         setType]         = useState(defaultType);
  const [category,     setCategory]     = useState(defaultCategory);
  const [itemName,     setItemName]     = useState("");
  const [unitPrice,    setUnitPrice]    = useState("");
  const [qty,          setQty]          = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [paymentType,  setPaymentType]  = useState("cash");
  const [note,         setNote]         = useState("");
  const [txDate,       setTxDate]       = useState(today());
  const [dueLabel,     setDueLabel]     = useState(null);
  const [customDue,    setCustomDue]    = useState("");
  const [showSugs,              setShowSugs]              = useState(false);
  const [fuzzySugDismissed,     setFuzzySugDismissed]     = useState(false);

  /* ── UI state ── */
  const [showDetails,       setShowDetails]       = useState(() => {
    try { return sessionStorage.getItem("kt_add_details_open") === "1"; } catch { return false; }
  });
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [saveError,          setSaveError]          = useState("");
  const [saveSuccess,        setSaveSuccess]        = useState(false);

  /* ── Keyboard-aware sizing (Android/Capacitor) ── */
  const [vvHeight, setVvHeight] = useState(null);

  /* ── Sheet animation ── */
  const [sheetY,  setSheetY]  = useState("100%");   // "0px" when open
  const [sheetTx, setSheetTx] = useState("transform 0.3s cubic-bezier(0.34,1.56,0.64,1)");
  const sheetRef    = useRef(null);
  const detailsRef  = useRef(null);
  const dragRef     = useRef({ startY: 0, curDy: 0, active: false });
  const isDirtyRef  = useRef(false);

  /* Entry animation */
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetY("0px")));
  }, []);

  /* Persist details-open to session */
  useEffect(() => {
    try { sessionStorage.setItem("kt_add_details_open", showDetails ? "1" : "0"); } catch {}
  }, [showDetails]);

  /* Keyboard-aware sizing: shrink sheet above the software keyboard */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !showDetails) { setVvHeight(null); return; }
    const update = () => setVvHeight(vv.height);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, [showDetails]);

  /* Scroll focused input into view after keyboard animation */
  const scrollIntoViewDelayed = (e) => {
    const el = e.target;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 320);
  };

  /* Reset category when type changes if current cat doesn't fit */
  useEffect(() => {
    const valid = type === "in" ? CATS_IN : CATS_OUT;
    if (!valid.includes(category)) setCategory(type === "in" ? "sale" : "expense");
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Derived values */
  const products  = inventory?.products || [];
  const amtValue  = parseFloat(amtStr)  || 0;
  const qtyNum    = parseInt(qty)        || 1;
  const canSave   = amtValue > 0;

  const matchedProduct = itemName
    ? products.find(p => p.product_name.toLowerCase().trim() === itemName.toLowerCase().trim())
    : null;
  const suggestions = itemName && itemName.length >= 1 && !matchedProduct && showSugs
    ? products.filter(p => p.product_name.toLowerCase().includes(itemName.toLowerCase().trim())).slice(0, 5)
    : [];
  // Fuzzy suggestion: fires only when no autocomplete match, only for sales
  const fuzzySuggestion = (!itemName || matchedProduct || suggestions.length > 0 || fuzzySugDismissed || type !== "in")
    ? null
    : (products.find(p => fuzzyMatch(itemName, p.product_name)) || null);

  const stockAfter = matchedProduct && type === "in" ? matchedProduct.quantity - qtyNum : null;
  const overStock  = type === "in" && matchedProduct && qtyNum > matchedProduct.quantity;
  const isDirty    = amtStr !== "" || itemName !== "" || customerName !== "" || note !== "";

  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { setFuzzySugDismissed(false); }, [itemName]);

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

  /* ── Drag-to-dismiss on handle + header ── */
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
          } else {
            onClose();
          }
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

  /* ── Numpad handler ── */
  const handleNumKey = (key) => {
    setAmtStr(prev => {
      if (key === "backspace") return prev.slice(0, -1);
      if (key === ".") return prev.includes(".") ? prev : prev + ".";
      const [intPart, decPart] = prev.split(".");
      if (decPart !== undefined && decPart.length >= 2) return prev;
      if (prev === "" && key === "0") return prev;
      if ((intPart || "").length >= 10) return prev;
      return prev + key;
    });
    setSaveError("");
  };

  /* ── Qty stepper recalculates amount when unit price is known (set by autocomplete) ── */
  const handleQty = (v) => {
    setQty(v);
    const u = parseFloat(unitPrice), q = parseInt(v) || 1;
    if (u > 0) {
      const t = u * q;
      setAmtStr(Number.isInteger(t) ? String(t) : t.toFixed(2));
    }
  };

  /* ── Autocomplete suggestion pick ── */
  const selectSuggestion = (p) => {
    const q = qtyNum;
    setItemName(p.product_name);
    setUnitPrice(String(p.selling_price || ""));
    if (p.selling_price) {
      const t = p.selling_price * q;
      setAmtStr(Number.isInteger(t) ? String(t) : t.toFixed(2));
    }
    setShowSugs(false);
  };

  /* ── Build the frozen payload ── */
  const buildPayload = () => {
    const q      = qtyNum;
    const uPrice = parseFloat(unitPrice) || (amtValue / q);
    const duePart = dueLabel ? `Due: ${calcDueDate(dueLabel, customDue) || ""}` : "";
    const finalNote = [note.trim(), duePart].filter(Boolean).join(" · ");
    return {
      type,
      category,
      amount:           amtValue,
      unit_price:       uPrice,
      item_name:        itemName,
      quantity:         q,
      customer_name:    customerName,
      payment_type:     paymentType,
      note:             finalNote,
      transaction_date: txDate,
    };
  };

  /* PIN security boundary: recording income/expense entries requires NO PIN.
     PIN stays mandatory on: disbursements, Ajo withdrawals, payout execution,
     reversals, transaction deletion, credit voiding, archive actions, and
     bank-detail changes. Recording an entry is additive, not destructive. */
  const handleSubmit = () => {
    if (!canSave || saving || saveSuccess || overStock) return;
    const payload = buildPayload();
    setSaving(true);
    setSaveError("");

    /* Fire-and-forget (errors handled at store level via dbError state) */
    try {
      onAdd(payload);
      if (Capacitor.isNativePlatform()) {
        speakEvent(type === "in" ? "cashIn" : "cashOut", getLang(), { amount: amtValue }).catch(() => {});
      } else {
        speakConfirmation(type === "in" ? "cashIn" : "cashOut", getLang());
      }
      if (matchedProduct && type === "in" && inventory?.recordMovement) {
        inventory.recordMovement({
          product_id: matchedProduct.id,
          type:       "sale",
          quantity:   qtyNum,
          unit_price: parseFloat(unitPrice) || (amtValue / qtyNum),
          notes:      customerName ? `Sale to ${customerName}` : "Auto-synced from transaction",
        });
      }
      // Auto-create stub for unrecognised item names — fire-and-forget, never blocks the save
      if (type === "in" && itemName.trim() && !matchedProduct && inventory?.createAutoStub) {
        inventory.createAutoStub(itemName.trim(), parseFloat(unitPrice) || (amtValue / qtyNum), qtyNum);
      }
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => animClose(onClose), 1100);
    } catch (err) {
      setSaving(false);
      setSaveError(err?.message || "Something went wrong. Try again.");
    }
  };

  /* ── Hero font size — shrinks as digits grow ── */
  const heroFontSize = amtStr.length > 9 ? "1.75rem"
    : amtStr.length > 6 ? "2.25rem"
    : amtStr.length > 4 ? "2.75rem"
    : "3rem";

  const cats = type === "in" ? CATS_IN : CATS_OUT;

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <>
      {/* ── Scrim ── */}
      <div
        className="fixed inset-0"
        style={{ zIndex: "var(--z-sheet)", background: "rgba(0,0,0,0.55)" }}
        onClick={tryClose}
      />

      {/* ── Bottom sheet ── */}
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
          transform:     `translateY(${sheetY})`,
          transition:    sheetTx,
        }}>

        {/* ── Drag handle + close row (drag-handle zone) ── */}
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

        {/* ── Body: numpad view ↔ details view ── */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* ─── Numpad view (hidden when details open) ─────────── */}
          {!showDetails && (
            <>
              <div className="flex-shrink-0 px-5">
                {/* Type toggle */}
                <div className="flex gap-2 mb-3">
                  {[
                    { id: "in",  label: "Money In",  activeStyle: { background: "var(--brand-green)" }, activeCls: "text-white" },
                    { id: "out", label: "Money Out",  activeStyle: { background: "var(--navy)"        }, activeCls: "text-white" },
                  ].map(btn => (
                    <button key={btn.id} onClick={() => setType(btn.id)}
                      className={`flex-1 min-h-[44px] py-3 rounded-xl font-bold text-sm transition-colors ${
                        type === btn.id ? btn.activeCls : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                      style={type === btn.id ? btn.activeStyle : undefined}>
                      {btn.label}
                    </button>
                  ))}
                </div>

                {/* Amount hero */}
                <div className="text-center mb-3 py-1">
                  <div className={`flex items-baseline justify-center gap-1 ${
                    type === "in"
                      ? "text-green-600 dark:text-green-400"
                      : "text-navy dark:text-blue-300"
                  }`}>
                    <span className="text-2xl font-bold leading-none">₦</span>
                    <span
                      className="font-extrabold leading-none tracking-tight"
                      style={{ fontSize: heroFontSize, fontVariantNumeric: "tabular-nums" }}>
                      {fmtHero(amtStr)}
                    </span>
                  </div>
                  {(parseInt(amtStr) || 0) > 999_999_999 && (
                    <p className="text-[10px] text-slate-400 mt-1">Max amount</p>
                  )}
                </div>
              </div>

              {/* Numpad */}
              <div className="flex-shrink-0 px-4 mb-3">
                <BigNumpad onKey={handleNumKey} />
              </div>
            </>
          )}

          {/* ─── Compact amount bar (shown when details open) ────── */}
          {showDetails && (
            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span
                  className="text-[10px] font-black px-2 py-1 rounded-md text-white leading-none"
                  style={{ background: type === "in" ? "var(--brand-green)" : "var(--navy)" }}>
                  {type === "in" ? "IN" : "OUT"}
                </span>
                <span
                  className={`text-xl font-extrabold leading-none tracking-tight ${
                    type === "in" ? "text-green-600 dark:text-green-400" : "text-navy dark:text-blue-300"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  ₦{fmtHero(amtStr)}
                </span>
              </div>
              <button
                onClick={() => setShowDetails(false)}
                className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 active:scale-95 transition-transform">
                ← Edit
              </button>
            </div>
          )}

          {/* Error/success banners */}
          {(saveError || saveSuccess) && (
            <div className="flex-shrink-0">
              {saveError && (
                <div className="mx-5 mb-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400">{saveError}</p>
                </div>
              )}
              {saveSuccess && (
                <div className="mx-5 mb-2 px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-800/40 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor"
                      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" className="text-green-600 dark:text-green-400"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-green-700 dark:text-green-400">Saved</p>
                    <p className="text-xs text-green-600 dark:text-green-500">
                      ₦{amtValue.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      {type === "in" ? " recorded as income" : " recorded as expense"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 1 CTAs ─────────────────────────────────────── */}
          <div className="flex-shrink-0 px-5 pb-3 flex gap-2">
            <button
              onClick={() => setShowDetails(v => !v)}
              className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 active:scale-95 transition-transform">
              {showDetails ? "Hide details ↑" : "Add details ↓"}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSave || saving || saveSuccess || overStock}
              className="flex-1 h-11 rounded-xl text-white font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--brand-green)" }}>
              {saving && (
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              )}
              {saveSuccess ? "Saved ✓" : "Save"}
            </button>
          </div>

          {/* ─── Details panel (full height when open, keyboard-aware) */}
          {showDetails && (
            <div ref={detailsRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-5 pt-4">

              {/* Description + autocomplete */}
              <div className="relative mb-4">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Item or description"
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
                          <p className="text-xs font-bold text-green-600">
                            ₦{(p.selling_price || 0).toLocaleString()}
                          </p>
                          <p className={`text-[10px] font-bold ${p.quantity <= (p.low_stock_threshold || 0) ? "text-amber-500" : "text-slate-400"}`}>
                            {p.quantity} in stock
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fuzzy near-match chip — suggests linking to an existing product */}
              {fuzzySuggestion && (
                <div className="flex items-center gap-2 mb-4 px-3.5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <span className="text-xs text-amber-700 dark:text-amber-300 flex-1 leading-snug">
                    Did you mean <strong>{fuzzySuggestion.product_name}</strong>?
                  </span>
                  <button
                    onPointerDown={e => { e.preventDefault(); selectSuggestion(fuzzySuggestion); }}
                    className="text-xs font-bold text-amber-700 dark:text-amber-300 underline active:opacity-70 flex-shrink-0 px-1">
                    Link
                  </button>
                  <button
                    onPointerDown={e => { e.preventDefault(); setFuzzySugDismissed(true); }}
                    className="text-[11px] text-amber-500 dark:text-amber-400 active:opacity-70 flex-shrink-0 px-1">
                    Ignore
                  </button>
                </div>
              )}

              {/* Stock badge */}
              {matchedProduct && (
                <div className={`rounded-xl px-3.5 py-2.5 mb-4 flex items-center justify-between text-xs font-bold ${
                  overStock
                    ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                    : stockAfter !== null && stockAfter <= (matchedProduct.low_stock_threshold || 0)
                    ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                    : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                }`}>
                  <span className={overStock ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}>
                    📦 {matchedProduct.product_name}
                  </span>
                  <span className={
                    overStock ? "text-red-600 dark:text-red-400"
                    : stockAfter !== null && stockAfter <= (matchedProduct.low_stock_threshold || 0) ? "text-amber-600 dark:text-amber-400"
                    : "text-green-600 dark:text-green-400"
                  }>
                    {type === "in"
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

              {/* Category chips */}
              <div className="mb-4">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                  Category
                </label>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                  {cats.map(c => (
                    <button key={c} onClick={() => setCategory(c)}
                      className={`flex-shrink-0 px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors capitalize whitespace-nowrap ${
                        category === c
                          ? "text-white"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      }`}
                      style={category === c ? { background: "var(--brand-green)" } : undefined}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment method chips */}
              <div className="mb-4">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                  Payment Method
                </label>
                <div className="flex gap-2 flex-wrap">
                  {PAYMENT_TYPES.map(pm => (
                    <button key={pm.id} onClick={() => setPaymentType(pm.id)}
                      className={`px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors ${
                        paymentType === pm.id
                          ? "text-white"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      }`}
                      style={paymentType === pm.id ? { background: "var(--brand-green)" } : undefined}>
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer field (always visible, required indicator for credit) */}
              <div className="mb-4">
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

              {/* Credit path: due date chips */}
              {category === "credit sale" && (
                <div className="mb-4">
                  <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                    Due Date
                  </label>
                  <div className="flex gap-2">
                    {DUE_CHIPS.map(d => (
                      <button key={d.id} onClick={() => setDueLabel(prev => prev === d.id ? null : d.id)}
                        className={`flex-shrink-0 px-3.5 min-h-[36px] rounded-full text-xs font-bold transition-colors ${
                          dueLabel === d.id
                            ? "text-white"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                        }`}
                        style={dueLabel === d.id ? { background: "var(--navy)" } : undefined}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {dueLabel === "custom" && (
                    <input
                      type="date"
                      value={customDue}
                      onChange={e => setCustomDue(e.target.value)}
                      className="mt-2 w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                    />
                  )}
                </div>
              )}

              {/* Quantity stepper */}
              <div className="mb-4">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                  Quantity
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleQty(String(Math.max(1, qtyNum - 1)))}
                    className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0">
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={qty}
                    onChange={e => handleQty(e.target.value)}
                    onFocus={scrollIntoViewDelayed}
                    className="flex-1 h-11 text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  />
                  <button
                    onClick={() => handleQty(String(qtyNum + 1))}
                    className="w-11 h-11 rounded-xl text-white font-bold text-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
                    style={{ background: "var(--brand-green)" }}>
                    +
                  </button>
                </div>
                {qtyNum > 1 && amtValue > 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
                    ₦{(amtValue / qtyNum).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per unit
                  </p>
                )}
              </div>

              {/* Note */}
              <div className="mb-4">
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
              <div className="mb-5">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={txDate}
                  onChange={e => setTxDate(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                />
              </div>

              {/* Repeat Save CTA at bottom of details — reachability when keyboard is open */}
              <button
                onClick={handleSubmit}
                disabled={!canSave || saving || saveSuccess || overStock}
                className="w-full h-12 rounded-xl text-white font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2 mb-5"
                style={{ background: "var(--brand-green)" }}>
                {saving && (
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                )}
                {saveSuccess ? "Saved ✓" : "Save Transaction"}
              </button>
            </div>
          )}

          {!showDetails && <div className="h-3" />}
        </div>
      </div>

      {/* ── Discard confirm — --z-sub-sheet: 70 ── */}
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
              Your typed amount and details will be lost.
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
