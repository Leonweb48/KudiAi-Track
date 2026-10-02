// Slot: feed_card — 4:1 creative, injected at most once per 8 rows in a feed
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useImpressionOf } from "../../hooks/useInView";
import SlotMedia from "./SlotMedia";
import { slotNavigate } from "./useSlotNav";

export default function FeedCardSlot({ campaign, recordEvent }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  useImpressionOf(ref, campaign?.id, (id) => recordEvent(id, "impression"));
  if (!campaign) return null;

  const onTap = async () => {
    recordEvent(campaign.id, "click");
    await slotNavigate(campaign.cta_action_type, campaign.cta_action_value, navigate);
  };

  return (
    <button
      ref={ref}
      onClick={onTap}
      className="w-full relative rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700/50 active:scale-[0.98] transition-transform mb-2"
      style={{ aspectRatio: "4/1" }}
    >
      <SlotMedia creative_url={campaign.creative_url} headline={campaign.headline} media_type={campaign.media_type} poster_url={campaign.poster_url}
        fallback={<div className="absolute inset-0 bg-[linear-gradient(135deg,#16255A,#3DA829)]" />} />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent flex items-center px-4">
        <div className="min-w-0">
          {campaign.headline && (
            <p className="text-white font-bold text-sm leading-snug line-clamp-1 drop-shadow">{campaign.headline}</p>
          )}
          {campaign.cta_label && (
            <span className="text-white/90 text-xs font-semibold underline">{campaign.cta_label} →</span>
          )}
        </div>
      </div>
    </button>
  );
}

// Helper: inject a FeedCardSlot into a list of rows at a fixed interval
export function injectFeedCard(rows, campaign, recordEvent, interval = 8) {
  if (!campaign) return rows;
  const result = [...rows];
  result.splice(interval - 1, 0, (
    <FeedCardSlot key={`fc-${campaign.id}`} campaign={campaign} recordEvent={recordEvent} />
  ));
  return result;
}
