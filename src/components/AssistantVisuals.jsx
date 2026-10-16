import { useT } from "../contexts/LanguageContext";

/** KudiAI assistant face in a green ring with a small ✨ badge — used for the chat header, bubbles and the floating button. */
export function AssistantAvatar({ size = 36, badge = true, className = "" }) {
  return (
    <span className={`relative inline-flex flex-none ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-0 rounded-full p-[2px] bg-gradient-to-br from-[#6ee05a] to-[#1f7a14] shadow-[0_4px_10px_-2px_rgba(42,138,26,.55)]">
        <img src="/img/people/assistant-face.webp" alt="" className="w-full h-full rounded-full object-cover bg-[#e9f7e4]" />
      </span>
      {badge && size >= 28 && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center shadow"
          style={{ width: Math.round(size * 0.42), height: Math.round(size * 0.42), fontSize: Math.round(size * 0.24) }}>✨</span>
      )}
    </span>
  );
}

/** Welcome card shown before the first question. portal: "owner" | "client" */
export function AssistantHero({ portal = "owner", compact = false }) {
  const t = useT();
  return (
    <div className={`relative overflow-hidden rounded-[24px] text-white shadow-[0_14px_30px_-14px_rgba(42,138,26,.7)] ${compact ? "min-h-[118px]" : "min-h-[150px]"}`}
      style={{ background: "linear-gradient(135deg,#3DA829 0%,#2a8a1a 60%,#1f6b12 100%)" }}>
      <span className="pointer-events-none absolute -right-12 -top-14 w-48 h-48 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute right-20 -bottom-20 w-36 h-36 rounded-full bg-white/10" />
      <div className="relative flex items-end">
        <div className={`flex-1 min-w-0 ${compact ? "p-3.5" : "p-4"} self-center`}>
          <p className={`${compact ? "text-[15px]" : "text-[18px]"} font-black leading-tight`}>{t("visual.aiHello")}</p>
          <p className={`mt-1 ${compact ? "text-[11.5px]" : "text-[12.5px]"} text-green-50/90 leading-snug max-w-[24ch]`}>
            {t(portal === "client" ? "visual.aiHelloClient" : "visual.aiHelloOwner")}
          </p>
          <p className="mt-2 text-[10.5px] font-bold text-white/80">🗣️ English · Pidgin · Hausa · Igbo · Yorùbá</p>
        </div>
        <img src="/img/people/assistant.webp" alt="" className={`relative ${compact ? "h-[118px]" : "h-[150px]"} w-auto object-contain object-bottom drop-shadow-[0_8px_14px_rgba(0,0,0,.25)]`} />
      </div>
    </div>
  );
}
