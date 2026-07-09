// Slot: upsell_inline — template-driven (no free image), brand-styled
// Replaces hardcoded upgrade messages at plan-limit touchpoints
import { useNavigate } from "react-router-dom";
import { slotNavigate } from "./useSlotNav";

export default function UpsellInlineSlot({ campaign, loading, recordEvent }) {
  const navigate = useNavigate();

  // Skeleton while loading — same height as the component
  if (loading) {
    return (
      <div className="w-full h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse mb-3" />
    );
  }

  if (!campaign) return null;

  const onCTA = async () => {
    recordEvent(campaign.id, "click");
    await slotNavigate(campaign.cta_action_type, campaign.cta_action_value, navigate);
  };

  return (
    <button
      onClick={onCTA}
      onPointerEnter={() => recordEvent(campaign.id, "impression")}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border active:scale-[0.99] transition-transform mb-3"
      style={{ background: "linear-gradient(135deg,#16255A10,#3DA82910)", borderColor: "#3DA82940" }}
    >
      <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
           style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">
          {campaign.headline || "Upgrade your plan"}
        </p>
        {campaign.body && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{campaign.body}</p>
        )}
      </div>
      {campaign.cta_label && (
        <span className="flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl text-white"
              style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}>
          {campaign.cta_label}
        </span>
      )}
    </button>
  );
}
