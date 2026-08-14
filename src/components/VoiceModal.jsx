import { useState } from "react";
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

function ParsedCard({ parsed }) {
  const isIn   = parsed.type === "in";
  const catCls = CATEGORY_COLORS[parsed.category] || CATEGORY_COLORS.other;
  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isIn ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
          {isIn ? "Cash In" : "Cash Out"}
        </span>
        <AmountDisplay amount={parsed.amount || 0} size="stat" align="left" colorBy={isIn ? 'in' : 'out'} />
      </div>
      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
        {parsed.item_name || "—"}
        {parsed.quantity > 1 && (
          <span className="text-slate-400 dark:text-slate-500 font-normal"> × {parsed.quantity}</span>
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

  const [matchedProduct, setMatchedProduct] = useState(null);
  const [matchDismissed, setMatchDismissed] = useState(false);

  const matches = status === "done" && parsed && !matchDismissed
    ? getTopMatches(parsed.item_name, products)
    : [];

  const handleSave = () => {
    if (!parsed) return;
    const qty = parseInt(parsed.quantity) || 1;
    if (matchedProduct && inventory?.recordMovement) {
      inventory.recordMovement({
        product_id: matchedProduct.id,
        type:       "sale",
        quantity:   qty,
        unit_price: parseFloat(parsed.amount) / qty || 0,
        notes:      parsed.customer_name ? `Sale to ${parsed.customer_name}` : "Auto-synced from voice transaction",
      });
    }
    onSave({
      ...parsed,
      amount:       parseFloat(parsed.amount) || 0,
      quantity:     qty,
      transaction_date: today(),
      ...(matchedProduct ? { linked_product_id: matchedProduct.id, product_name: matchedProduct.product_name } : {}),
    });
    onClose();
  };

  const isParsing = status === "parsing";
  const isBusy    = isRecording || isParsing;

  const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

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
          {/* Mic button with pulse rings */}
          <div className="relative mb-5">
            {isRecording && (
              <>
                <div className="absolute inset-0 rounded-full bg-red-400/20 animate-ping scale-150" />
                <div className="absolute inset-0 rounded-full bg-red-400/10 animate-ping scale-[2] animation-delay-150" />
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
                <span className="w-7 h-7 border-[3px] border-slate-400 border-t-transparent rounded-full spinner" />
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

          {/* Status / hint text */}
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
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Tap the mic to start</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic max-w-[230px] leading-relaxed">
                {EXAMPLES[lang] || EXAMPLES.en}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4" role="alert">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
          <button onClick={reset} className="mt-2 text-xs text-red-500 dark:text-red-400 underline font-medium">
            Try again
          </button>
        </div>
      )}

      {/* Parsed result */}
      {status === "done" && parsed && (
        <>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide mb-1.5">
            Parsed Transaction
          </p>
          <ParsedCard parsed={parsed} />

          {/* Product match suggestions */}
          {matches.length > 0 && (
            <div className="mt-3 mb-1 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3">
              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">
                Match catalogue product?
              </p>
              <div className="space-y-1.5">
                {matches.map(p => (
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
                      {p.quantity ?? 0} in stock
                    </span>
                  </button>
                ))}
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
            <p className="text-[11px] text-brand-600 dark:text-brand-400 mt-1 mb-1 text-center font-medium">
              Stock will be deducted from "{matchedProduct.product_name}"
            </p>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 mb-4 text-center">
            Review the details above before saving
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={reset}
              className="py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Record Again
            </button>
            <button
              onClick={handleSave}
              className="py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-colors shadow-card-md"
            >
              Save Transaction
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
