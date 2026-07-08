import { useState, useEffect, useRef } from "react";
import Credit               from "./Credit";
import Aso                  from "./Aso";
import CoopList             from "./CoopList";
import Invoices             from "./Invoices";
import LoanApplicationModal from "../components/LoanApplicationModal";
import { canDo, getLowestPlanWithFeature } from "../utils/plans";
import { fmt }              from "../utils/helpers";
import { AmountDisplay }   from "../components/shared/AmountDisplay";

const FINANCE_TILES = [
  {
    id: "credit", label: "Credit",
    g1: "#e11d48", g2: "#9f1239",
    icon: "M2 8a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V8z|M2 11h20|M6 15h3",
  },
  {
    id: "ajo", label: "Ajo Savings",
    g1: "#7c3aed", g2: "#4c1d95",
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  },
  {
    id: "loan", label: "Business Loan",
    g1: "#059669", g2: "#065f46",
    icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  },
  {
    id: "org", label: "Organisation",
    g1: "#f59e0b", g2: "#d97706",
    icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  },
  {
    id: "invoices", label: "Invoices",
    g1: "#ec4899", g2: "#be185d",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  },
];

const SECTION_LABELS = {
  credit: "Credit", ajo: "Ajo Savings", loan: "Business Loan",
  org: "Organisation", invoices: "Invoices",
};

// ── Financial overview card — credit + ajo in one glanceable card ────────────
function FinanceOverviewCard({ credits, ajoClients, hasCreditAccess, onCreditClick, onAjoClick }) {
  const totalOut     = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const ajoBalance   = ajoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const ajoActive    = ajoClients.filter(c => c.status === "active").length;

  return (
    <div className="rounded-2xl p-4 text-white shadow-md relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #1B2A5E 0%, #2d4a8a 100%)" }}>
      <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-3 relative">Financial Overview</p>
      <div className="grid grid-cols-2 gap-3 relative">
        <button onClick={onCreditClick}
          className="bg-white/10 rounded-2xl p-3 text-left active:bg-white/20 transition">
          <p className="text-[9px] font-bold opacity-60 uppercase tracking-wider mb-1.5">
            {hasCreditAccess ? "Credit Outstanding" : "🔒 Credit"}
          </p>
          {hasCreditAccess
            ? <AmountDisplay amount={totalOut} size="stat" align="left" style={{ color: '#fff' }} />
            : <span className="text-xl font-black leading-tight">Upgrade</span>
          }
          {hasCreditAccess && (
            <p className="text-[10px] opacity-60 mt-1.5">
              {overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} record${credits.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </button>
        <button onClick={onAjoClick}
          className="bg-white/10 rounded-2xl p-3 text-left active:bg-white/20 transition">
          <p className="text-[9px] font-bold opacity-60 uppercase tracking-wider mb-1.5">Ajo Savings</p>
          <AmountDisplay amount={ajoBalance} size="stat" align="left" style={{ color: '#fff' }} />
          <p className="text-[10px] opacity-60 mt-1.5">
            {ajoActive} active client{ajoActive !== 1 ? "s" : ""}
          </p>
        </button>
      </div>
    </div>
  );
}

// ── Finance Tools card — prominent tile grid ─────────────────────────────────
function FinanceToolsCard({ tiles, onSelect }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 shadow-card border border-slate-100 dark:border-slate-700/50">
      <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-5">
        Finance Tools
      </p>
      <div className="grid grid-cols-5 gap-y-5">
        {tiles.map(s => (
          <button key={s.id} onClick={() => onSelect(s.id)}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
            <div className="w-[50px] h-[50px] rounded-[14px] flex items-center justify-center shadow-md"
              style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {s.icon.split("|").map((d, i) => <path key={i} d={d} />)}
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[52px]">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Section header with back button ──────────────────────────────────────────
function SectionHeader({ title, onBack }) {
  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
      <button onClick={onBack}
        className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
      </button>
      <p className="font-bold text-slate-800 dark:text-white text-base">{title}</p>
    </div>
  );
}

// ── Loan Terms & Conditions text ─────────────────────────────────────────────
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
  { emoji: "🚀", title: "You're building something great!", body: "Every transaction you record is building your financial profile. Our lending partners see active, consistent businesses — and they reward them with better loan limits." },
  { emoji: "💰", title: "Your records = your credit score!", body: "Unlike traditional banks, we don't just look at your bank statement. Every sale, every credit record, every Ajo contribution is evidence of your business strength." },
  { emoji: "📈", title: "Active businesses get more!", body: "The more consistently you record your business activities, the stronger your profile becomes. Businesses with 100+ records qualify for our highest loan tiers — up to ₦5,000,000 or more." },
  { emoji: "🏆", title: "Stay consistent — it pays!", body: "Our partners reward consistency. A business that records every day is far more trusted than one with gaps. Keep recording and watch your eligible amount grow." },
  { emoji: "🤝", title: "Partners are watching your growth!", body: "Our lending partners analyse real business data — not guesswork. Your daily records are your strongest loan application. Record every sale, every expense, every credit." },
  { emoji: "⚡", title: "Unlock up to ₦5,000,000!", body: "Hit 120 days of consistent activity and you'll be able to apply for up to ₦5,000,000 in business financing — with no collateral required." },
];

// ── Circular progress ring ───────────────────────────────────────────────────
function ProgressRing({ pct, size = 120, stroke = 10, color = "#16a34a", children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ── Loan sub-screen ───────────────────────────────────────────────────────────
function LoanTab({ isEnterprise, accountCreatedAt, onUpgrade, onApply, store }) {
  const [showTC,    setShowTC]    = useState(false);
  const [tcAccepted, setTcAccepted] = useState(() => localStorage.getItem(LOAN_TC_KEY) === "1");
  const [msgIdx,    setMsgIdx]    = useState(0);
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  const timerRef = useRef(null);

  const transactions  = store?.transactions || [];
  const credits       = store?.credits      || [];
  const asoClients    = store?.asoClients   || [];

  // Eligibility calculation
  const REQUIRED_DAYS = 120;
  const createdMs  = accountCreatedAt ? new Date(accountCreatedAt).getTime() : Date.now();
  const targetMs   = createdMs + REQUIRED_DAYS * 24 * 60 * 60 * 1000;
  const nowMs      = Date.now();
  const daysActive = Math.floor((nowMs - createdMs) / (24 * 60 * 60 * 1000));
  const eligible   = daysActive >= REQUIRED_DAYS;
  const progressPct = Math.min(100, Math.round((daysActive / REQUIRED_DAYS) * 100));

  // Activity metrics
  const totalTxns   = transactions.length;
  const now30       = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const recentTxns  = transactions.filter(t => new Date(t.transaction_date) >= now30).length;
  const distinctDays = new Set(transactions.map(t => t.transaction_date?.slice(0, 10))).size;
  const cashIn      = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const activityScore = Math.min(100, Math.round(
    (Math.min(totalTxns, 100) / 100) * 40 +
    (Math.min(recentTxns, 30) / 30) * 30 +
    (Math.min(distinctDays, 60) / 60) * 30
  ));

  // Estimated loan tier based on activity
  const loanTier = activityScore >= 80 ? "₦3,000,000 – ₦5,000,000+"
    : activityScore >= 50 ? "₦1,000,000 – ₦3,000,000"
    : activityScore >= 25 ? "₦250,000 – ₦1,000,000"
    : "₦100,000 – ₦250,000";

  // Rotating encourage message
  useEffect(() => {
    const id = setInterval(() => setMsgIdx(i => (i + 1) % ENCOURAGE_MSGS.length), 6000);
    return () => clearInterval(id);
  }, []);

  // Countdown timer
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
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [eligible, targetMs]);

  const acceptTC = () => {
    localStorage.setItem(LOAN_TC_KEY, "1");
    setTcAccepted(true);
    setShowTC(false);
    onApply();
  };

  const msg = ENCOURAGE_MSGS[msgIdx];

  // ── Not on enterprise plan ─────────────────────────────────────────────────
  if (!isEnterprise) {
    return (
      <div className="px-4 pt-6 pb-28">
        <div className="rounded-3xl overflow-hidden mb-5" style={{ background: "linear-gradient(135deg,#065f46,#047857)" }}>
          <div className="px-5 py-6 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-60 mb-2">Business Loan</p>
            <p className="text-4xl font-black mb-1">₦5,000,000+</p>
            <p className="text-sm opacity-70">Quick financing — no collateral required</p>
          </div>
          <div className="bg-black/20 px-5 py-3 flex items-center gap-2">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            <p className="text-xs text-white/70 font-semibold">Enterprise Plan required to access loans</p>
          </div>
        </div>
        <div className="space-y-2.5 mb-6">
          {ENCOURAGE_MSGS.slice(0, 3).map(m => (
            <div key={m.title} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-start gap-3">
              <span className="text-xl flex-shrink-0">{m.emoji}</span>
              <div><p className="text-xs font-bold text-slate-700 dark:text-slate-200">{m.title}</p><p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{m.body}</p></div>
            </div>
          ))}
        </div>
        <button onClick={onUpgrade}
          className="w-full py-4 rounded-2xl font-bold text-sm text-white shadow-md active:scale-95 transition"
          style={{ background: "linear-gradient(135deg,#065f46,#047857)" }}>
          Upgrade to {getLowestPlanWithFeature("loanAccess")?.name ?? "Enterprise"} — Unlock Loans
        </button>
      </div>
    );
  }

  // ── T&C Modal ──────────────────────────────────────────────────────────────
  const TCModal = () => (
    <div className="fixed inset-0 z-[70] bg-black/70 flex flex-col items-center justify-end backdrop-blur-sm" onClick={() => setShowTC(false)}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl flex flex-col" style={{ maxHeight: "92dvh" }} onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <p className="text-base font-black text-slate-800 dark:text-white">Terms & Conditions</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Read carefully before applying for a loan</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ WebkitOverflowScrolling: "touch" }}>
          <pre className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">{LOAN_TERMS}</pre>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
          <button onClick={acceptTC}
            className="w-full py-4 rounded-2xl font-bold text-sm text-white mb-2 active:scale-95 transition"
            style={{ background: "linear-gradient(135deg,#065f46,#16a34a)" }}>
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

  // ── Countdown / building eligibility ───────────────────────────────────────
  if (!eligible) {
    return (
      <div className="px-4 pt-5 pb-28">
        {showTC && <TCModal />}

        {/* Hero countdown card */}
        <div className="rounded-3xl overflow-hidden mb-5 shadow-lg" style={{ background: "linear-gradient(135deg,#1e293b,#0f172a)" }}>
          <div className="px-5 pt-5 pb-1 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[3px] opacity-50 mb-1">Loan Access Unlocks In</p>
            <p className="text-4xl font-black mb-1" style={{ color: "#4ade80" }}>₦5,000,000+</p>
            <p className="text-xs opacity-50 mb-4">Available once you reach 120 days of active use</p>
          </div>
          {/* Countdown blocks */}
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

        {/* Progress ring + activity score */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Eligibility Progress</p>
          <div className="flex items-center gap-5">
            <ProgressRing pct={progressPct} size={100} stroke={9} color="#16a34a">
              <p className="text-xl font-black text-slate-800 dark:text-white">{progressPct}%</p>
              <p className="text-[9px] text-slate-400 font-bold">Done</p>
            </ProgressRing>
            <div className="flex-1 space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Days Active</p>
                  <p className="text-[11px] font-black text-emerald-600">{daysActive}/{REQUIRED_DAYS}</p>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
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

          {/* Potential amount */}
          <div className="mt-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl px-4 py-3 border border-emerald-100 dark:border-emerald-800/40">
            <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-0.5">Based on current activity, you may qualify for</p>
            <p className="text-lg font-black text-emerald-700 dark:text-emerald-300">{loanTier}</p>
            <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">Keep recording to increase your limit!</p>
          </div>
        </div>

        {/* Activity stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { label: "Transactions", val: totalTxns, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20" },
            { label: "Last 30 days", val: recentTxns, icon: "M8 6h13M8 12h13M8 18h13", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
            { label: "Credit records", val: credits.length, icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-3 border border-slate-100 dark:border-slate-700/30 text-center`}>
              <p className={`text-xl font-black tabular ${s.color}`}>{s.val}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Rotating encouragement */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl px-5 py-4 border border-slate-100 dark:border-slate-700/50 shadow-card mb-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">{msg.emoji}</span>
            <div>
              <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{msg.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{msg.body}</p>
            </div>
          </div>
          <div className="flex gap-1 mt-3 justify-center">
            {ENCOURAGE_MSGS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${i === msgIdx ? "w-5 bg-emerald-500" : "w-1.5 bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
        </div>

        {/* What partners look for */}
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
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${item.done ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-slate-100 dark:bg-slate-700"}`}>
                  {item.done
                    ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                    : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10"/></svg>
                  }
                </div>
                <p className={`text-xs font-semibold ${item.done ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Eligible — ready to apply ──────────────────────────────────────────────
  return (
    <div className="px-4 pt-5 pb-28">
      {showTC && <TCModal />}

      {/* Hero */}
      <div className="rounded-3xl overflow-hidden mb-5 shadow-xl" style={{ background: "linear-gradient(135deg,#064e3b,#065f46,#047857)" }}>
        <div className="px-5 pt-6 pb-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round"><path d="M9 12l2 2 4-4"/></svg>
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

      {/* Your estimated tier */}
      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl px-5 py-4 mb-4 border border-emerald-200 dark:border-emerald-800/40">
        <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1">Your Estimated Loan Range</p>
        <p className="text-2xl font-black text-emerald-800 dark:text-emerald-300">{loanTier}</p>
        <p className="text-xs text-emerald-700/60 dark:text-emerald-400/60 mt-1">Final amount determined by our partners after review</p>
      </div>

      {/* Activity snapshot what partners see */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700/50 shadow-card">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Your Business Profile</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Days Active",       val: daysActive,          color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Total Transactions", val: totalTxns,           color: "text-blue-600 dark:text-blue-400" },
            { label: "Last 30 Days",       val: `${recentTxns} txns`, color: "text-violet-600 dark:text-violet-400" },
            { label: "Total Revenue",      val: fmt(cashIn),         color: "text-slate-800 dark:text-white" },
            { label: "Credit Records",     val: credits.length,      color: "text-amber-600 dark:text-amber-400" },
            { label: "Ajo Clients",        val: asoClients.length,   color: "text-indigo-600 dark:text-indigo-400" },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide mb-0.5">{s.label}</p>
              <p className={`text-base font-black tabular ${s.color}`}>{s.val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="space-y-2 mb-5">
        {[
          { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", text: "Fast review within 48–72 hours", sub: "Our partners respond quickly" },
          { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: "Competitive interest rates", sub: "Based on your business profile" },
          { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: "No collateral required", sub: "Your data is your guarantee" },
          { icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", text: "Flexible repayment terms", sub: "Tailored to your cash flow" },
        ].map(f => (
          <div key={f.text} className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700/50 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={f.icon}/></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{f.text}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">{f.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Encouragement */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl px-5 py-4 border border-slate-100 dark:border-slate-700/50 shadow-card mb-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">{msg.emoji}</span>
          <div>
            <p className="text-sm font-black text-slate-800 dark:text-white mb-1">{msg.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{msg.body}</p>
          </div>
        </div>
      </div>

      <button
        onClick={() => tcAccepted ? onApply() : setShowTC(true)}
        className="w-full py-4 rounded-2xl font-bold text-sm text-white active:scale-95 transition shadow-lg"
        style={{ background: "linear-gradient(135deg,#064e3b,#16a34a)" }}>
        {tcAccepted ? "Apply for Business Loan →" : "View Terms & Apply →"}
      </button>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">
        Your data is shared securely with verified lending partners only
      </p>
    </div>
  );
}

// ── Main Finance component ────────────────────────────────────────────────────
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

  useEffect(() => {
    if (autoOpenTab) {
      setSection(autoOpenTab);
      onAutoOpened?.();
    }
  }, [autoOpenTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const credits         = store.credits || [];
  const hasCreditAccess = canDo(plan, "credit");
  const isEnterprise    = canDo(plan, "loanAccess");

  const openSection = (id) => {
    setSection(id);
    onAutoOpened?.();
  };

  // ── Sub-section view ────────────────────────────────────────────────────────
  if (section) {
    return (
      <div className="flex flex-col min-h-full">
        <SectionHeader title={SECTION_LABELS[section]} onBack={() => setSection(null)} />

        {section === "credit" && (
          <Credit store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded />
        )}
        {section === "ajo" && (
          <Aso store={store} plan={plan} autoOpen={false} onAutoOpened={null} onUpgrade={onUpgrade} embedded />
        )}
        {section === "loan" && (
          <LoanTab
            isEnterprise={isEnterprise}
            accountCreatedAt={session?.user?.created_at}
            onUpgrade={onUpgrade}
            onApply={() => setShowLoan(true)}
            store={store}
          />
        )}
        {section === "org" && (
          <CoopList userId={userId} onOpen={onSelectCoopOrg} onClose={null} embedded />
        )}
        {section === "invoices" && (
          <Invoices
            invoiceHook={invoiceHook}
            plan={plan}
            onUpgrade={onUpgrade}
            profile={store.profile}
            inventory={inventory}
            addTransaction={store.addTransaction}
            userId={userId}
          />
        )}

        {showLoan && (
          <LoanApplicationModal
            session={session}
            profile={store.profile}
            onClose={() => setShowLoan(false)}
          />
        )}
      </div>
    );
  }

  const asoClients = store.asoClients || [];
  const urgentCredits = hasCreditAccess
    ? [...credits].sort((a, b) => {
        if (a.status === "overdue" && b.status !== "overdue") return -1;
        if (b.status === "overdue" && a.status !== "overdue") return 1;
        return 0;
      }).slice(0, 2)
    : [];
  const activeAjo = asoClients.filter(c => c.status === "active").slice(0, 2);

  // ── Finance dashboard ───────────────────────────────────────────────────────
  return (
    <div className="px-4 pt-4 pb-28 space-y-4">
      <FinanceOverviewCard
        credits={credits}
        ajoClients={asoClients}
        hasCreditAccess={hasCreditAccess}
        onCreditClick={() => hasCreditAccess ? openSection("credit") : onUpgrade?.()}
        onAjoClick={() => openSection("ajo")}
      />

      {/* ── Recent credit entries preview ── */}
      {hasCreditAccess && urgentCredits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Pending Credits</p>
            <button onClick={() => openSection("credit")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
          </div>
          {urgentCredits.map(c => (
            <div key={c.id}
              className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 mb-2 border border-slate-100 dark:border-slate-700/50 shadow-card flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-black text-amber-600 dark:text-amber-400">{c.customer_name?.[0]?.toUpperCase() || "?"}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{c.customer_name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    c.status === "overdue"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                  }`}>{c.status}</span>
                  {c.due_date && <span className="text-[10px] text-slate-400">Due {c.due_date}</span>}
                </div>
              </div>
              <p className="text-sm font-extrabold text-amber-600 dark:text-amber-400 tabular flex-shrink-0">{fmt(c.outstanding)}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Active ajo clients preview ── */}
      {activeAjo.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Active Ajo</p>
            <button onClick={() => openSection("ajo")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
          </div>
          {activeAjo.map(c => (
            <div key={c.id}
              className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 mb-2 border border-slate-100 dark:border-slate-700/50 shadow-card flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-black text-violet-600 dark:text-violet-400">{c.name?.[0]?.toUpperCase() || "?"}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{c.name}</p>
                {c.next_contribution_date && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Next: {c.next_contribution_date}</p>
                )}
              </div>
              <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400 tabular flex-shrink-0">{fmt(c.current_balance || 0)}</p>
            </div>
          ))}
        </div>
      )}

      <FinanceToolsCard tiles={FINANCE_TILES} onSelect={openSection} />
    </div>
  );
}
