export default function SlotMedia({ creative_url, headline, className = "" }) {
  if (!creative_url) return null;
  const isVideo = /\.(mp4|webm)(\?|$)/i.test(creative_url);
  const shared = {
    className,
    style: { objectFit: "cover", display: "block", width: "100%", height: "100%" },
  };
  if (isVideo) {
    return <video src={creative_url} autoPlay muted loop playsInline draggable={false} {...shared} />;
  }
  return (
    <img
      src={creative_url}
      alt={headline || ""}
      draggable={false}
      loading="eager"
      {...shared}
    />
  );
}
