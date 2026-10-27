import { useState, useMemo, useEffect, useRef } from "react";
import { canSellPlans } from "../utils/platform";
import { useDeepLink }      from "../utils/deepLinkBus";
import Credit               from "./Credit";
import Aso                  from "./Aso";
import { useCampaigns }     from "../hooks/useCampaigns";
import AnnouncementBarSlot  from "../components/slots/AnnouncementBarSlot";
import CoopList             from "./CoopList";
import Invoices             from "./Invoices";
import LoanApplicationModal from "../components/LoanApplicationModal";
import { canDo, getLowestPlanWithFeature } from "../utils/plans";
import { fmt, isBillPayment } from "../utils/helpers";
import { AmountDisplay }    from "../components/shared/AmountDisplay";
import { compute, computeCapital } from "../lib/profitEngine";
import { supabase } from "../utils/supabase";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useT } from "../contexts/LanguageContext";
import GlassIcon, { GLASS } from "../components/GlassIcon";
import PosterStudio from "../components/PosterStudio";
import { POSTER_ICON } from "../components/WalletPanel";

/* ── Period config ───────────────────────────────────────────────────────────── */
// label = translation key
const PERIODS = [
  { key: "today", label: "finance.periodToday" },
  { key: "week",  label: "finance.periodWeek"  },
  { key: "month", label: "finance.periodMonth" },
  { key: "year",  label: "finance.periodYear"  },
];

/* ── Cut-out person on the P&L card (hidden if the photo can't load) ── */
function FinanceHeroPhoto() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img src="/img/people/finance.webp" alt="" onError={() => setOk(false)}
      className="pointer-events-none absolute right-1 top-[44px] h-[132px] w-auto object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,.35)]" />
  );
}

/* ── Finance tool tiles (icons only — backgrounds via card language); label = translation key ── */
const FINANCE_TILES = [
  {
    id: "credit", label: "finance.tileCredit",
    icon: "M2 8a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V8z|M2 11h20|M6 15h3",
    g: GLASS.rose, bg: "bg-rose-100 dark:bg-rose-900/30", color: "#e11d48",
  },
  {
    id: "ajo", label: "finance.tileAjo",
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
    g: GLASS.brand, bg: "bg-brand-100 dark:bg-brand-900/30", color: "#3DA829",
  },
  {
    id: "loan", label: "finance.tileLoan",
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    g: GLASS.emerald, bg: "bg-emerald-100 dark:bg-emerald-900/30", color: "#059669",
  },
  {
    id: "org", label: "finance.tileOrg",
    icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
    g: GLASS.amber, bg: "bg-amber-100 dark:bg-amber-900/30", color: "#d97706",
  },
  {
    id: "invoices", label: "finance.tileInvoices",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
    g: GLASS.pink, bg: "bg-pink-100 dark:bg-pink-900/30", color: "#ec4899",
  },
];

// translation keys
const SECTION_LABELS = {
  credit: "finance.tileCredit", ajo: "finance.tileAjo", loan: "finance.tileLoan",
  org: "finance.tileOrg", invoices: "finance.tileInvoices",
};

/* ── Period boundary helpers (client-side, no RPC) ──────────────────────────── */
function getPeriodStart(period) {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week")  { const d = new Date(now); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d; }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

function parseTxDate(tx) {
  return tx.transaction_date
    ? new Date(tx.transaction_date + "T00:00:00")
    : new Date(tx.created_at);
}

function filterByRange(txns, start, end) {
  return txns.filter(t => { const d = parseTxDate(t); return d >= start && d < end; });
}

function buildSparkData(txns, days = 7) {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const dateStr = d.toISOString().slice(0, 10);
    const day = txns.filter(t => t.transaction_date === dateStr);
    const inA  = day.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const outA = day.filter(t => t.type === "out" && !isBillPayment(t)).reduce((s, t) => s + t.amount, 0);
    return inA - outA;
  });
}

/* ── Sparkline ───────────────────────────────────────────────────────────────── */
function Sparkline({ data }) {
  const W = 200, H = 36;
  if (!data || data.length < 2) return null;
  const nonZero = data.some(v => v !== 0);
  if (!nonZero) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - 4 - ((v - min) / range) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastVal  = data[data.length - 1];
  const lineClr  = lastVal >= 0 ? "#4ABA34" : "#ef4444";
  const areaPath = `0,${H} ${pts.join(" ")} ${W},${H}`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineClr} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineClr} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPath} fill="url(#spkGrad)" />
      <polyline points={pts.join(" ")} fill="none" stroke={lineClr}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={W} cy={pts[pts.length - 1].split(",")[1]} r="3"
        fill={lineClr} />
    </svg>
  );
}

/* ── Tiny SVG ────────────────────────────────────────────────────────────────── */
function Svg({ d, size = 16, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ── Circular progress ring (dark-mode aware) ────────────────────────────────── */
function ProgressRing({ pct, size = 120, stroke = 10, color = "#3DA829", children }) {
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/* ── Section header with back button ─────────────────────────────────────────── */
function SectionHeader({ title, onBack }) {
  return (
    <div className="sticky top-0 z-[30] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
      <button onClick={onBack}
        className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
        <Svg d="M19 12H5|M12 5l-7 7 7 7" size={16} sw={2.5} />
      </button>
      <p className="font-bold text-slate-800 dark:text-white text-base">{title}</p>
    </div>
  );
}

/* ── Loan T&C text: finance.loanTerms (src/i18n/finance.js) ─────────────────── */

const LOAN_TC_KEY = "kt_loan_tc_accepted";

// title/body = translation keys
const ENCOURAGE_MSGS = [
  { icon: "M12 5v14|M5 12l7-7 7 7", title: "finance.enc1Title", body: "finance.enc1Body" },
  { icon: "M12 2v20|M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", title: "finance.enc2Title", body: "finance.enc2Body" },
  { icon: "M23 6l-9.5 9.5-5-5L1 18|M17 6h6v6", title: "finance.enc3Title", body: "finance.enc3Body" },
  { icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z", title: "finance.enc4Title", body: "finance.enc4Body" },
  { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75", title: "finance.enc5Title", body: "finance.enc5Body" },
  { icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", title: "finance.enc6Title", body: "finance.enc6Body" },
];

/* ── Loan sub-screen ─────────────────────────────────────────────────────────── */
function LoanTab({ isEnterprise, accountCreatedAt, onUpgrade, onApply, store }) {
  const t = useT();
  const [showTC,     setShowTC]    = useState(false);
  const [, setTcAccepted] = useState(() => localStorage.getItem(LOAN_TC_KEY) === "1");
  const [msgIdx,     setMsgIdx]    = useState(0);
  const [countdown,  setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  const timerR = useRef(null);

  const transactions = store?.transactions || [];
  const credits      = store?.credits      || [];
  const asoClients   = store?.asoClients   || [];

  const REQUIRED_DAYS = 120;
  const createdMs  = accountCreatedAt ? new Date(accountCreatedAt).getTime() : Date.now();
  const targetMs   = createdMs + REQUIRED_DAYS * 24 * 60 * 60 * 1000;
  const nowMs      = Date.now();
  const daysActive = Math.floor((nowMs - createdMs) / (24 * 60 * 60 * 1000));
  const eligible   = daysActive >= REQUIRED_DAYS;
  const progressPct = Math.min(100, Math.round((daysActive / REQUIRED_DAYS) * 100));

  const totalTxns    = transactions.length;
  const now30        = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const recentTxns   = transactions.filter(t => new Date(t.transaction_date) >= now30).length;
  const distinctDays = new Set(transactions.map(t => t.transaction_date?.slice(0, 10))).size;
  const cashIn       = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const activityScore = Math.min(100, Math.round(
    (Math.min(totalTxns, 100) / 100) * 40 +
    (Math.min(recentTxns, 30) / 30) * 30 +
    (Math.min(distinctDays, 60) / 60) * 30
  ));
  const loanTier = activityScore >= 80 ? "₦3,000,000 – ₦5,000,000+"
    : activityScore >= 50 ? "₦1,000,000 – ₦3,000,000"
    : activityScore >= 25 ? "₦250,000 – ₦1,000,000"
    : "₦100,000 – ₦250,000";
  useEffect(() => {
    const id = setInterval(() => setMsgIdx(i => (i + 1) % ENCOURAGE_MSGS.length), 6000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (eligible) return;
    const tick = () => {
      const rem = Math.max(0, targetMs - Date.now());
      setCountdown({
        days:  Math.floor(rem / (24 * 60 * 60 * 1000)),
        hours: Math.floor((rem % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)),
        mins:  Math.floor((rem % (60 * 60 * 1000)) / (60 * 1000)),
        secs:  Math.floor((rem % (60 * 1000)) / 1000),
      });
    };
    tick();
    timerR.current = setInterval(tick, 1000);
    return () => clearInterval(timerR.current);
  }, [eligible, targetMs]);

  const acceptTC = () => {
    localStorage.setItem(LOAN_TC_KEY, "1");
    setTcAccepted(true);
    setShowTC(false);
    onApply();
  };

  const msg = ENCOURAGE_MSGS[msgIdx];

  /* ── Not on enterprise plan ──────────────────────────────────────────────── */
  if (!isEnterprise) {
    return (
      <div className="px-4 pt-6 pb-28">
        <div className="rounded-3xl overflow-hidden mb-5 bg-gradient-to-br from-navy-500 to-navy-600">
          <div className="px-5 py-6 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-60 mb-2">{t("finance.tileLoan")}</p>
            <p className="text-4xl font-black mb-1">₦5,000,000+</p>
            <p className="text-sm opacity-70">{t("finance.loanQuickFinancing")}</p>
          </div>
          <div className="bg-black/20 px-5 py-3 flex items-center gap-2">
            <Svg d="M7 11V7a5 5 0 0110 0v4|M3 11h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" size={14} color="white" sw={2.5} />
            <p className="text-xs text-white/70 font-semibold">{t("finance.loanEnterpriseRequired")}</p>
          </div>
        </div>
        <div className="space-y-2.5 mb-6">
          {ENCOURAGE_MSGS.slice(0, 3).map(m => (
            <div key={m.title} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
                <Svg d={m.icon} size={16} color="#3DA829" sw={2} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t(m.title)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{t(m.body)}</p>
              </div>
            </div>
          ))}
        </div>
        {canSellPlans() && (
          <button onClick={onUpgrade}
            className="w-full py-4 rounded-2xl font-bold text-sm text-white shadow-md active:scale-95 transition bg-brand-600 hover:bg-brand-700">
            {t("finance.loanUpgradeUnlock", { plan: getLowestPlanWithFeature("loanAccess")?.name ?? "Enterprise" })}
          </button>
        )}
      </div>
    );
  }

  /* ── T&C Modal ────────────────────────────────────────────────────────────── */
  const TCModal = () => (
    <div className="fixed inset-0 z-sub-sheet bg-black/70 flex flex-col items-center justify-end backdrop-blur-sm"
      onClick={() => setShowTC(false)}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl flex flex-col"
        style={{ maxHeight: "92dvh" }} onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <p className="text-base font-black text-slate-800 dark:text-white">{t("finance.loanTermsTitle")}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t("finance.loanTermsRead")}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4"
          style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          <pre className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">
            {t("finance.loanTerms")}
          </pre>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
          <button onClick={acceptTC}
            className="w-full py-4 rounded-2xl font-bold text-sm text-white mb-2 active:scale-95 transition bg-brand-600 hover:bg-brand-700">
            {t("finance.loanAccept")}
          </button>
          <button onClick={() => setShowTC(false)}
            className="w-full py-3 rounded-2xl font-semibold text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:scale-95 transition">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Not yet eligible — countdown ────────────────────────────────────────── */
  if (!eligible) {
    return (
      <div className="px-4 pt-5 pb-28">
        {showTC && <TCModal />}

        <div className="rounded-3xl overflow-hidden mb-5 shadow-lg bg-gradient-to-br from-slate-800 to-slate-900">
          <div className="px-5 pt-5 pb-1 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-50 mb-1">{t("finance.loanUnlocksIn")}</p>
            <p className="text-4xl font-black mb-1 text-green-400">₦5,000,000+</p>
            <p className="text-xs opacity-50 mb-4">{t("finance.loanAvailable120")}</p>
          </div>
          <div className="grid grid-cols-4 gap-2 px-5 pb-5">
            {[
              { val: countdown.days,  label: t("finance.cdDays")    },
              { val: countdown.hours, label: t("finance.cdHours")   },
              { val: countdown.mins,  label: t("finance.cdMinutes") },
              { val: countdown.secs,  label: t("finance.cdSeconds") },
            ].map(({ val, label }) => (
              <div key={label} className="bg-white/10 rounded-2xl py-3 text-center">
                <p className="text-2xl font-black text-white tabular-nums">{String(val).padStart(2, "0")}</p>
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-50 text-white mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">{t("finance.loanEligibilityProgress")}</p>
          <div className="flex items-center gap-5">
            <ProgressRing pct={progressPct} size={100} stroke={9} color="#3DA829">
              <p className="text-xl font-black text-slate-800 dark:text-white">{progressPct}%</p>
              <p className="text-[9px] text-slate-400 font-bold">{t("common.done")}</p>
            </ProgressRing>
            <div className="flex-1 space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{t("finance.loanDaysActive")}</p>
                  <p className="text-[11px] font-black text-brand-600">{daysActive}/{REQUIRED_DAYS}</p>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{t("finance.loanActivityScore")}</p>
                  <p className="text-[11px] font-black text-blue-600">{activityScore}/100</p>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${activityScore}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-3 border border-brand-100 dark:border-brand-800/40">
            <p className="text-[10px] font-bold text-brand-700 dark:text-brand-400 uppercase tracking-wider mb-0.5">{t("finance.loanMayQualify")}</p>
            <p className="text-lg font-black text-brand-700 dark:text-brand-300">{loanTier}</p>
            <p className="text-[10px] text-brand-600/70 dark:text-brand-400/60 mt-0.5">{t("finance.loanKeepRecording")}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { label: t("finance.loanStatTransactions"), val: totalTxns,    color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-900/20"   },
            { label: t("finance.loanStatLast30"),  val: recentTxns,  color: "text-brand-600 dark:text-brand-400", bg: "bg-brand-50 dark:bg-brand-900/20" },
            { label: t("finance.loanStatCreditRecords"), val: credits.length, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-3 border border-slate-100 dark:border-slate-700/30 text-center`}>
              <p className={`text-xl font-black tabular-nums ${s.color}`}>{s.val}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl px-5 py-4 border border-slate-100 dark:border-slate-700/50 shadow-card mb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
              <Svg d={msg.icon} size={16} color="#3DA829" sw={2} />
            </div>
            <div>
              <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{t(msg.title)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t(msg.body)}</p>
            </div>
          </div>
          <div className="flex gap-1 mt-3 justify-center">
            {ENCOURAGE_MSGS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${i === msgIdx ? "w-5 bg-brand-500" : "w-1.5 bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">{t("finance.loanPartnersAnalyse")}</p>
          <div className="space-y-2">
            {[
              { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 13h6|M9 17h4", text: t("finance.loanCheckConsistency"), done: totalTxns >= 30 },
              { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: t("finance.loanCheckCashflow"), done: cashIn > 0 },
              { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8", text: t("finance.loanCheckCredit"), done: credits.length > 0 },
              { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75", text: t("finance.loanCheckAjo"), done: asoClients.length > 0 },
              { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: t("finance.loanCheck120"), done: eligible },
            ].map(item => (
              <div key={item.text} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${item.done ? "bg-brand-100 dark:bg-brand-900/30" : "bg-slate-100 dark:bg-slate-700"}`}>
                  {item.done
                    ? <Svg d="M20 6L9 17l-5-5" size={12} color="#3DA829" sw={3} />
                    : <Svg d="M12 2a10 10 0 100 20 10 10 0 000-20" size={12} color="#94a3b8" sw={2.5} />
                  }
                </div>
                <p className={`text-xs font-semibold ${item.done ? "text-brand-700 dark:text-brand-400" : "text-slate-500 dark:text-slate-400"}`}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Eligible — ready to apply ───────────────────────────────────────────── */
  return (
    <div className="px-4 pt-5 pb-28">
      {showTC && <TCModal />}

      <div className="rounded-3xl overflow-hidden mb-5 shadow-xl bg-gradient-to-br from-navy-700 to-navy-500">
        <div className="px-5 pt-6 pb-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <Svg d="M9 12l2 2 4-4" size={12} color="white" sw={2.5} />
            </div>
            <p className="text-xs font-bold text-white/60 uppercase tracking-widest">{t("finance.loanYoureEligible")}</p>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-50 mb-1">{t("finance.loanAccess")}</p>
          <p className="text-5xl font-black mb-1">₦5,000,000</p>
          <p className="text-sm opacity-60">{t("finance.loanOrMore")}</p>
        </div>
        <div className="bg-white/10 px-5 py-3 flex items-center justify-between">
          <p className="text-xs text-white/60 font-semibold">{t("finance.loanActivityScore")}</p>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full" style={{ width: `${activityScore}%` }} />
            </div>
            <p className="text-xs text-white font-black">{activityScore}/100</p>
          </div>
        </div>
      </div>

      <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-5 py-4 mb-4 border border-brand-200 dark:border-brand-800/40">
        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-400 uppercase tracking-wider mb-1">{t("finance.loanEstimatedRange")}</p>
        <p className="text-2xl font-black text-brand-800 dark:text-brand-300">{loanTier}</p>
        <p className="text-xs text-brand-700/60 dark:text-brand-400/60 mt-1">{t("finance.loanFinalAmount")}</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">{t("finance.loanBusinessProfile")}</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t("finance.loanDaysActive"),        val: daysActive,          color: "text-emerald-600 dark:text-emerald-400" },
            { label: t("finance.loanTotalTransactions"), val: totalTxns,           color: "text-blue-600 dark:text-blue-400" },
            { label: t("finance.loanLast30Days"),       val: t("finance.loanNTxns", { n: recentTxns }), color: "text-brand-600 dark:text-brand-400" },
            { label: t("finance.loanTotalRevenue"),      val: fmt(cashIn),         color: "text-slate-800 dark:text-white" },
            { label: t("finance.loanCreditRecords"),     val: credits.length,      color: "text-amber-600 dark:text-amber-400" },
            { label: t("finance.loanAjoClients"),        val: asoClients.length,   color: "text-indigo-600 dark:text-indigo-400" },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide mb-0.5">{s.label}</p>
              <p className={`text-base font-black tabular-nums ${s.color}`}>{s.val}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 mb-5">
        {[
          { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", text: t("finance.loanFeatFast"),    sub: t("finance.loanFeatFastSub") },
          { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: t("finance.loanFeatRates"), sub: t("finance.loanFeatRatesSub") },
          { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: t("finance.loanFeatCollateral"),             sub: t("finance.loanFeatCollateralSub") },
          { icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", text: t("finance.loanFeatRepay"),     sub: t("finance.loanFeatRepaySub") },
        ].map(f => (
          <div key={f.text} className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700/50 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
              <Svg d={f.icon} size={16} color="#3DA829" sw={2} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{f.text}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">{f.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl px-5 py-4 border border-slate-100 dark:border-slate-700/50 shadow-card mb-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <Svg d={msg.icon} size={16} color="#3DA829" sw={2} />
          </div>
          <div>
            <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{t(msg.title)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t(msg.body)}</p>
          </div>
        </div>
      </div>

      <div className="w-full py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700">
        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t("finance.loanBusinessLoans")}</span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
          {t("finance.comingSoon")}
        </span>
      </div>
    </div>
  );
}

/* ── Expense category label map ──────────────────────────────────────────────── */
// credit status (stored value) -> translation key for the pill
const CREDIT_STATUS = { active: "finance.cstatusActive", overdue: "finance.cstatusOverdue", paid: "finance.cstatusPaid", partially_paid: "finance.cstatusPartial" };

// translation keys; any other category is the business's own name, shown as-is
const CAT_LABEL = { expense: "finance.catExpense", stock: "finance.catStock", other: "finance.catOther" };

/* ── Business Position lens sub-components ───────────────────────────────────── */

function LensToggle({ value, onChange }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
      {["profit", "cash"].map(k => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition min-h-[44px] ${
            value === k
              ? "bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm"
              : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {k === "profit" ? t("finance.lensProfit") : t("finance.lensCash")}
        </button>
      ))}
    </div>
  );
}

function PLRow({ label, amount, sign = 1, isSub = false, onDrill, note }) {
  const displayAmt = sign < 0 && amount > 0 ? -amount : amount;
  return (
    <div
      role={onDrill ? "button" : undefined}
      tabIndex={onDrill ? 0 : undefined}
      onClick={onDrill}
      className={[
        "flex items-center gap-2 py-2.5 min-h-[44px]",
        isSub ? "border-t border-slate-100 dark:border-slate-700/60 mt-1 pt-3" : "",
        onDrill ? "cursor-pointer active:bg-slate-50 dark:active:bg-slate-700/30 rounded-xl px-2 -mx-2 transition-colors" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate leading-tight ${
          isSub
            ? "font-extrabold text-slate-800 dark:text-white"
            : "font-semibold text-slate-600 dark:text-slate-300"
        }`}>{label}</p>
        {note && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">{note}</p>}
      </div>
      <span className={`text-sm tabular-nums flex-shrink-0 ${
        isSub ? "font-extrabold" : "font-bold"
      } ${
        displayAmt < 0 ? "text-red-500 dark:text-red-400" :
        displayAmt > 0 ? "text-slate-800 dark:text-white" :
        "text-slate-400 dark:text-slate-500"
      }`}>
        {displayAmt < 0 && "−"}{fmt(Math.abs(displayAmt))}
      </span>
      {onDrill && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600 flex-shrink-0">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

function StreamRow({ label, amount, sign = 1, isLiability = false, isWarning = false, isSub = false, onDrill }) {
  const displayAmt = sign < 0 ? -amount : amount;
  return (
    <div
      role={onDrill ? "button" : undefined}
      tabIndex={onDrill ? 0 : undefined}
      onClick={onDrill}
      className={[
        "flex items-center gap-2 py-2.5 min-h-[44px]",
        isSub ? "border-t border-slate-100 dark:border-slate-700/60 mt-1 pt-3" : "",
        onDrill ? "cursor-pointer active:bg-slate-50 dark:active:bg-slate-700/30 rounded-xl px-2 -mx-2 transition-colors" : "",
      ].filter(Boolean).join(" ")}
    >
      {isLiability && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
      {isWarning   && <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
      <p className={`flex-1 min-w-0 text-sm truncate ${
        isSub
          ? "font-extrabold text-slate-800 dark:text-white"
          : "font-semibold text-slate-600 dark:text-slate-300"
      }`}>{label}</p>
      <span className={`text-sm tabular-nums flex-shrink-0 ${
        isSub ? "font-extrabold" : "font-bold"
      } ${
        isWarning   ? "text-red-500 dark:text-red-400" :
        isLiability ? "text-amber-600 dark:text-amber-400" :
        displayAmt < 0 ? "text-red-500 dark:text-red-400" :
        "text-slate-800 dark:text-white"
      }`}>
        {displayAmt < 0 && "−"}{fmt(Math.abs(displayAmt))}
      </span>
      {onDrill && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600 flex-shrink-0">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

const SkeletonRow = () => (
  <div className="flex items-center justify-between py-2.5 min-h-[44px]">
    <div className="h-3.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" style={{ width: "80px" }} />
    <div className="h-3.5 w-20 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
  </div>
);

function ProfitCard({ engine, loading, onDrill, onInfo }) {
  const t = useT();
  if (loading) return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
      {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );

  const { revenue, cogs, grossProfit, expenses, netProfit, unmeasured } = engine.profit;
  const { interestEarned } = engine.cash.byStream;
  const drill = (label, d) => d.txIds.length ? () => onDrill({ label, amount: d.amount, txIds: d.txIds, meta: d.meta }) : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
      <PLRow label={t("finance.plRevenue")} amount={revenue.amount} onDrill={drill(t("finance.plRevenue"), revenue)} />
      {interestEarned.amount > 0 && (
        <PLRow label={t("finance.plInterest")} amount={interestEarned.amount} onDrill={drill(t("finance.plInterest"), interestEarned)} />
      )}
      {cogs.amount > 0 && (
        <PLRow label={t("finance.plCogs")} amount={cogs.amount} sign={-1} onDrill={drill(t("finance.plCogs"), cogs)} />
      )}
      {cogs.amount > 0 && (
        <PLRow label={t("finance.plGross")} amount={grossProfit.amount} isSub />
      )}
      {expenses.amount > 0 && (
        <PLRow label={t("finance.plExpenses")} amount={expenses.amount} sign={-1} onDrill={drill(t("finance.plExpenses"), expenses)} />
      )}
      <PLRow label={t("finance.plNet")} amount={netProfit.amount} isSub />

      {unmeasured.count > 0 && (
        <div className="mt-3 pt-3 border-t border-dashed border-amber-200 dark:border-amber-700/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 leading-tight">
                {t(unmeasured.count !== 1 ? "finance.unmeasuredMany" : "finance.unmeasuredOne", { n: unmeasured.count })}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">
                {t("finance.setCostPrices")}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmt(unmeasured.revenue)}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">{t("finance.revenueOnly")}</p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={onInfo}
        className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 w-full text-left flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 font-semibold"
      >
        {t("finance.howCalculated")}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

function CashCard({ engine, loading, onDrill }) {
  const t = useT();
  if (loading) return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
      {[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );

  const { in: cashIn, out: cashOut, net: cashNet, byStream } = engine.cash;
  const { ajoHeld, ajoReleased } = engine.liabilities;
  const drill = (label, d) => d?.txIds?.length ? () => onDrill({ label, amount: d.amount, txIds: d.txIds, meta: d.meta }) : null;
  const hasAjo         = ajoHeld.amount > 0 || ajoReleased.amount > 0;
  const hasFailedBills = (byStream.failedBills?.amount || 0) > 0;

  const inflows = [
    [t("finance.cfSales"),            byStream.sales],
    [t("finance.cfCreditSales"),      byStream.creditSales],
    [t("finance.cfDebtRepayments"),   byStream.creditRepayments],
    [t("finance.cfInvoicePayments"),  byStream.invoicePayments],
    [t("finance.cfAjoFees"),          byStream.ajoFeeIncome],
  ].filter(([, d]) => d.amount > 0);

  const outflows = [
    [t("finance.cfExpenses"),         byStream.expenses,      -1],
    [t("finance.cfStockPurchases"),   byStream.stockInvestment,-1],
    [t("finance.cfBillPayments"),     byStream.billPayments,  -1],
  ].filter(([, d]) => d.amount > 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
      {inflows.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">{t("finance.moneyIn")}</p>
          {inflows.map(([label, d]) => (
            <StreamRow key={label} label={label} amount={d.amount} onDrill={drill(label, d)} />
          ))}
          <StreamRow label={t("finance.cfTotalIn")} amount={cashIn.amount} isSub />
        </>
      )}

      {outflows.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-4 mb-1">{t("finance.moneyOut")}</p>
          {outflows.map(([label, d, sign]) => (
            <StreamRow key={label} label={label} amount={d.amount} sign={sign} onDrill={drill(label, d)} />
          ))}
          <StreamRow label={t("finance.cfTotalOut")} amount={cashOut.amount} sign={-1} isSub />
        </>
      )}

      <StreamRow label={t("finance.cfNet")} amount={cashNet.amount} isSub />

      {hasFailedBills && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 dark:text-red-400 mt-4 mb-1">
            {t("finance.cfFailedBillsTitle")}
          </p>
          <StreamRow
            label={t("finance.cfFailedBills")}
            amount={byStream.failedBills.amount}
            isWarning
            onDrill={drill(t("finance.cfFailedBillPayments"), byStream.failedBills)}
          />
        </>
      )}

      {hasAjo && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 dark:text-amber-400 mt-4 mb-1">
            {t("finance.cfClientSavings")}
          </p>
          {ajoHeld.amount > 0 && <StreamRow label={t("finance.cfHeldInTrust")} amount={ajoHeld.amount} isLiability />}
          {ajoReleased.amount > 0 && <StreamRow label={t("finance.cfReleased")} amount={ajoReleased.amount} isLiability />}
        </>
      )}
    </div>
  );
}

function DrillDownSheet({ label, txIds, transactions, invoices, meta, onClose }) {
  const t = useT();
  const txMap = useMemo(
    () => new Map((transactions || []).map(t => [t.id, t])),
    [transactions],
  );
  const invPmtMap = useMemo(() => {
    const m = new Map();
    (invoices || []).forEach(inv => {
      (inv.invoice_payments || []).forEach(p => {
        m.set(`inv-${p.id}`, { amount: (p.amount_kobo || 0) / 100, date: (p.payment_date || p.created_at || "").slice(0, 10), ref: inv.invoice_number || inv.id?.slice(0, 8) });
      });
    });
    return m;
  }, [invoices]);

  const items = useMemo(() =>
    txIds.map(id => {
      if (txMap.has(id)) {
        const tx = txMap.get(id);
        return {
          id,
          label:  tx.item_name?.trim() || tx.customer_name?.trim() || tx.category || t("finance.ddTransaction"),
          amount: tx.amount,
          date:   tx.transaction_date || tx.created_at?.slice(0, 10),
          type:   tx.type,
          failed: tx.bill_status === "failed",
        };
      }
      if (invPmtMap.has(id)) {
        const p = invPmtMap.get(id);
        return { id, label: t("finance.ddInvoice", { ref: p.ref }), amount: p.amount, date: p.date };
      }
      if (meta?.has(id)) {
        const m = meta.get(id);
        // the engine labels interest rows "Interest — <customer>" (English); show that prefix in the chosen language
        const label = String(m.label || "").startsWith("Interest — ") ? t("finance.ddInterestFor", { name: m.label.slice("Interest — ".length) }) : m.label;
        return { id, label, amount: m.amount, date: m.date };
      }
      return null;
    }).filter(Boolean),
  [txIds, txMap, invPmtMap, meta, t]);

  const total = items.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-t-3xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">{label}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t(items.length !== 1 ? "finance.ddItemsSumMany" : "finance.ddItemsSumOne", { n: items.length, sum: fmt(total) })}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 min-w-[32px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          {items.length === 0 && (
            <p className="text-sm text-slate-400 py-6 text-center">{t("finance.ddNoItems")}</p>
          )}
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{item.label}</p>
                  {item.failed && (
                    <span className="flex-shrink-0 text-[9px] bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full font-bold leading-none">
                      {t("finance.rl_failed")}
                    </span>
                  )}
                </div>
                {item.date && <p className="text-[10px] text-slate-400 mt-0.5">{item.date}</p>}
              </div>
              <p className={`text-sm font-bold tabular-nums flex-shrink-0 ${
                item.failed  ? "text-red-400 dark:text-red-500 line-through" :
                item.type === "out" ? "text-red-500 dark:text-red-400" :
                item.type === "in"  ? "text-green-600 dark:text-green-400" :
                "text-slate-700 dark:text-slate-200"
              }`}>{fmt(item.amount)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoSheet({ onClose }) {
  const t = useT();
  const rules = [
    {
      title: t("finance.info1Title"),
      body: t("finance.info1Body"),
    },
    {
      title: t("finance.info2Title"),
      body: t("finance.info2Body"),
    },
    {
      title: t("finance.info3Title"),
      body: t("finance.info3Body"),
    },
    {
      title: t("finance.info4Title"),
      body: t("finance.info4Body"),
    },
    {
      title: t("finance.info5Title"),
      body: t("finance.info5Body"),
    },
    {
      title: t("finance.info6Title"),
      body: t("finance.info6Body"),
    },
    {
      title: t("finance.info7Title"),
      body: t("finance.info7Body"),
    },
    {
      title: t("finance.info8Title"),
      body: t("finance.info8Body"),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{t("finance.howCalculated")}</p>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 min-w-[32px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] space-y-5">
          {rules.map(r => (
            <div key={r.title}>
              <p className="text-xs font-extrabold text-slate-900 dark:text-white mb-1">{r.title}</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main Finance component ──────────────────────────────────────────────────── */
export default function Finance({
  store, plan, onUpgrade,
  autoOpenTab, onAutoOpened,
  userId, session,
  onSelectCoopOrg,
  inventory,
  invoiceHook,
}) {
  const t = useT();
  const [section,   setSection]   = useState(autoOpenTab || null);
  const [poster,    setPoster]    = useState(false);   // business-poster maker (Finance Tools)
  const [showLoan,  setShowLoan]  = useState(false);
  const { loansEnabled, coopEnabled } = usePlatformConfig();   // co-operatives: hidden until coop_module_enabled (was reachable here, incl. its Paystack registration fee)          // business loans: off ("coming soon", no tile, no application) until the lender is live
  const [period,    setPeriod]    = useState("month");
  const [lens,      setLens]      = useState("profit");
  const [drillDown, setDrillDown] = useState(null);
  const [showInfo,  setShowInfo]  = useState(false);

  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } =
    useCampaigns(["announcement_bar", "upsell_inline"], "business", "business.finance");
  const financeAnnBars = camSlots.announcement_bar || [];

  useEffect(() => {
    if (autoOpenTab) {
      setSection(autoOpenTab);
      onAutoOpened?.();
    }
  }, [autoOpenTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const credits         = store.credits    || [];
  const asoClients      = store.asoClients || [];
  const hasCreditAccess = canDo(plan, "credit");
  const isEnterprise    = canDo(plan, "loanAccess");

  const openSection = (id) => { setSection(id); onAutoOpened?.(); };

  // ── Notification deep links ─────────────────────────────────────────────────
  // { tab:"finance"|"credit"|"aso", sub?, id?, action? } → open the right section
  // and hand { sub, id, action } to it so it can open the specific record. New
  // credit/invoice templates say which via `sub`; older stored notifications only
  // carry an id, so fall back to looking it up (waiting for the data to load).
  const [pendingLink, setPendingLink] = useState(null); // claimed, section not decided yet
  const [sectionLink, setSectionLink] = useState(null); // handed to the open section
  // (The store's own arrays, not the `|| []` copy above — that one is a new array
  // every render, which would re-run this effect and reset its give-up timer.)
  const storeCredits = store.credits;
  const invoiceList  = invoiceHook?.invoices;
  useDeepLink(["finance", "credit", "aso"], (dl) => setPendingLink(dl));
  useEffect(() => {
    if (!pendingLink) return;
    let sec = null;
    if (pendingLink.tab === "credit" || pendingLink.sub === "credit") sec = "credit";
    else if (pendingLink.tab === "aso")                                sec = "ajo";
    else if (pendingLink.sub === "invoices")                           sec = "invoices";
    else if (pendingLink.id) {
      if ((storeCredits || []).some(c => c.id === pendingLink.id))     sec = "credit";
      else if ((invoiceList || []).some(i => i.id === pendingLink.id)) sec = "invoices";
    }
    if (sec) { setSection(sec); setSectionLink(pendingLink); setPendingLink(null); return; }
    if (!pendingLink.id) { setPendingLink(null); return; } // plain overview link — nothing more to open
    const giveUp = setTimeout(() => setPendingLink(null), 6000);
    return () => clearTimeout(giveUp);
  }, [pendingLink, storeCredits, invoiceList]);

  // Ajo commission/registration/withdrawal fees live only in ajo_contributions —
  // they never get mirrored into `transactions`, so without this the P&L engine
  // silently drops all Ajo income. Fetch enough history to cover both the
  // current period and the prior period used for the trend comparison below.
  // esusu_payout is included too (remapped to "payout") so the "Released to
  // clients" liability figure in CashCard is accurate — profitEngine only
  // ever treats "payout"-type entries as a liability release, never as
  // income/cash, so this can't leak into revenue or cash flow.
  const [ajoEntries, setAjoEntries] = useState([]);
  useEffect(() => {
    if (!userId) return;
    const now        = new Date();
    const start      = getPeriodStart(period);
    const priorStart = new Date(start - (now - start));
    supabase
      .from("ajo_contributions")
      .select("id, amount, type, created_at")
      .eq("owner_id", userId)
      .in("type", ["commission", "registration_fee", "withdrawal_fee", "esusu_payout"])
      .eq("status", "completed")
      .gte("created_at", priorStart.toISOString())
      .then(({ data }) => setAjoEntries(
        (data || []).map(e => ({
          id:     e.id,
          type:   e.type === "esusu_payout" ? "payout" : e.type,
          amount: parseFloat(e.amount) || 0,
          date:   e.created_at,
        }))
      ))
      .catch(() => {});
  }, [userId, period]);

  /* ── Period-filtered P&L (client-side) ───────────────────────────────────── */
  const { netPL, cashNet,
          trendPct, trendUp, sparkData, expenseBreakdown, engine, capitalResult } = useMemo(() => {
    const transactions = store.transactions || [];
    const now          = new Date();
    const start        = getPeriodStart(period);
    const diffMs       = now - start;
    const priorStart   = new Date(start - diffMs);
    const priorEnd     = new Date(start - 1); // exclusive boundary for prior period

    const curr  = filterByRange(transactions, start, now);

    // Use profitEngine as the single source of truth for all P&L figures.
    // Revenue excludes debt repayments (those are Cash-only).
    // Expenses exclude stock purchases (inventory investment, not P&L cost).
    // Gross profit = measuredRevenue − COGS (unmeasured items excluded intentionally).
    const ledger = {
      transactions,
      invoices:     invoiceHook?.invoices   || [],
      products:     inventory?.products     || [],
      asoClients:   store.asoClients        || [],
      debtPayments: store.debtPayments      || [],
      credits:      store.credits           || [],
      ajoEntries,
    };
    const engine      = compute(ledger, { from: start,      to: now });
    const enginePrior = compute(ledger, { from: priorStart, to: priorEnd });

    const capitalSettings = store.profile?.working_capital_amount
      ? { amount_kobo: store.profile.working_capital_amount, as_of_date: store.profile.working_capital_as_of || null }
      : null;
    const capitalResult = capitalSettings ? computeCapital(ledger, capitalSettings) : null;

    const mIn    = engine.profit.revenue.amount;
    const mOut   = engine.profit.expenses.amount;
    const netNow  = engine.profit.netProfit.amount;
    const netPrev = enginePrior.profit.netProfit.amount;

    let tPct = null, tUp = null;
    if (netPrev !== 0) {
      tPct = Math.abs(Math.round(((netNow - netPrev) / Math.abs(netPrev)) * 100));
      tUp  = netNow >= netPrev;
    }

    const expMap = {};
    curr.filter(t => t.type === "out" && !isBillPayment(t)).forEach(t => {
      const cat = t.category || "other";
      expMap[cat] = (expMap[cat] || 0) + t.amount;
    });
    const expBreak = Object.entries(expMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

    return {
      moneyIn:          mIn,
      moneyOut:         mOut,
      netPL:            netNow,
      cashNet:          engine.cash.net.amount,
      inCount:          curr.filter(t => t.type === "in").length,
      outCount:         curr.filter(t => t.type === "out" && !isBillPayment(t)).length,
      trendPct:         tPct,
      trendUp:          tUp,
      sparkData:        buildSparkData(transactions),
      expenseBreakdown: expBreak,
      engine,
      capitalResult,
    };
  }, [store.transactions, store.asoClients, store.debtPayments, store.credits, store.profile, inventory?.products, invoiceHook?.invoices, period, ajoEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Finance tools summary values ─────────────────────────────────────────── */
  const creditOutstanding = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount      = credits.filter(c => c.status === "overdue").length;
  const ajoBalance        = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const ajoActive         = asoClients.filter(c => c.status === "active").length;

  /* ── Sub-section view ─────────────────────────────────────────────────────── */
  if (section && !(section === "loan" && !loansEnabled)) {
    return (
      <div className="flex flex-col min-h-full">
        <SectionHeader title={SECTION_LABELS[section] ? t(SECTION_LABELS[section]) : ""} onBack={() => { setSection(null); setSectionLink(null); }} />

        {section === "credit"  && <Credit store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded inventory={inventory} deepLink={sectionLink} onDeepLinkHandled={() => setSectionLink(null)} />}
        {section === "ajo"     && <Aso    store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded deepLink={sectionLink} onDeepLinkHandled={() => setSectionLink(null)} />}
        {section === "loan"    && (
          <LoanTab isEnterprise={isEnterprise} accountCreatedAt={session?.user?.created_at}
            onUpgrade={onUpgrade} onApply={() => setShowLoan(true)} store={store} />
        )}
        {section === "org" && coopEnabled && <CoopList userId={userId} onOpen={onSelectCoopOrg} onClose={null} embedded />}
        {section === "invoices" && (
          <Invoices invoiceHook={invoiceHook} plan={plan} onUpgrade={onUpgrade}
            profile={store.profile} inventory={inventory}
            addTransaction={store.addTransaction} userId={userId}
            deepLink={sectionLink} onDeepLinkHandled={() => setSectionLink(null)} />
        )}

        {showLoan && (
          <LoanApplicationModal session={session} profile={store.profile} onClose={() => setShowLoan(false)} />
        )}
      </div>
    );
  }

  /* Preview slices */
  const urgentCredits = hasCreditAccess
    ? [...credits].sort((a, b) => (a.status === "overdue" && b.status !== "overdue") ? -1 : (b.status === "overdue" && a.status !== "overdue") ? 1 : 0).slice(0, 2)
    : [];
  const activeAjo = asoClients.filter(c => c.status === "active").slice(0, 2);

  /* ── Finance dashboard ────────────────────────────────────────────────────── */
  return (
    <div className="px-4 pt-4 pb-28 space-y-4">
      <AnnouncementBarSlot campaigns={financeAnnBars} loading={camLoading} recordEvent={recordCamEvent} />

      {/* ── P&L Hero Card ── */}
      <div className="rounded-3xl p-5 text-white relative overflow-hidden bg-gradient-to-br from-navy-500 to-navy-600 shadow-md">
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />

        {/* Period pills */}
        <div className="flex gap-1.5 mb-4 relative">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition min-h-[28px] ${
                period === p.key
                  ? "bg-white text-navy"
                  : "bg-white/15 text-white/70 active:bg-white/25"
              }`}>
              {t(p.label)}
            </button>
          ))}
        </div>

        {/* Person photo — sits on the right of the amount, behind nothing important */}
        <FinanceHeroPhoto />

        {/* Net P&L or Net Cash — lens-aware */}
        <div className="relative mb-1 pr-[92px]">
          {(() => {
            const lensNet = lens === "profit" ? netPL : cashNet;
            return (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">
                  {lens === "profit" ? t("finance.netPL") : t("finance.netCash")}
                </p>
                <AmountDisplay
                  amount={Math.abs(lensNet)} size="hero" align="left"
                  className={lensNet >= 0 ? "text-green-400" : "text-red-400"}
                />
                {lensNet < 0 && <span className="text-red-400 text-lg font-black absolute left-0 -top-0.5">−</span>}
              </>
            );
          })()}
        </div>

        {/* Trend badge */}
        {trendPct !== null && (
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              trendUp ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
            }`}>
              {trendUp ? "↑" : "↓"} {t("finance.vsPrior", { pct: trendPct })}
            </span>
          </div>
        )}

        {/* 7-day sparkline */}
        <div className="relative mt-2 mr-[104px] opacity-80">
          <Sparkline data={sparkData} />
        </div>
      </div>

      {/* ── Working Capital status line (owner-only; hidden when feature not set) ── */}
      {capitalResult && (
        <div className={`rounded-2xl px-4 py-3 mb-3 border ${
          capitalResult.status === "healthy"
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40"
            : capitalResult.status === "amber"
            ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40"
        }`}>
          {/* Status header */}
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              capitalResult.status === "healthy" ? "bg-emerald-500"
              : capitalResult.status === "amber"  ? "bg-amber-500"
              : "bg-red-500"
            }`} />
            <p className={`text-[12px] font-bold ${
              capitalResult.status === "healthy" ? "text-emerald-700 dark:text-emerald-400"
              : capitalResult.status === "amber"  ? "text-amber-700 dark:text-amber-400"
              : "text-red-700 dark:text-red-400"
            }`}>
              {t("finance.wcTitle")} · {capitalResult.status === "healthy" ? t("finance.wcHealthy") : capitalResult.status === "amber" ? t("finance.wcCaution") : t("finance.wcShortfall")}
            </p>
          </div>
          {/* Breakdown rows */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">{t("finance.wcDeclared")}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(capitalResult.capital.amount)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">{t("finance.wcNetPL")}</span>
              <span className={`font-semibold tabular-nums ${capitalResult.netProfit.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {capitalResult.netProfit.amount >= 0 ? "+" : "−"}{fmt(Math.abs(capitalResult.netProfit.amount))}
              </span>
            </div>
            {capitalResult.stockInvested.amount > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">{t("finance.wcStockPurchased")}</span>
                <span className="font-semibold text-slate-600 dark:text-slate-300 tabular-nums">−{fmt(capitalResult.stockInvested.amount)}</span>
              </div>
            )}
            {capitalResult.unsoldStock.amount > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">{t("finance.wcStockSold")}</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">+{fmt(capitalResult.stockInvested.amount - capitalResult.unsoldStock.amount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] pt-1 mt-1 border-t border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-700 dark:text-slate-200">{t("finance.wcCashPosition")}</span>
              <span className={`font-extrabold tabular-nums ${capitalResult.position.amount >= capitalResult.capital.amount ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {fmt(capitalResult.position.amount)}
              </span>
            </div>
          </div>
          {capitalResult.unsoldStock.amount > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
              {t("finance.wcLocked", { amount: fmt(capitalResult.unsoldStock.amount) })}
            </p>
          )}
        </div>
      )}

      {/* ── Lens toggle ── */}
      <LensToggle value={lens} onChange={setLens} />

      {/* ── Business Position breakdown ── */}
      {lens === "profit" ? (
        <ProfitCard
          engine={engine}
          loading={store.loading}
          onDrill={setDrillDown}
          onInfo={() => setShowInfo(true)}
        />
      ) : (
        <CashCard
          engine={engine}
          loading={store.loading}
          onDrill={setDrillDown}
        />
      )}

      {/* ── Empty state — no transactions for this period ── */}
      {!store.loading && engine.profit.revenue.amount === 0 && engine.cash.in.amount === 0 && (
        <div className="flex flex-col items-center gap-2.5 py-7 px-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/50 shadow-card">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DA829" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300 text-center">{t("finance.noTxPeriod")}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center">{t("finance.tapPlus")}</p>
        </div>
      )}

      {/* ── Expense category breakdown (profit lens only) ── */}
      {lens === "profit" && expenseBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3.5">{t("finance.whereItWent")}</p>
          <div className="space-y-3">
            {expenseBreakdown.map(([cat, total]) => {
              const pct = Math.round((total / expenseBreakdown[0][1]) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 capitalize">
                      {CAT_LABEL[cat] ? t(CAT_LABEL[cat]) : cat}
                    </p>
                    <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">{fmt(total)}</p>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Finance Tools — card language ── */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3.5">{t("finance.financeTools")}</p>

        {/* Top row: Credit + Ajo as data cards */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => hasCreditAccess ? openSection("credit") : onUpgrade?.()}
            className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-3.5 active:scale-95 transition text-left border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
            <div className="flex items-center gap-2">
              <GlassIcon d={FINANCE_TILES[0].icon} colors={FINANCE_TILES[0].g} size={30} iconSize={14} />
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {hasCreditAccess ? t("finance.tileCredit") : `🔒 ${t("finance.tileCredit")}`}
              </p>
            </div>
            {hasCreditAccess ? (
              <>
                <AmountDisplay amount={creditOutstanding} size="small" colorBy="out" align="left" />
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {overdueCount > 0 ? `⚠ ${t("finance.nOverdue", { n: overdueCount })}` : t(credits.length !== 1 ? "finance.nRecords" : "finance.nRecord", { n: credits.length })}
                </p>
              </>
            ) : (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{canSellPlans() ? t("finance.upgradeToAccess") : t("finance.notInPlan")}</p>
            )}
          </button>

          <button
            onClick={() => openSection("ajo")}
            className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-3.5 active:scale-95 transition text-left border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
            <div className="flex items-center gap-2">
              <GlassIcon d={FINANCE_TILES[1].icon} colors={FINANCE_TILES[1].g} size={30} iconSize={14} />
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{t("finance.tileAjo")}</p>
            </div>
            <AmountDisplay amount={ajoBalance} size="small" align="left" />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {t(ajoActive !== 1 ? "finance.nActiveClients" : "finance.nActiveClient", { n: ajoActive })}
            </p>
          </button>
        </div>

        {/* Bottom row: Loan / Org / Invoices — smaller icon tiles */}
        <div className={`grid gap-2 ${[loansEnabled, coopEnabled, true].filter(Boolean).length === 3 ? "grid-cols-3" : [loansEnabled, coopEnabled, true].filter(Boolean).length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {FINANCE_TILES.slice(2).filter(tile => (tile.id !== "loan" || loansEnabled) && (tile.id !== "org" || coopEnabled)).map(tile => (
            <button key={tile.id} onClick={() => openSection(tile.id)}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 active:scale-95 transition border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
              <GlassIcon d={tile.icon} colors={tile.g} size={38} iconSize={17} />
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-center leading-tight px-1">
                {t(tile.label)}
              </span>
            </button>
          ))}
        </div>

        {/* Business posters — "Pay with transfer" and "Ajo & Esusu available", to print or share */}
        <button onClick={() => setPoster(true)}
          className="w-full mt-3 flex items-center gap-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/30 px-3.5 py-3 text-left active:scale-[0.98] transition min-h-[44px]">
          <GlassIcon d={POSTER_ICON} colors={GLASS.brand} size={34} iconSize={15} />
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-bold text-slate-700 dark:text-slate-200">{t("posters.title")}</span>
            <span className="block text-[10.5px] text-slate-400 dark:text-slate-500 truncate">{t("posters.homeSub")}</span>
          </span>
          <svg className="flex-shrink-0 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      <PosterStudio open={poster} onClose={() => setPoster(false)} profile={store.profile} initialType="ajo" />

      {/* ── Pending credits preview ── */}
      {hasCreditAccess && urgentCredits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t("finance.pendingCredits")}</p>
            <button onClick={() => openSection("credit")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">{t("finance.seeAll")}</button>
          </div>
          {urgentCredits.map(c => (
            <button key={c.id} onClick={() => openSection("credit")}
              className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 mb-2 border border-slate-100 dark:border-slate-700/50 shadow-card flex items-center gap-3 active:scale-[0.98] transition">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-black text-amber-600 dark:text-amber-400">
                  {c.customer_name?.[0]?.toUpperCase() || "?"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{c.customer_name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    c.status === "overdue"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                  }`}>{CREDIT_STATUS[c.status] ? t(CREDIT_STATUS[c.status]) : c.status}</span>
                  {c.due_date && <span className="text-[10px] text-slate-400">{t("finance.dueOn")} {new Date(c.due_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>}
                </div>
              </div>
              <AmountDisplay amount={c.outstanding} size="small" colorBy="out" align="right" className="flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* ── Active Ajo preview ── */}
      {activeAjo.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t("finance.activeAjo")}</p>
            <button onClick={() => openSection("ajo")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">{t("finance.seeAll")}</button>
          </div>
          {activeAjo.map(c => {
            const displayName = c.full_name || c.name || "";
            return (
              <button key={c.id} onClick={() => openSection("ajo")}
                className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 mb-2 border border-slate-100 dark:border-slate-700/50 shadow-card flex items-center gap-3 active:scale-[0.98] transition">
                <div className="w-10 h-10 rounded-full bg-navy-100 dark:bg-navy-900/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-black text-navy-500 dark:text-navy-300">
                    {displayName[0]?.toUpperCase() || "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{displayName}</p>
                  {c.next_contribution_date && (
                    <p className="text-[10px] text-slate-400 mt-0.5">{t("finance.nextOn")} {new Date(c.next_contribution_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</p>
                  )}
                </div>
                <AmountDisplay amount={c.current_balance || 0} size="small" align="right" className="flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Drill-down sheet ── */}
      {drillDown && (
        <DrillDownSheet
          label={drillDown.label}
          amount={drillDown.amount}
          txIds={drillDown.txIds}
          meta={drillDown.meta}
          transactions={store.transactions || []}
          invoices={invoiceHook?.invoices || []}
          onClose={() => setDrillDown(null)}
        />
      )}

      {/* ── "How is this calculated?" sheet ── */}
      {showInfo && <InfoSheet onClose={() => setShowInfo(false)} />}
    </div>
  );
}
