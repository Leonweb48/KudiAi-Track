import { useState } from "react";

/**
 * Colourful hero card with a cut-out person photo on the right (Finance, Bills, Stock, client savings…).
 *   <PhotoHero img="/img/people/bills.webp" title="…" sub="…" from="#2563eb" to="#1e3a8a" />
 * The card still reads well if the photo fails to load (it is just hidden).
 */
export default function PhotoHero({ img, title, sub, from = "#3DA829", to = "#1f6b12", height = 118, children, className = "" }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className={`relative overflow-hidden rounded-[24px] text-white ${className}`}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`, minHeight: height, boxShadow: `0 14px 30px -16px ${to}` }}>
      <span className="pointer-events-none absolute -right-10 -top-14 w-44 h-44 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute right-24 -bottom-16 w-32 h-32 rounded-full bg-white/10" />
      <div className="relative flex items-end">
        <div className="flex-1 min-w-0 p-4 self-center">
          <p className="text-[16px] font-black leading-tight">{title}</p>
          {sub && <p className="mt-1 text-[12px] text-white/85 leading-snug max-w-[26ch]">{sub}</p>}
          {children}
        </div>
        {img && imgOk && (
          <img src={img} alt="" onError={() => setImgOk(false)}
            className="relative w-auto object-contain object-bottom flex-none drop-shadow-[0_8px_14px_rgba(0,0,0,.25)]"
            style={{ height }} />
        )}
      </div>
    </div>
  );
}
