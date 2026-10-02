// Fills its (sized, position: relative) parent.
// One media player for every campaign placement — banner, pop-up, story, card. Plays:
//   image (JPG / PNG / WebP / AVIF) · gif · video (MP4 / WebM) · lottie (an animation JSON) · youtube (a YouTube link)
//
// Built not to cost users data or attention:
//   • inline (banners, cards): a video / animation plays MUTED and only while at least half of it is on screen with the
//     app in front; it pauses the moment it scrolls away. YouTube shows its picture with a play mark (the full-screen
//     viewers play it).
//   • data saver, a 2G-class connection or "reduce motion" → the still picture (poster) instead of autoplay.
//   • anything that fails to load → `fallback` (the placement's brand gradient), never a broken image / black box.
// `mode="fullscreen"` (stories, pop-up) lets the parent drive playback (`playing`, `muted`) and hear about the media's
// length and end (`onDuration`, `onEnded`) — a story frame lasts as long as its video / animation.
import { useEffect, useRef, useState } from "react";
import { mediaKindOf, prefersLiteMedia, youtubeEmbed, youtubeId, youtubeThumb } from "../../utils/campaignRules";
import { useInView, usePageVisible } from "../../hooks/useInView";

const fill = { position: "absolute", inset: 0, width: "100%", height: "100%" };

let lottieLib = null;
const loadLottie = () => (lottieLib = lottieLib || import("lottie-web/build/player/lottie_light").then((m) => m.default || m));
const lottieJson = new Map();   // url → Promise<animation JSON>
const MAX_LOTTIE_BYTES = 3 * 1024 * 1024;
function fetchLottie(url) {
  if (!lottieJson.has(url)) {
    lottieJson.set(url, fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (text.length > MAX_LOTTIE_BYTES) throw new Error("animation too large");
      const j = JSON.parse(text);
      if (!j || !Array.isArray(j.layers)) throw new Error("not a Lottie animation");
      return j;
    }));
    lottieJson.get(url).catch(() => lottieJson.delete(url));
  }
  return lottieJson.get(url);
}

function PlayMark() {
  return (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="w-12 h-12 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-6 h-6 text-white ml-0.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </span>
    </span>
  );
}

function Still({ src, alt, fit, onError }) {
  return <img src={src} alt={alt} draggable={false} loading="lazy" decoding="async" onError={onError}
    style={{ ...fill, objectFit: fit }} />;
}

function LottieView({ url, playing, loop, fit, onDuration, onEnded, onError }) {
  const box = useRef(null);
  const anim = useRef(null);
  const cbs = useRef({ onDuration, onEnded, onError });
  cbs.current = { onDuration, onEnded, onError };
  useEffect(() => {
    let dead = false;
    Promise.all([loadLottie(), fetchLottie(url)]).then(([lottie, data]) => {
      if (dead || !box.current) return;
      anim.current = lottie.loadAnimation({
        container: box.current, renderer: "svg", loop, autoplay: false, animationData: data,
        rendererSettings: { preserveAspectRatio: fit === "contain" ? "xMidYMid meet" : "xMidYMid slice" },
      });
      anim.current.addEventListener("complete", () => cbs.current.onEnded?.());
      const ms = anim.current.getDuration(false) * 1000;
      if (Number.isFinite(ms) && ms > 0) cbs.current.onDuration?.(ms);
      if (playing) anim.current.play(); else anim.current.goToAndStop(0, true);
    }).catch(() => { if (!dead) cbs.current.onError?.(); });
    return () => { dead = true; anim.current?.destroy(); anim.current = null; };
  }, [url, loop, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!anim.current) return;
    if (playing) anim.current.play(); else anim.current.pause();
  }, [playing]);
  return <div ref={box} style={fill} aria-hidden="true" />;
}

export default function CampaignMedia({
  url, media_type, poster_url, alt = "", fit = "cover", mode = "inline",
  playing: playingProp, muted = true, loop, fallback = null, className = "",
  onDuration, onEnded, onError, onAutoplayBlocked,
}) {
  const box = useRef(null);
  const video = useRef(null);
  const [failed, setFailed] = useState(false);
  const inView = useInView(box, { threshold: 0.5 });
  const pageVisible = usePageVisible();
  const [lite] = useState(() => prefersLiteMedia());
  useEffect(() => { setFailed(false); }, [url]);

  const kind = mediaKindOf({ media_type, url });
  const fullscreen = mode === "fullscreen";
  const playing = playingProp ?? (inView && pageVisible && !lite);
  const doLoop = loop ?? !fullscreen;
  const fail = () => { setFailed(true); onError?.(); };

  useEffect(() => {
    const v = video.current;
    if (!v || kind !== "video") return;
    v.muted = muted;
    if (playing) {
      const p = v.play();
      if (p?.catch) p.catch(() => {
        if (!v.muted) { v.muted = true; onAutoplayBlocked?.(); v.play().catch(() => {}); }
      });
    } else v.pause();
  }, [playing, muted, kind, url]); // eslint-disable-line react-hooks/exhaustive-deps

  let content = null;
  if (!url || failed) content = fallback;
  else if (kind === "youtube") {
    const id = youtubeId(url);
    content = fullscreen && playing
      ? <iframe title={alt || "Video"} src={youtubeEmbed(id, { muted })} style={{ ...fill, border: 0 }}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      : <><Still src={poster_url || youtubeThumb(id)} alt={alt} fit={fit} onError={fail} /><PlayMark /></>;
  } else if (kind === "video") {
    content = lite && !fullscreen && poster_url
      ? <Still src={poster_url} alt={alt} fit={fit} onError={fail} />
      : <>
          <video ref={video} src={url} poster={poster_url || undefined} muted={muted} playsInline loop={doLoop}
            preload={fullscreen ? "auto" : "metadata"} draggable={false} style={{ ...fill, objectFit: fit }}
            onLoadedMetadata={(e) => { const ms = e.currentTarget.duration * 1000; if (Number.isFinite(ms) && ms > 0) onDuration?.(ms); }}
            onEnded={() => onEnded?.()} onError={fail} />
          {lite && !fullscreen && <PlayMark />}
        </>;
  } else if (kind === "lottie") {
    content = lite && !fullscreen
      ? (poster_url ? <Still src={poster_url} alt={alt} fit={fit} onError={fail} /> : <LottieView url={url} playing={false} loop={false} fit={fit} onError={fail} />)
      : <LottieView url={url} playing={playing} loop={doLoop} fit={fit} onDuration={onDuration} onEnded={onEnded} onError={fail} />;
  } else if (kind === "gif" && lite && !fullscreen && poster_url) {
    content = <Still src={poster_url} alt={alt} fit={fit} onError={fail} />;
  } else {
    content = <Still src={url} alt={alt} fit={fit} onError={fail} />;
  }

  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0, overflow: "hidden" }}
      data-media-kind={url && !failed ? kind : "none"}>
      {content}
    </div>
  );
}
