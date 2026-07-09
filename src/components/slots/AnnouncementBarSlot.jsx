// Slot: announcement_bar — fixed-height dismissible bar under the app header
// Zero layout shift: reserved via fixed min-height; collapses to 0 when empty
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

export default function AnnouncementBarSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => getDismissed());

  // Keep localStorage in sync
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  if (loading || !campaigns.length) return null;

  const visible = campaigns.filter(c => !dismissed.has(c.id));
  if (!visible.length) return null;

  const c = visible[0]; // max 1 bar

  const dismiss = () => {
    recordEvent(c.id, "dismiss");
    setDismissed(p => { const s = new Set(p); s.add(c.id); return s; });
  };

  const onTap = async () => {
    if (!c.cta_action_value) return;
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  return (
    <div
      className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white"
      style={{ background: "linear-gradient(90deg,#16255A,#3DA829)", minHeight: "36px" }}
      onPointerEnter={() => recordEvent(c.id, "impression")}
    >
      <span className="flex-1 truncate cursor-pointer" onClick={onTap}>
        {c.headline || c.body}
        {c.cta_label && <span className="ml-2 underline">{c.cta_label}</span>}
      </span>
      <button onClick={dismiss} className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity" aria-label="Dismiss">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
