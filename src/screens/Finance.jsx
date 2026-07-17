import { useState, useMemo, useEffect, useRef } from "react";
import Credit               from "./Credit";
import Aso                  from "./Aso";
import { useCampaigns }     from "../hooks/useCampaigns";
import AnnouncementBarSlot  from "../components/slots/AnnouncementBarSlot";
import CoopList             from "./CoopList";
import Invoices             from "./Invoices";
import LoanApplicationModal from "../components/LoanApplicationModal";
import { canDo, getLowestPlanWithFeature } from "../utils/plans";
import { fmt }              from "../utils/helpers";
import { AmountDisplay }   from "../components/shared/AmountDisplay";

/* ── Period config ───────────────────────────────────────────────────────────── */
const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week",  label: "Week"  },
  { key: "month", label: "Month" },
  { key: "year",  label: "Year"  },
];

/* ── Finance tool tiles (icons only — backgrounds via card language) ──────────── */
const FINANCE_TILES = [
  {
    id: "credit", label: "Credit",
    icon: "M2 8a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V8z|M2 11h20|M6 15h3",
    bg: "bg-rose-100 dark:bg-rose-900/30", color: "#e11d48",
  },
  {
    id: "ajo", label: "Ajo Savings",
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
    bg: "bg-brand-100 dark:bg-brand-900/30", color: "#3DA829",
  },
  {
    id: "loan", label: "Business Loan",
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    bg: "bg-emerald-100 dark:bg-emerald-900/30", color: "#059669",
  },
  {
    id: "org", label: "Organisation",
    icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
    bg: "bg-amber-100 dark:bg-amber-900/30", color: "#d97706",
  },
  {
    id: "invoices", label: "Invoices",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
    bg: "bg-pink-100 dark:bg-pink-900/30", color: "#ec4899",
  },
];

const SECTION_LABELS = {
  credit: "Credit", ajo: "Ajo Savings", loan: "Business Loan",
  org: "Organisation", invoices: "Invoices",
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
    const outA = day.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
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

/* ── Loan T&C text ───────────────────────────────────────────────────────────── */
const LOAN_TERMS = `BUSINESS LOAN ACCESS — TERMS & CONDITIONS

1. ELIGIBILITY
You must have been an active KudiAI Track subscriber on the Enterprise Plan for at least 4 calendar months (120 days). "Active" means consistently recording business transactions, managing credit records, and keeping your business data current on the platform throughout this period.

2. DATA ANALYSIS & CONSENT
By proceeding with a loan application, you explicitly authorize KudiAI Track and its verified lending partners to securely access and analyze your business transaction history, credit records, Ajo savings data, inventory activity, and other business records on the platform. This data is the primary basis for assessing your loan eligibility and the amount you qualify for.

3. LOAN AMOUNT
Eligible businesses may be assessed for loans ranging from ₦100,000 to ₦5,000,000 or higher, depending on their recorded business activity and financial performance. The final amount approved is solely determined by our lending partners based on your platform data and credit assessment.

4. PRIVACY & DATA SECURITY
Your business data will be transmitted securely to our verified lending partners under strict confidentiality and data protection agreements in compliance with the Nigeria Data Protection Act (NDPA). Your data will not be sold, rented, or shared for any purpose other than loan assessment.

5. NO GUARANTEE OF APPROVAL
Submitting an application does not guarantee loan approval. Our lending partners reserve the right to approve, decline, or modify any application based on their credit assessment criteria.

6. REPAYMENT OBLIGATION
All approved loans must be repaid in full according to the terms communicated by the lending partner. Failure to repay may result in legal action and will be reported to relevant credit bureaus.

7. CONTINUED PLATFORM ACTIVITY
You are encouraged to continue recording all business activities on KudiAI Track throughout the duration of any loan. Continued activity may positively impact future loan eligibility and credit limits.

8. DATA ACCURACY
You confirm and warrant that all business data recorded on the platform is accurate, truthful, and representative of your actual business operations. Providing false or misleading information is grounds for immediate application cancellation and may result in legal consequences.

9. AMENDMENTS
KudiAI Track reserves the right to modify these terms at any time. Continued use of the loan access feature constitutes acceptance of any updated terms.

By tapping "I Accept & Continue", you confirm you have read, understood, and agreed to these terms and conditions.`;

const LOAN_TC_KEY = "kt_loan_tc_accepted";

const ENCOURAGE_MSGS = [
  { icon: "M12 5v14|M5 12l7-7 7 7", title: "You're building something great!", body: "Every transaction you record is building your financial profile. Our lending partners see active, consistent businesses — and they reward them with better loan limits." },
  { icon: "M12 2v20|M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", title: "Your records = your credit score!", body: "Unlike traditional banks, we don't just look at your bank statement. Every sale, every credit record, every Ajo contribution is evidence of your business strength." },
  { icon: "M23 6l-9.5 9.5-5-5L1 18|M17 6h6v6", title: "Active businesses get more!", body: "The more consistently you record your business activities, the stronger your profile becomes. Businesses with 100+ records qualify for our highest loan tiers — up to ₦5,000,000 or more." },
  { icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z", title: "Stay consistent — it pays!", body: "Our partners reward consistency. A business that records every day is far more trusted than one with gaps. Keep recording and watch your eligible amount grow." },
  { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75", title: "Partners are watching your growth!", body: "Our lending partners analyse real business data — not guesswork. Your daily records are your strongest loan application. Record every sale, every expense, every credit." },
  { icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", title: "Unlock up to ₦5,000,000!", body: "Hit 120 days of consistent activity and you'll be able to apply for up to ₦5,000,000 in business financing — with no collateral required." },
];

/* ── Loan sub-screen ─────────────────────────────────────────────────────────── */
function LoanTab({ isEnterprise, accountCreatedAt, onUpgrade, onApply, store }) {
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
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-60 mb-2">Business Loan</p>
            <p className="text-4xl font-black mb-1">₦5,000,000+</p>
            <p className="text-sm opacity-70">Quick financing — no collateral required</p>
          </div>
          <div className="bg-black/20 px-5 py-3 flex items-center gap-2">
            <Svg d="M7 11V7a5 5 0 0110 0v4|M3 11h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" size={14} color="white" sw={2.5} />
            <p className="text-xs text-white/70 font-semibold">Enterprise Plan required to access loans</p>
          </div>
        </div>
        <div className="space-y-2.5 mb-6">
          {ENCOURAGE_MSGS.slice(0, 3).map(m => (
            <div key={m.title} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
                <Svg d={m.icon} size={16} color="#3DA829" sw={2} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{m.title}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onUpgrade}
          className="w-full py-4 rounded-2xl font-bold text-sm text-white shadow-md active:scale-95 transition bg-brand-600 hover:bg-brand-700">
          Upgrade to {getLowestPlanWithFeature("loanAccess")?.name ?? "Enterprise"} — Unlock Loans
        </button>
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
          <p className="text-base font-black text-slate-800 dark:text-white">Terms & Conditions</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Read carefully before applying for a loan</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4"
          style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          <pre className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">
            {LOAN_TERMS}
          </pre>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
          <button onClick={acceptTC}
            className="w-full py-4 rounded-2xl font-bold text-sm text-white mb-2 active:scale-95 transition bg-brand-600 hover:bg-brand-700">
            I Accept & Continue to Apply
          </button>
          <button onClick={() => setShowTC(false)}
            className="w-full py-3 rounded-2xl font-semibold text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:scale-95 transition">
            Cancel
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
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-50 mb-1">Loan Access Unlocks In</p>
            <p className="text-4xl font-black mb-1 text-green-400">₦5,000,000+</p>
            <p className="text-xs opacity-50 mb-4">Available once you reach 120 days of active use</p>
          </div>
          <div className="grid grid-cols-4 gap-2 px-5 pb-5">
            {[
              { val: countdown.days,  label: "Days"    },
              { val: countdown.hours, label: "Hours"   },
              { val: countdown.mins,  label: "Minutes" },
              { val: countdown.secs,  label: "Seconds" },
            ].map(({ val, label }) => (
              <div key={label} className="bg-white/10 rounded-2xl py-3 text-center">
                <p className="text-2xl font-black text-white tabular-nums">{String(val).padStart(2, "0")}</p>
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-50 text-white mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Eligibility Progress</p>
          <div className="flex items-center gap-5">
            <ProgressRing pct={progressPct} size={100} stroke={9} color="#3DA829">
              <p className="text-xl font-black text-slate-800 dark:text-white">{progressPct}%</p>
              <p className="text-[9px] text-slate-400 font-bold">Done</p>
            </ProgressRing>
            <div className="flex-1 space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Days Active</p>
                  <p className="text-[11px] font-black text-brand-600">{daysActive}/{REQUIRED_DAYS}</p>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Activity Score</p>
                  <p className="text-[11px] font-black text-blue-600">{activityScore}/100</p>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${activityScore}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-3 border border-brand-100 dark:border-brand-800/40">
            <p className="text-[10px] font-bold text-brand-700 dark:text-brand-400 uppercase tracking-wider mb-0.5">Based on current activity, you may qualify for</p>
            <p className="text-lg font-black text-brand-700 dark:text-brand-300">{loanTier}</p>
            <p className="text-[10px] text-brand-600/70 dark:text-brand-400/60 mt-0.5">Keep recording to increase your limit!</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { label: "Transactions", val: totalTxns,    color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-900/20"   },
            { label: "Last 30 days",  val: recentTxns,  color: "text-brand-600 dark:text-brand-400", bg: "bg-brand-50 dark:bg-brand-900/20" },
            { label: "Credit records", val: credits.length, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
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
              <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{msg.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{msg.body}</p>
            </div>
          </div>
          <div className="flex gap-1 mt-3 justify-center">
            {ENCOURAGE_MSGS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${i === msgIdx ? "w-5 bg-brand-500" : "w-1.5 bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">What Our Partners Analyse</p>
          <div className="space-y-2">
            {[
              { icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 13h6|M9 17h4", text: "Transaction consistency & frequency", done: totalTxns >= 30 },
              { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: "Business cash flow (income vs expenses)", done: cashIn > 0 },
              { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8", text: "Credit management history", done: credits.length > 0 },
              { icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75", text: "Ajo savings & financial discipline", done: asoClients.length > 0 },
              { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: "120 days of active platform use", done: eligible },
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
            <p className="text-xs font-bold text-white/60 uppercase tracking-widest">You're Eligible!</p>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-50 mb-1">Business Loan Access</p>
          <p className="text-5xl font-black mb-1">₦5,000,000</p>
          <p className="text-sm opacity-60">or more, based on your activity</p>
        </div>
        <div className="bg-white/10 px-5 py-3 flex items-center justify-between">
          <p className="text-xs text-white/60 font-semibold">Activity Score</p>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full" style={{ width: `${activityScore}%` }} />
            </div>
            <p className="text-xs text-white font-black">{activityScore}/100</p>
          </div>
        </div>
      </div>

      <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-5 py-4 mb-4 border border-brand-200 dark:border-brand-800/40">
        <p className="text-[10px] font-bold text-brand-700 dark:text-brand-400 uppercase tracking-wider mb-1">Your Estimated Loan Range</p>
        <p className="text-2xl font-black text-brand-800 dark:text-brand-300">{loanTier}</p>
        <p className="text-xs text-brand-700/60 dark:text-brand-400/60 mt-1">Final amount determined by our partners after review</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Your Business Profile</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Days Active",        val: daysActive,          color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Total Transactions", val: totalTxns,           color: "text-blue-600 dark:text-blue-400" },
            { label: "Last 30 Days",       val: `${recentTxns} txns`, color: "text-brand-600 dark:text-brand-400" },
            { label: "Total Revenue",      val: fmt(cashIn),         color: "text-slate-800 dark:text-white" },
            { label: "Credit Records",     val: credits.length,      color: "text-amber-600 dark:text-amber-400" },
            { label: "Ajo Clients",        val: asoClients.length,   color: "text-indigo-600 dark:text-indigo-400" },
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
          { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", text: "Fast review within 48–72 hours",    sub: "Our partners respond quickly" },
          { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: "Competitive interest rates", sub: "Based on your business profile" },
          { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: "No collateral required",             sub: "Your data is your guarantee" },
          { icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", text: "Flexible repayment terms",     sub: "Tailored to your cash flow" },
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
            <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{msg.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{msg.body}</p>
          </div>
        </div>
      </div>

      <div className="w-full py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700">
        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Business Loans</span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
          Coming Soon
        </span>
      </div>
    </div>
  );
}

/* ── Expense category label map ──────────────────────────────────────────────── */
const CAT_LABEL = { expense: "Expense", stock: "Stock Purchase", other: "Other" };

/* ── Main Finance component ──────────────────────────────────────────────────── */
export default function Finance({
  store, plan, onUpgrade,
  autoOpenTab, onAutoOpened,
  userId, session,
  onSelectCoopOrg,
  inventory,
  invoiceHook,
}) {
  const [section,  setSection]  = useState(autoOpenTab || null);
  const [showLoan, setShowLoan] = useState(false);
  const [period,   setPeriod]   = useState("month");

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

  /* ── Period-filtered P&L (client-side) ───────────────────────────────────── */
  const { moneyIn, moneyOut, netPL, inCount, outCount,
          trendPct, trendUp, sparkData, expenseBreakdown } = useMemo(() => {
    const transactions = store.transactions || [];
    const now       = new Date();
    const start     = getPeriodStart(period);
    const diffMs    = now - start;
    const priorStart = new Date(start - diffMs);
    const priorEnd  = start;

    const curr  = filterByRange(transactions, start, now);
    const prior = filterByRange(transactions, priorStart, priorEnd);

    const mIn    = curr.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const mOut   = curr.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const pIn    = prior.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const pOut   = prior.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const netNow  = mIn - mOut;
    const netPrev = pIn - pOut;

    let tPct = null, tUp = null;
    if (netPrev !== 0) {
      tPct = Math.abs(Math.round(((netNow - netPrev) / Math.abs(netPrev)) * 100));
      tUp  = netNow >= netPrev;
    }

    const expMap = {};
    curr.filter(t => t.type === "out").forEach(t => {
      const cat = t.category || "other";
      expMap[cat] = (expMap[cat] || 0) + t.amount;
    });
    const expBreak = Object.entries(expMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

    return {
      moneyIn:          mIn,
      moneyOut:         mOut,
      netPL:            netNow,
      inCount:          curr.filter(t => t.type === "in").length,
      outCount:         curr.filter(t => t.type === "out").length,
      trendPct:         tPct,
      trendUp:          tUp,
      sparkData:        buildSparkData(transactions),
      expenseBreakdown: expBreak,
    };
  }, [store.transactions, period]);

  /* ── Finance tools summary values ─────────────────────────────────────────── */
  const creditOutstanding = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount      = credits.filter(c => c.status === "overdue").length;
  const ajoBalance        = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const ajoActive         = asoClients.filter(c => c.status === "active").length;

  /* ── Sub-section view ─────────────────────────────────────────────────────── */
  if (section) {
    return (
      <div className="flex flex-col min-h-full">
        <SectionHeader title={SECTION_LABELS[section]} onBack={() => setSection(null)} />

        {section === "credit"  && <Credit store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded />}
        {section === "ajo"     && <Aso    store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded />}
        {section === "loan"    && (
          <LoanTab isEnterprise={isEnterprise} accountCreatedAt={session?.user?.created_at}
            onUpgrade={onUpgrade} onApply={() => setShowLoan(true)} store={store} />
        )}
        {section === "org"      && <CoopList userId={userId} onOpen={onSelectCoopOrg} onClose={null} embedded />}
        {section === "invoices" && (
          <Invoices invoiceHook={invoiceHook} plan={plan} onUpgrade={onUpgrade}
            profile={store.profile} inventory={inventory}
            addTransaction={store.addTransaction} userId={userId} />
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
              {p.label}
            </button>
          ))}
        </div>

        {/* Net P&L */}
        <div className="relative mb-1">
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">Net Cash Flow</p>
          <AmountDisplay
            amount={Math.abs(netPL)} size="hero" align="left"
            className={netPL >= 0 ? "text-green-400" : "text-red-400"}
          />
          {netPL < 0 && <span className="text-red-400 text-lg font-black absolute left-0 -top-0.5">−</span>}
        </div>

        {/* Trend badge */}
        {trendPct !== null && (
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              trendUp ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
            }`}>
              {trendUp ? "↑" : "↓"} {trendPct}% vs prior period
            </span>
          </div>
        )}

        {/* 7-day sparkline */}
        <div className="mt-2 opacity-80">
          <Sparkline data={sparkData} />
        </div>
      </div>

      {/* ── Money In / Money Out paired cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-4 border border-green-100 dark:border-green-800/40">
          <p className="text-[9px] font-bold uppercase tracking-widest text-green-700 dark:text-green-400 opacity-70 mb-1.5">Money In</p>
          <AmountDisplay amount={moneyIn} size="stat" colorBy="in" align="left" />
          <p className="text-[10px] text-green-700/50 dark:text-green-400/50 mt-1.5 font-semibold">
            {inCount} {inCount === 1 ? "entry" : "entries"}
          </p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-4 border border-red-100 dark:border-red-800/40">
          <p className="text-[9px] font-bold uppercase tracking-widest text-red-700 dark:text-red-400 opacity-70 mb-1.5">Money Out</p>
          <AmountDisplay amount={moneyOut} size="stat" colorBy="out" align="left" />
          <p className="text-[10px] text-red-700/50 dark:text-red-400/50 mt-1.5 font-semibold">
            {outCount} {outCount === 1 ? "entry" : "entries"}
          </p>
        </div>
      </div>

      {/* ── Empty state — no transactions for this period ── */}
      {moneyIn === 0 && moneyOut === 0 && (
        <div className="flex flex-col items-center gap-2.5 py-7 px-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/50 shadow-card">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DA829" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300 text-center">No transactions for this period</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center">Tap + to record income or expenses</p>
        </div>
      )}

      {/* ── Expense category breakdown ── */}
      {expenseBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3.5">Where it went</p>
          <div className="space-y-3">
            {expenseBreakdown.map(([cat, total]) => {
              const pct = Math.round((total / expenseBreakdown[0][1]) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 capitalize">
                      {CAT_LABEL[cat] || cat}
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
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3.5">Finance Tools</p>

        {/* Top row: Credit + Ajo as data cards */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => hasCreditAccess ? openSection("credit") : onUpgrade?.()}
            className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-3.5 active:scale-95 transition text-left border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                <Svg d={FINANCE_TILES[0].icon} size={13} color="#e11d48" sw={2} />
              </div>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {hasCreditAccess ? "Credit" : "🔒 Credit"}
              </p>
            </div>
            {hasCreditAccess ? (
              <>
                <AmountDisplay amount={creditOutstanding} size="small" colorBy="out" align="left" />
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} record${credits.length !== 1 ? "s" : ""}`}
                </p>
              </>
            ) : (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400">Upgrade to access</p>
            )}
          </button>

          <button
            onClick={() => openSection("ajo")}
            className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-3.5 active:scale-95 transition text-left border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                <Svg d={FINANCE_TILES[1].icon} size={13} color="#3DA829" sw={2} />
              </div>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Ajo Savings</p>
            </div>
            <AmountDisplay amount={ajoBalance} size="small" align="left" />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {ajoActive} active client{ajoActive !== 1 ? "s" : ""}
            </p>
          </button>
        </div>

        {/* Bottom row: Loan / Org / Invoices — smaller icon tiles */}
        <div className="grid grid-cols-3 gap-2">
          {FINANCE_TILES.slice(2).map(tile => (
            <button key={tile.id} onClick={() => openSection(tile.id)}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 active:scale-95 transition border border-slate-100 dark:border-slate-700/30 min-h-[44px]">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${tile.bg}`}>
                <Svg d={tile.icon} size={15} color={tile.color} sw={2} />
              </div>
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-center leading-tight px-1">
                {tile.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Pending credits preview ── */}
      {hasCreditAccess && urgentCredits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Pending Credits</p>
            <button onClick={() => openSection("credit")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
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
                  }`}>{c.status}</span>
                  {c.due_date && <span className="text-[10px] text-slate-400">Due {new Date(c.due_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>}
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
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Active Ajo</p>
            <button onClick={() => openSection("ajo")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
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
                    <p className="text-[10px] text-slate-400 mt-0.5">Next: {new Date(c.next_contribution_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</p>
                  )}
                </div>
                <AmountDisplay amount={c.current_balance || 0} size="small" align="right" className="flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
