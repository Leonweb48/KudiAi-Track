// Slot: announcement_bar — scrolling marquee pill, sits in normal flow (no overlap)
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { slotNavigate } from "./useSlotNav";

const DISMISSED_KEY = "kt_abar_dismissed";

function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])); } catch {}
}

function injectKeyframes() {
  if (typeof document === "undefined" || document.getElementById("kt-marquee-kf")) return;
  const s = document.createElement("style");
  s.id = "kt-marquee-kf";
  s.textContent = `
    @keyframes kt-marquee {
      0%   { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    .kt-marquee-track { animation: kt-marquee 18s linear infinite; display: flex; white-space: nowrap; }
    .kt-marquee-track:hover { animation-play-state: paused; }
  `;
  document.head.appendChild(s);
}

export default function AnnouncementBarSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => getDismissed());

  useEffect(() => { injectKeyframes(); }, []);
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  if (loading || !campaigns.length) return null;

  const visible = campaigns.filter(c => !dismissed.has(c.id));
  if (!visible.length) return null;

  const c = visible[0];

  const dismiss = (e) => {
    e.stopPropagation();
    recordEvent(c.id, "dismiss");
    setDismissed(p => { const s = new Set(p); s.add(c.id); return s; });
  };

  const onTap = async () => {
    if (!c.cta_action_value) return;
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  // Build the scrolling label — headline (or body) + optional CTA label
  const label = [c.headline || c.body, c.cta_label].filter(Boolean).join("  ·  ");

  return (
    <div
      className="mx-3 my-1.5 rounded-2xl overflow-hidden flex items-center shrink-0"
      style={{ background: "linear-gradient(90deg,#16255A 0%,#3DA829 100%)", height: 34 }}
      onPointerEnter={() => recordEvent(c.id, "impression")}
    >
      {/* Megaphone icon */}
      <div className="pl-3 pr-1.5 shrink-0 flex items-center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="#fde68a" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      </div>

      {/* Marquee container */}
      <div
        className="flex-1 overflow-hidden relative h-full flex items-center"
        style={{ cursor: c.cta_action_value ? "pointer" : "default" }}
        onClick={onTap}
      >
        {/* Left edge fade */}
        <div
          className="absolute left-0 top-0 bottom-0 w-5 z-10 pointer-events-none"
          style={{ background: "linear-gradient(to right, #16255A, transparent)" }}
        />

        {/* Scrolling track — content duplicated for seamless loop */}
        <div className="kt-marquee-track">
          <span className="text-[11px] font-semibold text-white pr-24 leading-none">{label}</span>
          <span className="text-[11px] font-semibold text-white pr-24 leading-none" aria-hidden="true">{label}</span>
        </div>

        {/* Right edge fade */}
        <div
          className="absolute right-0 top-0 bottom-0 w-5 z-10 pointer-events-none"
          style={{ background: "linear-gradient(to left, #2e7a1e, transparent)" }}
        />
      </div>

      {/* Dismiss button */}
      <button
        onClick={dismiss}
        className="shrink-0 flex items-center justify-center pl-1 pr-3 h-full opacity-60 hover:opacity-100 active:opacity-100 transition-opacity"
        aria-label="Dismiss announcement"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
             stroke="white" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
