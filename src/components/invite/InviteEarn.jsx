import { useEffect, useMemo, useState } from "react";
import { useT } from "../../contexts/LanguageContext";
import { useInviteDashboard } from "../../hooks/useInvite";
import { naira, countdown, tierSlots, maxRewardKobo, inviteStage, initials, inviteLink } from "../../utils/invite";

/* ─────────────────────────── shared graphics ─────────────────────────── */

/** A stacked naira note — the hero "prize" graphic. */
export function NairaNote({ amount, scale = 1, className = "" }) {
  return (
    <div className={/(^|\s)(absolute|fixed)(\s|$)/.test(className) ? className : `relative ${className}`} style={{ width: 196 * scale, height: 104 * scale }} aria-hidden="true">
      <div className="absolute inset-0 rounded-[18px] bg-gradient-to-br from-emerald-300 to-emerald-500 rotate-[-7deg] translate-x-2 -translate-y-1 opacity-70 shadow-lg" />
      <div className="absolute inset-0 rounded-[18px] p-[7px] bg-gradient-to-br from-[#5fd14a] via-[#3DA829] to-[#1f7a14] shadow-[0_14px_30px_rgba(31,122,20,.45)]">
        <div className="relative h-full rounded-[12px] border-2 border-white/70 bg-gradient-to-br from-white/25 to-white/5 flex items-center justify-center overflow-hidden">
          <span className="absolute left-2 top-1 text-[10px] font-black text-white/80" style={{ fontSize: 10 * scale }}>₦</span>
          <span className="absolute right-2 bottom-1 font-black text-white/80" style={{ fontSize: 10 * scale }}>₦</span>
          <span className="absolute -left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border-2 border-white/30" style={{ width: 40 * scale, height: 40 * scale }} />
          <span className="font-black tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,.18)]" style={{ fontSize: 34 * scale }}>{amount}</span>
        </div>
      </div>
    </div>
  );
}

const CONFETTI = [
  ["#f472b6", "8%", "14%", -20], ["#5fd14a", "86%", "10%", 25], ["#fbbf24", "70%", "4%", 10], ["#38bdf8", "18%", "70%", 40],
  ["#fbbf24", "92%", "62%", -35], ["#f472b6", "48%", "8%", 60], ["#5fd14a", "30%", "30%", -10], ["#a78bfa", "60%", "78%", 20],
];
export function Confetti({ opacity = 0.9 }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" style={{ opacity }}>
      {CONFETTI.map(([c, x, y, r], i) => (
        <span key={i} className="absolute rounded-[2px]" style={{ left: x, top: y, width: i % 2 ? 6 : 9, height: i % 2 ? 12 : 5, background: c, transform: `rotate(${r}deg)` }} />
      ))}
    </div>
  );
}

const Ico = ({ d, className = "w-5 h-5", stroke = "currentColor", sw = 2 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const I = {
  back: "M15 18l-6-6 6-6",
  share: "M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7|M16 6l-4-4-4 4|M12 2v13",
  copy: "M9 9h11v11H9z|M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1",
  wallet: "M3 7a2 2 0 012-2h13a1 1 0 011 1v3|M3 7v11a2 2 0 002 2h15a1 1 0 001-1v-4|M21 11h-5a2 2 0 000 4h5z",
  gift: "M20 12v9H4v-9|M2 7h20v5H2z|M12 21V7|M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z|M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z",
  clock: "M12 22a10 10 0 100-20 10 10 0 000 20z|M12 6v6l4 2",
  check: "M20 6L9 17l-5-5",
  plus: "M12 5v14|M5 12h14",
  x: "M18 6L6 18|M6 6l12 12",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20z|M12 16v-4|M12 8h.01",
  link: "M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7|M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7",
  sms: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  dots: "M5 12h.01|M12 12h.01|M19 12h.01",
};

function WhatsAppIcon({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 01-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 00-.8.4 3.4 3.4 0 00-1 2.5 6 6 0 001.2 3.1 13.4 13.4 0 005.2 4.6c1.9.8 2.7.9 3.6.7a3.1 3.1 0 002-1.4 2.5 2.5 0 00.2-1.4c-.1-.1-.3-.2-.6-.3zM12 21.8a9.9 9.9 0 01-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1112 21.8zm0-21.6A11.8 11.8 0 002 18l-1.6 5.8 6-1.6A11.8 11.8 0 1012 .2z" />
    </svg>
  );
}

/* ─────────────────────────── bottom sheets ─────────────────────────── */

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-[28px] shadow-2xl pb-[max(20px,env(safe-area-inset-bottom))] animate-[slideUp_.22s_ease-out]">
        <div className="mx-auto mt-2.5 mb-1 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex items-center justify-between px-5 pt-2 pb-3">
          <h3 className="text-[17px] font-extrabold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500" aria-label="Close">
            <Ico d={I.x} className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}

function ShareSheet({ text, link, onClose, onCopied }) {
  const t = useT();
  const open = (url) => { try { window.open(url, "_blank", "noopener"); } catch { /* ignore */ } };
  const copyLink = async () => { try { await navigator.clipboard?.writeText(link); onCopied?.(); } catch { /* ignore */ } onClose(); };
  const more = async () => {
    if (navigator.share) { try { await navigator.share({ title: "KudiAI Track", text, url: link }); } catch { /* cancelled */ } }
    else { try { await navigator.clipboard?.writeText(text); onCopied?.(); } catch { /* ignore */ } }
    onClose();
  };
  const items = [
    { key: "wa", label: t("invite.shareWhatsapp"), cls: "bg-[#25D366] text-white", icon: <WhatsAppIcon />, on: () => open(`https://wa.me/?text=${encodeURIComponent(text)}`) },
    { key: "sms", label: t("invite.shareSms"), cls: "bg-sky-500 text-white", icon: <Ico d={I.sms} className="w-6 h-6" />, on: () => open(`sms:?&body=${encodeURIComponent(text)}`) },
    { key: "link", label: t("invite.copyLink"), cls: "bg-slate-800 text-white dark:bg-slate-700", icon: <Ico d={I.link} className="w-6 h-6" />, on: copyLink },
    { key: "more", label: t("invite.shareMore"), cls: "bg-brand-500 text-white", icon: <Ico d={I.dots} className="w-6 h-6" sw={3} />, on: more },
  ];
  return (
    <Sheet title={t("invite.shareTitle")} onClose={onClose}>
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-3.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 mb-4 line-clamp-4">{text}</div>
      <div className="grid grid-cols-4 gap-3 pb-2">
        {items.map((it) => (
          <button key={it.key} onClick={it.on} className="flex flex-col items-center gap-2 active:scale-95 transition-transform">
            <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${it.cls}`}>{it.icon}</span>
            <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">{it.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function RulesSheet({ cfg, onClose }) {
  const t = useT();
  const tiers = cfg?.tiers || [];
  const v = {
    min: naira(cfg?.min_spend), days: cfg?.window_days, bonus: naira(cfg?.friend_bonus),
    t1: naira(tiers[0]), t2: naira(tiers[1]), t3: naira(tiers[2]), max: naira(maxRewardKobo(tiers)),
  };
  const rules = ["rule1", "rule2", "rule3", "rule4", "rule5", "rule6", "rule7"];
  return (
    <Sheet title={t("invite.rulesTitle")} onClose={onClose}>
      <ol className="space-y-3 max-h-[58vh] overflow-y-auto pr-1">
        {rules.map((k, i) => (
          <li key={k} className="flex gap-3">
            <span className="flex-none w-6 h-6 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[12px] font-extrabold flex items-center justify-center">{i + 1}</span>
            <p className="text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">{t(`invite.${k}`, v)}</p>
          </li>
        ))}
      </ol>
      <button onClick={onClose} className="mt-5 mb-1 w-full h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">{t("invite.gotIt")}</button>
    </Sheet>
  );
}

/* ─────────────────────────── pieces of the screen ─────────────────────────── */

function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Hero({ portal, cfg, endsAt }) {
  const t = useT();
  const now = useNow(!!endsAt);
  const cd = endsAt ? countdown(endsAt, now) : null;
  const max = naira(maxRewardKobo(cfg?.tiers));
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#0b1640] text-white shadow-[0_20px_40px_-12px_rgba(11,22,64,.55)]">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_95%_100%,rgba(61,168,41,.55),transparent_55%),radial-gradient(80%_60%_at_0%_0%,rgba(37,99,235,.35),transparent_60%)]" />
      <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full border border-white/10" />
      <div className="absolute -right-6 -top-6 w-36 h-36 rounded-full border border-white/10" />
      <Confetti opacity={0.8} />
      <div className="relative px-5 pt-5">
        {cd && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 border border-white/15 backdrop-blur px-3 py-1 text-[12px] font-bold tabular-nums">
            <Ico d={I.clock} className="w-3.5 h-3.5 text-amber-300" />
            {t("invite.timeLeft", { time: cd.text })}
          </span>
        )}
        <h2 className="mt-3 text-[25px] leading-[1.12] font-extrabold tracking-tight max-w-[15ch]">{t("invite.heroTitle")}</h2>
        <p className="mt-1 text-[22px] font-extrabold text-[#7ee36a] leading-tight">{t("invite.heroEarn", { amount: max })}</p>
        <p className="mt-1.5 text-[13px] text-white/75 max-w-[24ch]">{t("invite.heroSub", { bonus: naira(cfg?.friend_bonus) })}</p>
      </div>
      <div className="relative h-[178px] mt-1">
        <NairaNote amount={max} scale={0.72} className="absolute left-4 bottom-8 rotate-[-6deg]" />
        <img src={portal === "client" ? "/img/invite-client.webp" : "/img/invite-owner.webp"} alt=""
          className="absolute right-0 bottom-0 h-[186px] w-auto object-contain object-bottom drop-shadow-[0_10px_20px_rgba(0,0,0,.35)]" />
      </div>
    </div>
  );
}

function Steps({ cfg }) {
  const t = useT();
  const steps = [
    { icon: I.share, grad: "from-sky-400 to-blue-600", text: t("invite.step1") },
    { icon: I.wallet, grad: "from-amber-300 to-orange-500", text: t("invite.step2", { amount: naira(cfg?.min_spend), days: cfg?.window_days }) },
    { icon: I.gift, grad: "from-[#5fd14a] to-[#1f7a14]", text: t("invite.step3", { max: naira(cfg?.tiers?.[(cfg?.tiers?.length || 1) - 1]), bonus: naira(cfg?.friend_bonus) }) },
  ];
  return (
    <div className="grid grid-cols-3 gap-1">
      {steps.map((s, i) => (
        <div key={i} className="relative flex flex-col items-center text-center px-1">
          {i < 2 && <span className="absolute top-7 left-[62%] w-[76%] border-t-2 border-dashed border-slate-200 dark:border-slate-700" />}
          <span className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${s.grad} flex items-center justify-center text-white shadow-lg rotate-[-4deg]`}>
            <Ico d={s.icon} className="w-6 h-6" />
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-slate-900 text-[11px] font-black text-slate-800 dark:text-white flex items-center justify-center shadow ring-1 ring-slate-100 dark:ring-slate-700">{i + 1}</span>
          </span>
          <p className="mt-2.5 text-[12px] leading-snug font-semibold text-slate-600 dark:text-slate-300">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function CodeTicket({ code, onCopy, copied, onHow }) {
  const t = useT();
  return (
    <div className="relative mt-5 pt-5 border-t-2 border-dashed border-slate-200 dark:border-slate-700">
      <span className="absolute -left-[27px] -top-[13px] w-6 h-6 rounded-full bg-slate-50 dark:bg-slate-900" />
      <span className="absolute -right-[27px] -top-[13px] w-6 h-6 rounded-full bg-slate-50 dark:bg-slate-900" />
      <p className="text-center text-[13px] font-semibold text-slate-500 dark:text-slate-400">{t("invite.yourCode")}</p>
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="flex-1 h-14 rounded-2xl bg-brand-50 dark:bg-brand-900/25 border border-brand-100 dark:border-brand-800/40 flex items-center justify-center font-mono text-[22px] font-extrabold tracking-[0.18em] text-brand-700 dark:text-brand-300 select-all">
          {code}
        </div>
        <button onClick={onCopy} className={`h-14 px-5 rounded-2xl font-bold text-white transition-all active:scale-95 ${copied ? "bg-emerald-600" : "bg-brand-500"}`}>
          {copied ? <span className="flex items-center gap-1.5"><Ico d={I.check} className="w-4 h-4" sw={3} />{t("invite.copied")}</span> : t("invite.copy")}
        </button>
      </div>
      <button onClick={onHow} className="mt-3 mx-auto flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 dark:text-brand-400">
        <Ico d={I.info} className="w-4 h-4" />{t("invite.howCode")}
      </button>
    </div>
  );
}

function TierTrack({ cfg, slots, endsAt, onInvite }) {
  const t = useT();
  const now = useNow(!!endsAt);
  const cd = endsAt ? countdown(endsAt, now) : null;
  const items = tierSlots(cfg?.tiers, slots);
  const next = items.find((s) => s.isNext);
  return (
    <div className="rounded-[24px] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-slate-900 dark:text-white">{t("invite.weekRewards")}</h3>
        {cd && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/25 text-amber-700 dark:text-amber-300 px-3 py-1 text-[12px] font-bold tabular-nums">
            <Ico d={I.clock} className="w-3.5 h-3.5" />{cd.text}
          </span>
        )}
      </div>
      <div className="relative mt-5 grid grid-cols-3">
        <span className="absolute top-[26px] left-[16%] right-[16%] h-[3px] rounded-full bg-slate-100 dark:bg-slate-700" />
        <span className="absolute top-[26px] left-[16%] h-[3px] rounded-full bg-gradient-to-r from-[#5fd14a] to-[#3DA829] transition-all"
          style={{ width: `${Math.min(68, (items.filter((s) => s.filled).length / Math.max(1, items.length - 1)) * 68)}%` }} />
        {items.map((s) => (
          <div key={s.tier} className="relative flex flex-col items-center">
            {s.filled ? (
              <span className={`w-[54px] h-[54px] rounded-full flex items-center justify-center text-white font-extrabold text-[16px] shadow-lg ring-4 ring-white dark:ring-slate-800 ${s.paid ? "bg-gradient-to-br from-[#5fd14a] to-[#1f7a14]" : "bg-gradient-to-br from-amber-300 to-orange-500"}`}>
                {s.paid ? <Ico d={I.check} className="w-6 h-6" sw={3} /> : initials(s.name)}
              </span>
            ) : (
              <button onClick={onInvite} className={`w-[54px] h-[54px] rounded-full flex items-center justify-center bg-white dark:bg-slate-800 ring-4 ring-white dark:ring-slate-800 border-2 border-dashed ${s.isNext ? "border-brand-500 text-brand-500" : "border-slate-300 dark:border-slate-600 text-slate-300 dark:text-slate-600"}`}>
                <Ico d={I.plus} className="w-6 h-6" sw={2.5} />
              </button>
            )}
            <span className={`mt-2.5 px-2.5 py-0.5 rounded-lg text-[13px] font-extrabold ${s.filled || s.isNext ? "bg-brand-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-400"}`}>{naira(s.amountKobo)}</span>
            {s.filled ? <span className="mt-1.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[92px]">{s.name}</span>
              : s.isNext ? <button onClick={onInvite} className="mt-1.5 px-3 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[12px] font-bold">{t("invite.inviteNow")}</button>
              : <span className="mt-1.5 text-[12px] text-slate-400">{t("invite.toBeInvited")}</span>}
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 py-3 px-4 text-center text-[13px] font-semibold text-slate-600 dark:text-slate-300">
        {next ? t("invite.inviteOneMore", { amount: naira(next.amountKobo) }) : t("invite.allTiers")}
      </div>
    </div>
  );
}

function Stats({ totals }) {
  const t = useT();
  const cells = [
    { label: t("invite.statEarned"), value: naira(totals?.earned_kobo), cls: "text-brand-600 dark:text-brand-400" },
    { label: t("invite.statInvited"), value: String(totals?.invited ?? 0), cls: "text-slate-900 dark:text-white" },
    { label: t("invite.statProgress"), value: String(totals?.pending ?? 0), cls: "text-amber-600 dark:text-amber-400" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-card px-3 py-3.5 text-center">
          <p className={`text-[18px] font-extrabold tabular-nums ${c.cls}`}>{c.value}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400 leading-tight">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

function InviteRow({ inv, cfg }) {
  const t = useT();
  const st = inviteStage(inv, cfg?.min_spend);
  const daysLeft = Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86400000));
  const chip = {
    joined: ["bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", t("invite.stJoined")],
    spend: ["bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", t("invite.stSpend", { spent: naira(inv.spent_kobo), min: naira(cfg?.min_spend) })],
    done: inv.reward_kobo > 0
      ? (inv.paid ? ["bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300", t("invite.stPaid")] : ["bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", t("invite.stWaiting")])
      : ["bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300", t("invite.stBonusOnly")],
    expired: ["bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-400", t("invite.stExpired")],
    rejected: ["bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-300", t("invite.stRejected")],
  }[st.stage];
  const live = st.stage === "joined" || st.stage === "spend";
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className={`flex-none w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-[14px] ${st.stage === "done" ? "bg-gradient-to-br from-[#5fd14a] to-[#1f7a14] text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
        {initials(inv.name)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-[14.5px] text-slate-900 dark:text-white truncate">{inv.name}</p>
          {inv.reward_kobo > 0 && <span className={`text-[14px] font-extrabold tabular-nums ${inv.paid ? "text-brand-600 dark:text-brand-400" : "text-slate-400"}`}>+{naira(inv.reward_kobo)}</span>}
        </div>
        {live && (
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-[#5fd14a] to-[#3DA829]" style={{ width: `${st.stage === "joined" ? 6 : Math.max(8, st.pct)}%` }} />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${chip[0]}`}>{chip[1]}</span>
          {live && <span className="text-[11px] font-semibold text-slate-400">{t("invite.daysLeft", { n: daysLeft })}</span>}
        </div>
      </div>
    </div>
  );
}

function FriendBonus({ mine, cfg }) {
  const t = useT();
  if (!mine || ["expired", "rejected"].includes(mine.status)) return null;
  const pct = Math.min(100, Math.round((Number(mine.spent_kobo || 0) / Math.max(1, Number(cfg?.min_spend || 1))) * 100));
  return (
    <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 border border-amber-100 dark:border-amber-800/30 p-4">
      <Confetti opacity={0.35} />
      <p className="relative text-[12px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{t("invite.invitedBy", { name: mine.inviter_name })}</p>
      {mine.paid ? (
        <p className="relative mt-1 text-[15px] font-extrabold text-slate-900 dark:text-white">{t("invite.bonusPaid", { amount: naira(mine.bonus_kobo) })}</p>
      ) : (
        <>
          <p className="relative mt-1 text-[15px] font-extrabold text-slate-900 dark:text-white">{t("invite.bonusTitle", { amount: naira(mine.bonus_kobo) })}</p>
          <p className="relative text-[12.5px] text-slate-600 dark:text-slate-300">{t("invite.bonusBody", { min: naira(cfg?.min_spend), days: cfg?.window_days })}</p>
          <div className="relative mt-3 h-2 rounded-full bg-white/80 dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <p className="relative mt-1.5 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">{t("invite.bonusProgress", { spent: naira(mine.spent_kobo), min: naira(cfg?.min_spend) })}</p>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── the screen ─────────────────────────── */

/**
 * Full Invite & Earn page (mount it inside a full-screen overlay).
 * @param portal "owner" | "client"
 * @param onOpenWallet opens the wallet (rewards need an open wallet)
 */
export default function InviteEarn({ portal = "owner", onClose, onOpenWallet }) {
  const t = useT();
  const { data, loading, error, refresh } = useInviteDashboard(true);
  const [sheet, setSheet] = useState(null);           // "share" | "rules" | "how" | null
  const [copied, setCopied] = useState(false);
  const cfg = data?.config;
  const code = data?.code || "";
  const link = code ? inviteLink(code) : "";
  const shareText = useMemo(() => (code ? t("invite.shareText", { code, bonus: naira(cfg?.friend_bonus), link }) : ""), [code, cfg, link, t]);

  const copyCode = async () => {
    try { await navigator.clipboard?.writeText(code); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-900">
      <style>{"@keyframes slideUp{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}"}</style>
      <header className="sticky top-0 z-10 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-3 pb-2.5"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Back">
          <Ico d={I.back} className="w-6 h-6" sw={2.4} />
        </button>
        <h1 className="text-[17px] font-extrabold text-slate-900 dark:text-white">{t("invite.title")}</h1>
        <button onClick={() => setSheet("rules")} disabled={!cfg} className="px-3 h-10 rounded-full text-[14px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40">{t("invite.rules")}</button>
      </header>

      <div className="max-w-md mx-auto px-4 pt-4 pb-[max(28px,env(safe-area-inset-bottom))] space-y-4">
        {loading && !data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-[320px] rounded-[28px] bg-slate-200 dark:bg-slate-800" />
            <div className="h-[260px] rounded-[24px] bg-slate-200 dark:bg-slate-800" />
          </div>
        )}
        {error && !data && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 text-center">
            <p className="text-slate-600 dark:text-slate-300 font-semibold">{t("invite.loadError")}</p>
            <button onClick={refresh} className="mt-3 px-5 h-11 rounded-xl bg-brand-500 text-white font-bold">{t("invite.retry")}</button>
          </div>
        )}

        {data?.enabled && cfg && (
          <>
            <Hero portal={portal} cfg={cfg} endsAt={data.campaign?.ends_at} />
            <FriendBonus mine={data.mine} cfg={cfg} />

            <div className="rounded-[24px] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-card px-4 pt-5 pb-5 overflow-hidden">
              <Steps cfg={cfg} />
              <button onClick={() => setSheet("share")}
                className="mt-5 w-full h-14 rounded-2xl bg-gradient-to-r from-[#46b830] to-[#2a8a1a] text-white text-[16px] font-extrabold shadow-[0_12px_24px_-10px_rgba(42,138,26,.8)] active:scale-[.98] transition-transform flex items-center justify-center gap-2">
                <Ico d={I.share} className="w-5 h-5" sw={2.4} />
                {t("invite.cta", { amount: naira(maxRewardKobo(cfg.tiers)) })}
              </button>
              <CodeTicket code={code} copied={copied} onCopy={copyCode} onHow={() => setSheet("how")} />
            </div>

            {!data.wallet_open && (
              <div className="flex items-center gap-3 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 p-4">
                <span className="flex-none w-11 h-11 rounded-xl bg-amber-400 text-white flex items-center justify-center"><Ico d={I.wallet} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-slate-900 dark:text-white">{t("invite.openWalletTitle")}</p>
                  <p className="text-[12px] text-slate-600 dark:text-slate-300">{t("invite.openWalletBody")}</p>
                </div>
                {onOpenWallet && <button onClick={onOpenWallet} className="flex-none px-3.5 h-10 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[13px] font-bold">{t("invite.openWallet")}</button>}
              </div>
            )}

            <TierTrack cfg={cfg} slots={data.slots} endsAt={data.campaign?.ends_at} onInvite={() => setSheet("share")} />
            <Stats totals={data.totals} />

            <div className="rounded-[24px] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-card px-4 pt-4 pb-1">
              <h3 className="text-[16px] font-extrabold text-slate-900 dark:text-white">{t("invite.myInvites")}</h3>
              {data.invites?.length ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
                  {data.invites.map((inv) => <InviteRow key={inv.id} inv={inv} cfg={cfg} />)}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <span className="mx-auto w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/25 text-brand-500 flex items-center justify-center rotate-[-6deg]"><Ico d={I.gift} className="w-8 h-8" /></span>
                  <p className="mt-3 font-extrabold text-slate-800 dark:text-white">{t("invite.noInvites")}</p>
                  <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 max-w-[30ch] mx-auto">{t("invite.noInvitesSub")}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {sheet === "share" && <ShareSheet text={shareText} link={link} onClose={() => setSheet(null)} onCopied={() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }} />}
      {sheet === "rules" && <RulesSheet cfg={cfg} onClose={() => setSheet(null)} />}
      {sheet === "how" && (
        <Sheet title={t("invite.howCode")} onClose={() => setSheet(null)}>
          <p className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">{t("invite.howCodeBody")}</p>
          <div className="mt-4 rounded-2xl bg-brand-50 dark:bg-brand-900/25 p-4 font-mono text-[13px] text-brand-700 dark:text-brand-300 break-all">{link}</div>
          <button onClick={() => setSheet(null)} className="mt-5 mb-1 w-full h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">{t("invite.gotIt")}</button>
        </Sheet>
      )}
    </div>
  );
}

/* ─────────────────────────── entry points ─────────────────────────── */

/** Home-screen card that opens Invite & Earn. `cfg` from inviteConfigFromPlatform(). */
export function InviteBanner({ portal = "owner", cfg, onOpen, className = "" }) {
  const t = useT();
  if (!cfg) return null;
  return (
    <button onClick={onOpen} className={`relative w-full overflow-hidden rounded-[22px] bg-[#0b1640] text-left text-white shadow-[0_16px_32px_-14px_rgba(11,22,64,.7)] active:scale-[.99] transition-transform ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_100%,rgba(61,168,41,.6),transparent_60%)]" />
      <Confetti opacity={0.6} />
      <div className="relative flex items-end min-h-[118px]">
        <div className="flex-1 min-w-0 py-4 pl-4 pr-2">
          <span className="inline-block rounded-full bg-amber-400 text-[#0b1640] text-[10px] font-black tracking-wider px-2 py-0.5">{t("invite.promoKicker")}</span>
          <p className="mt-1.5 text-[17px] font-extrabold leading-tight">{t("invite.bannerTitle", { amount: naira(cfg.maxKobo) })}</p>
          <p className="mt-0.5 text-[12px] text-white/75">{t("invite.bannerSub", { bonus: naira(cfg.friendBonusKobo) })}</p>
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#5fd14a] text-[#0b1640] text-[12.5px] font-extrabold px-3.5 py-1.5">
            {t("invite.bannerCta")} <Ico d="M9 18l6-6-6-6" className="w-3.5 h-3.5" sw={3} />
          </span>
        </div>
        <img src={portal === "client" ? "/img/invite-client.webp" : "/img/invite-owner.webp"} alt="" className="relative h-[124px] w-auto object-contain object-bottom -mr-1" />
      </div>
    </button>
  );
}

/** The "A new way to earn" popup (OPay-style) — at most once a week per device. */
export function InvitePromoModal({ cfg, onInvite, onClose }) {
  const t = useT();
  if (!cfg) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-6" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-[340px] overflow-hidden rounded-[30px] bg-white dark:bg-slate-900 shadow-2xl animate-[slideUp_.25s_ease-out]">
        <style>{"@keyframes slideUp{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}"}</style>
        <div className="relative h-[150px] bg-[#0b1640] overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(90%_100%_at_50%_120%,rgba(61,168,41,.7),transparent_65%)]" />
          <Confetti />
          <NairaNote amount={naira(cfg.maxKobo)} scale={0.8} className="absolute left-1/2 top-[30px] -translate-x-1/2 rotate-[-4deg]" />
          <button onClick={onClose} className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center" aria-label="Close">
            <Ico d={I.x} className="w-4 h-4" sw={2.5} />
          </button>
        </div>
        <div className="px-6 pt-5 pb-6 text-center">
          <h3 className="text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white">{t("invite.promoTitle")}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">{t("invite.promoBody", { amount: naira(cfg.maxKobo) })}</p>
          <p className="mt-1 text-[12.5px] font-semibold text-brand-600 dark:text-brand-400">{t("invite.bannerSub", { bonus: naira(cfg.friendBonusKobo) })}</p>
          <button onClick={onInvite} className="mt-5 w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#46b830] to-[#2a8a1a] text-white text-[16px] font-extrabold shadow-[0_12px_24px_-10px_rgba(42,138,26,.8)] active:scale-[.98] transition-transform">
            {t("invite.promoCta")}
          </button>
          <button onClick={onClose} className="mt-2 w-full h-10 text-[13px] font-semibold text-slate-400">{t("invite.later")}</button>
        </div>
      </div>
    </div>
  );
}
