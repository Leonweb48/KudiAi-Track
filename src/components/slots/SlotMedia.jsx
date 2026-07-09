export default function SlotMedia({ creative_url, headline, className = "", style = {} }) {
  if (!creative_url) return null;
  const isVideo = /\.(mp4|webm)(\?|$)/i.test(creative_url);
  if (isVideo) {
    return (
      <video
        src={creative_url}
        autoPlay muted loop playsInline
        className={className}
        style={{ objectFit: "cover", display: "block", ...style }}
      />
    );
  }
  return (
    <img
      src={creative_url}
      alt={headline || ""}
      className={className}
      style={{ objectFit: "cover", display: "block", ...style }}
      draggable={false}
      loading="lazy"
    />
  );
}
