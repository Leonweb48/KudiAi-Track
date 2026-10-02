// Kept for the placements that still import it: everything now plays through CampaignMedia (images, GIFs, video,
// Lottie animations, YouTube — with data-saver and on-screen-only playback). Fills its sized parent.
import CampaignMedia from "./CampaignMedia";

export default function SlotMedia({ creative_url, headline, media_type, poster_url, fallback = null, className = "" }) {
  if (!creative_url) return fallback;
  return (
    <CampaignMedia url={creative_url} media_type={media_type} poster_url={poster_url} alt={headline || ""}
      fallback={fallback} className={className} />
  );
}
