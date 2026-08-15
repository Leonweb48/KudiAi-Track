import { useState, useEffect } from "react";
import { useVoiceTx } from "../hooks/useVoiceTx";
import { today } from "../utils/helpers";
import { AmountDisplay } from "./shared/AmountDisplay";
import Modal from "./shared/Modal";

const MAX_SECS = 60;

const LANGUAGES = [
  { code: "en",     label: "EN",  name: "English" },
  { code: "pidgin", label: "PID", name: "Pidgin"  },
  { code: "ha",     label: "HA",  name: "Hausa"   },
  { code: "ig",     label: "IG",  name: "Igbo"    },
  { code: "yo",     label: "YO",  name: "Yoruba"  },
];

const EXAMPLES = {
  en:     '"I sold 3 Ankara fabric for ₦4,500 cash"',
  pidgin: '"I sell am 3 Ankara for 4500 naira"',
  ha:     '"Na sayar da atamfa 3 naira 4500"',
  ig:     '"Aresụ Ankara atọ maka naira 4500"',
  yo:     '"Mo ta aso Ankara mẹta fún ₦4500"',
};

const CATEGORY_COLORS = {
  sale:             "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300",
  expense:          "bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-300",
  stock:            "bg-blue-100   dark:bg-blue-900/30   text-blue-700   dark:text-blue-300",
  "credit sale":    "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-300",
  "debt repayment": "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
  other:            "bg-slate-100  dark:bg-slate-800     text-slate-600  dark:text-slate-300",
};

function fuzzyMatch(query, target) {
  const a = (query  || "").toLowerCase().replace(/\s+/g, " ").trim();
  const b = (target || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!a || a.length < 3) return false;
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true;
  const min = Math.min(a.length, b.length);
  return min >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

function getTopMatches(itemName, products, max = 3) {
  if (!itemName || !products?.length) return [];
  return products
    .filter(p => fuzzyMatch(itemName, p.product_name))
    .slice(0, max);
}

function ParsedCard({ parsed, overrideAmount, overrideQty }) {
  const isIn     = parsed.type === "in";
  const catCls   = CATEGORY_COLORS[parsed.category] || CATEGORY_COLORS.other;
  const amount   = overrideAmount ?? parsed.amount ?? 0;
  const quantity = overrideQty   ?? parsed.quantity ?? 1;
  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isIn ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
          {isIn ? "Cash In" : "Cash Out"}
        </span>
        <AmountDisplay amount={amount} size="stat" align="left" colorBy={isIn ? "in" : "out"} />
      </div>
      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
        {parsed.item_name || "—"}
        {quantity > 1 && (
          <span className="text-slate-400 dark:text-slate-500 font-normal"> × {quantity}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${catCls}`}>{parsed.category}</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{parsed.payment_type}</span>
        {parsed.customer_name && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300">{parsed.customer_name}</span>
        )}
      </div>
      {parsed.note && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">"{parsed.note}"</p>
      )}
    </div>
  );
}

export default function VoiceModal({ onClose, onSave, products = [], inventory = null }) {
  const {
    isRecording, status, parsed, error,
    lang, setLang, startRecording, stopAndProcess, reset,
    recordingSeconds,
  } = useVoiceTx();

  // Accumulated confirmed items (multi-item sale)
  const [voiceItems,     setVoiceItems]     = useState([]);
  const [matchedProduct, setMatchedProduct] = useState(null);
  const [matchDismissed, setMatchDismissed] = useState(false);

  // User-adjustable quantity for the current parsed item.
  // Seeded from the AI-parsed quantity each time a new result arrives.
  const [localQty, setLocalQty] = useState(1);
  useEffect(() => {
    if (parsed) setLocalQty(parseInt(parsed.quantity) || 1);
  }, [parsed]);

  // When a matched catalogue product is selected, its selling_price × localQty
  // overrides the voice-parsed amount so the user sees the actual catalogue total.
  const sellingPrice  = matchedProduct
    ? (matchedProduct.selling_price || matchedProduct.unit_price || 0)
    : 0;
  const effectiveAmount = matchedProduct && sellingPrice > 0
    ? sellingPrice * localQty
    : (parseFloat(parsed?.amount) || 0);
  const effectiveQty    = localQty;

  const matches = status === "done" && parsed && !matchDismissed
    ? getTopMatches(parsed.item_name, products)
    : [];

  const totalSoFar = voiceItems.reduce((s, i) => s + i.amount, 0);
  const hasItems   = voiceItems.length > 0;

  const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const handleReset = () => {
    reset();
    setMatchedProduct(null);
    setMatchDismissed(false);
    setLocalQty(1);
  };

  const deductStock = (product, qty, amount, customerName) => {
    if (!product || !inventory?.recordMovement) return;
    inventory.recordMovement({
      product_id: product.id,
      type:       "sale",
      quantity:   qty,
      unit_price: qty > 0 ? amount / qty : 0,
      notes:      customerName ? `Sale to ${customerName}` : "Auto-synced from voice transaction",
    });
  };

  // Exact name for the transaction: catalogue name beats AI-parsed name so
  // profitEngine's productByName lookup succeeds and COGS is computed.
  const resolvedName = () =>
    matchedProduct ? matchedProduct.product_name : (parsed?.item_name || "");

  // ── Save paths ────────────────────────────────────────────────────────────

  const handleAddToList = () => {
    if (!parsed) return;
    const name = resolvedName();
    deductStock(matchedProduct, effectiveQty, effectiveAmount, parsed.customer_name);
    setVoiceItems(prev => [...prev, {
      item_name:      name,
      amount:         effectiveAmount,
      quantity:       effectiveQty,
      category:       parsed.category,
      payment_type:   parsed.payment_type,
      customer_name:  parsed.customer_name || "",
      note:           parsed.note || "",
      matchedProduct: matchedProduct || null,
    }]);
    setMatchedProduct(null);
    setMatchDismissed(false);
    setLocalQty(1);
    reset();
  };

  const handleSaveSingle = () => {
    if (!parsed) return;
    const name = resolvedName();
    deductStock(matchedProduct, effectiveQty, effectiveAmount, parsed.customer_name);
    onSave({
      ...parsed,
      item_name:        name,
      amount:           effectiveAmount,
      quantity:         effectiveQty,
      transaction_date: today(),
      ...(matchedProduct ? { linked_product_id: matchedProduct.id } : {}),
    });
    onClose();
  };

  const handleSaveAll = (includeCurrent = false) => {
    let items = voiceItems;

    if (includeCurrent && parsed) {
      const name = resolvedName();
      deductStock(matchedProduct, effectiveQty, effectiveAmount, parsed.customer_name);
      items = [...voiceItems, {
        item_name:      name,
        amount:         effectiveAmount,
        quantity:       effectiveQty,
        category:       parsed.category,
        payment_type:   parsed.payment_type,
        customer_name:  parsed.customer_name || "",
        note:           parsed.note || "",
        matchedProduct: matchedProduct || null,
      }];
    }

    if (items.length === 0) return;

    if (items.length === 1) {
      const item = items[0];
      onSave({
        type:             "in",
        amount:           item.amount,
        quantity:         item.quantity,
        item_name:        item.item_name,
        category:         item.category || "sale",
        payment_type:     item.payment_type || "cash",
        customer_name:    item.customer_name,
        note:             item.note,
        transaction_date: today(),
        ...(item.matchedProduct ? { linked_product_id: item.matchedProduct.id } : {}),
      });
    } else {
      const totalAmount = items.reduce((s, i) => s + i.amount, 0);
      onSave({
        type:             "in",
        amount:           totalAmount,
        item_name:        items.map(i => i.item_name).join(", "),
        category:         "sale",
        payment_type:     items[0]?.payment_type || "cash",
        customer_name:    items.find(i => i.customer_name)?.customer_name || "",
        note:             items.find(i => i.note)?.note || "",
        transaction_date: today(),
        line_items:       items.map(i => ({
          name:      i.item_name,
          qty:       i.quantity,
          unitPrice: i.quantity > 0 ? i.amount / i.quantity : i.amount,
          lineTotal: i.amount,
          productId: i.matchedProduct?.id || null,
        })),
      });
    }
    onClose();
  };

  const isParsing = status === "parsing";
  const isBusy    = isRecording || isParsing;

  return (
    <Modal title="Voice Transaction" onClose={onClose}>

      {/* Language selector */}
      <div className="flex gap-2 mb-6 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl" role="group" aria-label="Select language">
        {LANGUAGES.map(l => (
          <button
            key={l.code}
            onClick={() => !isBusy && setLang(l.code)}
            disabled={isBusy}
            aria-pressed={lang === l.code}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              lang === l.code
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            <span className="block">{l.label}</span>
            <span className="block text-[9px] font-normal opacity-60 mt-0.5">{l.name}</span>
          </button>
        ))}
      </div>

      {/* Recording / idle / parsing view */}
      {(status === "idle" || status === "recording" || isParsing) && (
        <div className="flex flex-col items-center">

          {/* Accumulated items so far — shown idle between recordings */}
          {hasItems && status === "idle" && (
            <div className="w-full mb-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                Items added ({voiceItems.length})
              </p>
              {voiceItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1">
                    {item.item_name}
                    {item.quantity > 1 && <span className="text-slate-400"> ×{item.quantity}</span>}
                  </span>
                  <span className="text-sm font-semibold text-green-600 dark:text-green-400 ml-2">
                    ₦{item.amount.toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-sm mt-2 pt-1.5 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-600 dark:text-slate-400">Total</span>
                <span className="text-green-600 dark:text-green-400">₦{totalSoFar.toLocaleString()}</span>
              </div>
              <button
                onClick={() => handleSaveAll(false)}
                className="w-full mt-3 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-colors"
              >
                Save {voiceItems.length} {voiceItems.length === 1 ? "item" : "items"} · ₦{totalSoFar.toLocaleString()}
              </button>
            </div>
          )}

          {/* Mic button */}
          <div className="relative mb-5">
            {isRecording && (
              <>
                <div className="absolute inset-0 rounded-full bg-red-400/20 animate-ping scale-150" />
                <div className="absolute inset-0 rounded-full bg-red-400/10 animate-ping scale-[2] opacity-75" />
              </>
            )}
            <button
              onClick={isRecording ? stopAndProcess : startRecording}
              disabled={isParsing}
              aria-label={isRecording ? "Stop and process" : "Start recording"}
              className={`relative w-24 h-24 rounded-full flex items-center justify-center shadow-card-lg transition-all active:scale-95 ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600"
                  : isParsing
                  ? "bg-slate-200 dark:bg-slate-700 cursor-not-allowed"
                  : "bg-brand-600 hover:bg-brand-700"
              }`}
            >
              {isParsing ? (
                <span className="w-7 h-7 border-[3px] border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : isRecording ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-white" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          </div>

          {isParsing && (
            <div className="text-center">
              <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">Analyzing with Gemini AI…</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Extracting your transaction details</p>
            </div>
          )}
          {isRecording && (
            <div className="text-center">
              <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm tabular-nums">
                {fmtSecs(recordingSeconds)}
                {recordingSeconds >= 50 && (
                  <span className="ml-2 text-amber-500 text-xs font-normal">max {MAX_SECS}s</span>
                )}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Speak your transaction, then tap stop</p>
            </div>
          )}
          {status === "idle" && (
            <div className="text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                {hasItems ? "Tap mic to record the next item" : "Tap the mic to start"}
              </p>
              {!hasItems && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic max-w-[230px] leading-relaxed">
                  {EXAMPLES[lang] || EXAMPLES.en}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4" role="alert">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
          <button onClick={handleReset} className="mt-2 text-xs text-red-500 dark:text-red-400 underline font-medium">
            Try again
          </button>
        </div>
      )}

      {/* Parsed result */}
      {status === "done" && parsed && (
        <>
          {/* Accumulated items summary */}
          {hasItems && (
            <div className="mb-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                Items added ({voiceItems.length})
              </p>
              {voiceItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-0.5">
                  <span className="text-sm text-slate-600 dark:text-slate-400 truncate flex-1">
                    {item.item_name}
                    {item.quantity > 1 && <span className="text-slate-400"> ×{item.quantity}</span>}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400 ml-2">
                    ₦{item.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide mb-1.5">
            {hasItems ? "Current Item" : "Parsed Transaction"}
          </p>

          {/* ParsedCard reflects the effective amount and qty */}
          <ParsedCard
            parsed={parsed}
            overrideAmount={effectiveAmount}
            overrideQty={effectiveQty}
          />

          {/* ── Quantity stepper — always visible ── */}
          <div className="flex items-center justify-between mt-3 bg-slate-50 dark:bg-slate-900 rounded-xl px-4 py-3 border border-slate-100 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Quantity</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLocalQty(q => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-base active:scale-95 transition-transform"
              >−</button>
              <span className="w-8 text-center font-bold text-slate-800 dark:text-white tabular-nums text-sm">{localQty}</span>
              <button
                onClick={() => setLocalQty(q => q + 1)}
                className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-base active:scale-95 transition-transform"
              >+</button>
            </div>
          </div>

          {/* Catalogue price breakdown — shown when a product is matched */}
          {matchedProduct && sellingPrice > 0 && (
            <div className="flex items-center justify-between mt-1.5 px-1">
              <span className="text-xs text-slate-400 dark:text-slate-500">
                ₦{sellingPrice.toLocaleString()} each × {localQty}
              </span>
              <span className="text-sm font-bold text-green-600 dark:text-green-400">
                = ₦{effectiveAmount.toLocaleString()}
              </span>
            </div>
          )}

          {/* Product match suggestions */}
          {matches.length > 0 && (
            <div className="mt-3 mb-1 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3">
              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">
                Match catalogue product?
              </p>
              <div className="space-y-1.5">
                {matches.map(p => {
                  const price = p.selling_price || p.unit_price || 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setMatchedProduct(prev => prev?.id === p.id ? null : p)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all border ${
                        matchedProduct?.id === p.id
                          ? "bg-brand-600 border-brand-600 text-white"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400"
                      }`}
                    >
                      <span className="font-medium truncate">{p.product_name}</span>
                      <span className={`text-xs ml-2 flex-shrink-0 ${matchedProduct?.id === p.id ? "text-brand-100" : "text-slate-400 dark:text-slate-500"}`}>
                        {price > 0 ? `₦${price.toLocaleString()} · ` : ""}{p.quantity ?? 0} in stock
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { setMatchDismissed(true); setMatchedProduct(null); }}
                className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline"
              >
                No, save as-is
              </button>
            </div>
          )}

          {matchedProduct && (
            <p className="text-[11px] text-brand-600 dark:text-brand-400 mt-2 text-center font-medium">
              Stock will be deducted from "{matchedProduct.product_name}"
            </p>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 mb-3 text-center">
            Review the details above before saving
          </p>

          {/* Action buttons */}
          {hasItems ? (
            <div className="space-y-2">
              <button
                onClick={handleAddToList}
                className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Add &amp; Record Another
              </button>
              <button
                onClick={() => handleSaveAll(true)}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-colors shadow-card-md"
              >
                Save {voiceItems.length + 1} Items · ₦{(totalSoFar + effectiveAmount).toLocaleString()}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleReset}
                  className="py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Record Again
                </button>
                <button
                  onClick={handleSaveSingle}
                  className="py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-colors shadow-card-md"
                >
                  Save Transaction
                </button>
              </div>
              <button
                onClick={handleAddToList}
                className="w-full mt-2.5 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors text-center"
              >
                + Add another item to this sale
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
