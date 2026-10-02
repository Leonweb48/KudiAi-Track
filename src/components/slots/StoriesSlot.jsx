// Slot: stories — a row of round thumbnails at the top of a Home screen (like WhatsApp Status). Nothing plays and
// nothing opens until the user taps one; the full-screen StoryViewer then plays that story and the ones after it.
// A coloured ring = not watched yet (since the admin last changed it); watched ones move to the end with a grey ring.
// Takes no space at all when there are no stories (no skeleton row that would push the page down and back up).
import { useMemo, useRef, useState } from "react";
import StoryViewer from "./StoryViewer";
import { useImpression } from "../../hooks/useInView";
import { mediaKindOf, storyFrames, storySeen, youtubeId, youtubeThumb } from "../../utils/campaignRules";

const css = `.st-row::-webkit-scrollbar{display:none}.st-row{-ms-overflow-style:none;scrollbar-width:none}`;

function thumbFor(c) {
  if (c.creative_url && ["image", "gif"].includes(mediaKindOf({ media_type: c.media_type, url: c.creative_url }))) return c.creative_url;
  if (c.poster_url) return c.poster_url;
  const f = storyFrames(c)[0];
  if (!f) return "";
  if (f.poster_url) return f.poster_url;
  const k = mediaKindOf({ media_type: f.media_type, url: f.url });
  if (k === "image" || k === "gif") return f.url;
  if (k === "youtube") return youtubeThumb(youtubeId(f.url));
  return "";
}

function Bubble({ c, seen, onOpen, recordEvent }) {
  const ref = useRef(null);
  const [broken, setBroken] = useState(false);
  useImpression(ref, () => recordEvent(c.id, "impression"));
  const src = thumbFor(c);
  const label = c.headline || "Story";
  return (
    <button ref={ref} type="button" onClick={onOpen} aria-label={`Open story: ${label}`}
      className="flex flex-col items-center w-[70px] flex-shrink-0 active:scale-95 transition-transform">
      <span className={`p-[2.5px] rounded-full ${seen ? "bg-slate-300 dark:bg-slate-600" : "bg-[conic-gradient(from_200deg,#3DA829,#16255A,#22c55e,#3DA829)]"}`}>
        <span className="block p-[2px] rounded-full bg-white dark:bg-slate-900">
          <span className="relative block w-[58px] h-[58px] rounded-full overflow-hidden bg-[linear-gradient(135deg,#16255A,#3DA829)]">
            {src && !broken
              ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
              : <span className="absolute inset-0 flex items-center justify-center text-white text-lg font-extrabold">{label.trim()[0]?.toUpperCase()}</span>}
          </span>
        </span>
      </span>
      <span className={`mt-1 w-full text-center text-[10.5px] leading-tight truncate ${seen ? "text-slate-400 dark:text-slate-500" : "font-semibold text-slate-700 dark:text-slate-200"}`}>
        {label}
      </span>
    </button>
  );
}

export default function StoriesSlot({ campaigns = [], loading, recordEvent, className = "" }) {
  const [openAt, setOpenAt] = useState(null);
  const [seenTick, setSeenTick] = useState(0);
  const stories = useMemo(() => {
    const usable = campaigns.filter((c) => storyFrames(c).length);
    const unseen = usable.filter((c) => !storySeen.has(c));
    const seen = usable.filter((c) => storySeen.has(c));
    return [...unseen, ...seen];
  }, [campaigns, seenTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !stories.length) return null;
  return (
    <div className={className}>
      <style>{css}</style>
      <div className="st-row flex gap-2.5 overflow-x-auto -mx-4 px-4 pb-1">
        {stories.map((c, i) => (
          <Bubble key={c.id} c={c} seen={storySeen.has(c)} onOpen={() => setOpenAt(i)} recordEvent={recordEvent} />
        ))}
      </div>
      {openAt != null && (
        <StoryViewer stories={stories} startIndex={openAt} recordEvent={recordEvent}
          onClose={() => { setOpenAt(null); setSeenTick((t) => t + 1); }} />
      )}
    </div>
  );
}
