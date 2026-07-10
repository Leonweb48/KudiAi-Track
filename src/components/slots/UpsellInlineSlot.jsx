// Slot: upsell_inline — up to 5 slides, auto-advancing, marquee text on each slide
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { slotNavigate } from "./useSlotNav";

function injectKf() {
  if (typeof document === "undefined" || document.getElementById("kt-upsell-kf")) return;
  const s = document.createElement("style");
  s.id = "kt-upsell-kf";
  s.textContent = `
    @keyframes kt-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes kt-upsell-in{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:translateX(0)}}
    .kt-upsell-in{animation:kt-upsell-in 0.32s ease-out forwards}
  `;
  document.head.appendChild(s);
}

function Marquee({ text, duration, textClass }) {
  if (!text) return null;
  return (
    <div className="overflow-hidden w-full">
      <div style={{ animation: `kt-marquee ${duration} linear infinite`, display: "flex", whiteSpace: "nowrap" }}>
        <span className={textClass} style={{ paddingRight: "5rem" }}>{text}</span>
        <span className={textClass} style={{ paddingRight: "5rem" }} aria-hidden="true">{text}</span>
      </div>
    </div>
  );
}

export default function UpsellInlineSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);

  useEffect(() => { injectKf(); }, []);

  // Reset to first slide if campaign list changes
  useEffect(() => { setIdx(0); }, [campaigns.length]);

  // Auto-advance every 5 s
  useEffect(() => {
    if (campaigns.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % campaigns.length), 5000);
    return () => clearInterval(t);
  }, [campaigns.length]);

  if (loading) {
    return <div className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse mb-3" />;
  }
  if (!campaigns.length) return null;

  const c = campaigns[Math.min(idx, campaigns.length - 1)];

  const onCTA = async () => {
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  return (
    <div className="mb-3">
      <button
        onClick={onCTA}
        onPointerEnter={() => recordEvent(c.id, "impression")}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border active:scale-[0.99] transition-transform overflow-hidden"
        style={{ background: "linear-gradient(135deg,#16255A10,#3DA82910)", borderColor: "#3DA82940" }}
      >
        {/* Icon — fixed, never remounts */}
        <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
             style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}>
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>

        {/* Text area — remounts on slide change, triggers slide-in animation + resets marquee */}
        <div key={c.id} className="kt-upsell-in flex-1 min-w-0 text-left overflow-hidden">
          <Marquee
            text={c.headline || "Upgrade your plan"}
            duration="16s"
            textClass="text-[13px] font-bold text-slate-800 dark:text-slate-100 leading-tight"
          />
          {c.body && (
            <Marquee
              text={c.body}
              duration="24s"
              textClass="text-[11px] text-slate-500 dark:text-slate-400 leading-tight"
            />
          )}
        </div>

        {/* CTA badge */}
        {c.cta_label && (
          <span className="flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl text-white"
                style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}>
            {c.cta_label}
          </span>
        )}
      </button>

      {/* Slide dots */}
      {campaigns.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-2">
          {campaigns.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Slide ${i + 1}`}
              className={`rounded-full transition-all duration-300 ${
                i === idx
                  ? "w-5 h-1.5 bg-green-500"
                  : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
