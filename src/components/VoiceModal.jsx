import { useVoiceTx } from "../hooks/useVoiceTx";
import { fmt, today } from "../utils/helpers";
import Modal from "./shared/Modal";

const LANGUAGES = [
  { code: "en", label: "EN", name: "English" },
  { code: "ha", label: "HA", name: "Hausa" },
  { code: "ig", label: "IG", name: "Igbo" },
  { code: "yo", label: "YO", name: "Yoruba" },
];

const EXAMPLES = {
  en: '"I sold 3 Ankara fabric for ₦4,500 cash"',
  ha: '"Na sayar da atamfa 3 naira 4500"',
  ig: '"Aresụ Ankara atọ maka naira 4500"',
  yo: '"Mo ta aso Ankara mẹta fún ₦4500"',
};

const CATEGORY_COLORS = {
  sale:             "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300",
  expense:          "bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-300",
  stock:            "bg-blue-100   dark:bg-blue-900/30   text-blue-700   dark:text-blue-300",
  "credit sale":    "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-300",
  "debt repayment": "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
  other:            "bg-slate-100  dark:bg-slate-800     text-slate-600  dark:text-slate-300",
};

function ParsedCard({ parsed }) {
  const isIn   = parsed.type === "in";
  const catCls = CATEGORY_COLORS[parsed.category] || CATEGORY_COLORS.other;
  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isIn ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
          {isIn ? "Cash In" : "Cash Out"}
        </span>
        <p className={`text-xl font-bold font-num ${isIn ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
          {isIn ? "+" : "−"}{fmt(parsed.amount || 0)}
        </p>
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

export default function VoiceModal({ onClose, onSave }) {
  const {
    isRecording, status, transcript, interim, parsed, error,
    lang, setLang, startRecording, stopAndProcess, reset,
  } = useVoiceTx();

  const handleSave = () => {
    if (!parsed) return;
    onSave({
      ...parsed,
      amount:   parseFloat(parsed.amount) || 0,
      quantity: parseInt(parsed.quantity) || 1,
      transaction_date: today(),
    });
    onClose();
  };

  const isParsing  = status === "parsing";
  const isBusy     = isRecording || isParsing;
  const liveText   = transcript ? transcript + (interim ? " " + interim : "") : interim;

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
              <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">Understanding transaction…</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Parsing your transaction details…</p>
            </div>
          )}
          {isRecording && !liveText && (
            <div className="text-center">
              <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">Listening…</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Speak your transaction, then tap stop</p>
            </div>
          )}
          {status === "idle" && (
            <div className="text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Tap the mic to start</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic max-w-[230px] leading-relaxed">
                {EXAMPLES[lang]}
              </p>
            </div>
          )}

          {/* Live caption box while recording */}
          {isRecording && liveText && (
            <div className="mt-4 w-full bg-slate-50 dark:bg-slate-900 rounded-xl p-3.5 border border-slate-100 dark:border-slate-800 min-h-[56px]">
              <p className="text-[10px] text-brand-500 font-bold uppercase tracking-wide mb-1">Live</p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {transcript && <span>{transcript} </span>}
                {interim   && <span className="text-slate-400 dark:text-slate-500 italic">{interim}</span>}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Final transcript (shown after recording, while parsing or on done/error) */}
      {transcript && !isRecording && status !== "idle" && (
        <div className="mb-4">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide mb-1.5">Heard</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 rounded-xl p-3 border border-slate-100 dark:border-slate-800 italic leading-relaxed">
            "{transcript}"
          </p>
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
