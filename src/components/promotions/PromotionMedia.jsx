export default function PromotionMedia({ promo, className = "", style = {} }) {
  if (promo.media_type === "video") {
    return (
      <video
        src={promo.media_url}
        autoPlay muted loop playsInline
        className={className}
        style={{ objectFit: "cover", display: "block", ...style }}
      />
    );
  }
  return (
    <img
      src={promo.media_url}
      alt={promo.title || ""}
      className={className}
      style={{ objectFit: "cover", display: "block", ...style }}
      draggable={false}
    />
  );
}
