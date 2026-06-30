import { useState, useEffect } from "react";
import Credit              from "./Credit";
import Aso                 from "./Aso";
import CoopList            from "./CoopList";
import Invoices            from "./Invoices";
import LoanApplicationModal from "../components/LoanApplicationModal";
import { canDo }           from "../utils/plans";
import { fmt }             from "../utils/helpers";

const TABS = [
  { id: "credit",   label: "Credit" },
  { id: "ajo",      label: "Ajo" },
  { id: "loan",     label: "Loan" },
  { id: "org",      label: "Organisation" },
  { id: "invoices", label: "Invoices" },
];

// ── Reusable X/Twitter-style tab bar ─────────────────────────────────────────
function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
      <div className="flex overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button key={t.id} onClick={() => onSelect(t.id)}
            className={`relative flex-1 min-w-[72px] px-3 py-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors
              hover:bg-slate-100 dark:hover:bg-slate-800/60
              ${active === t.id ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`ml-1 text-[10px] font-bold ${active === t.id ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-600"}`}>
                {t.count}
              </span>
            )}
            {active === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-brand-600 dark:bg-brand-400 rounded-t" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Loan tab content ──────────────────────────────────────────────────────────
function LoanTab({ isEnterprise, isLoanEligible, accountAgeMonths, onUpgrade, onApply }) {
  if (!isEnterprise) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-4">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-emerald-500">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <p className="font-bold text-slate-700 dark:text-slate-200 text-base mb-1">Business Loan</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 mb-5 max-w-xs leading-relaxed">
          Apply for quick business financing. Available on the Oga plan.
        </p>
        <button onClick={onUpgrade}
          className="bg-brand-600 text-white font-bold px-6 py-3 rounded-2xl text-sm active:scale-95 transition">
          Upgrade to Oga
        </button>
      </div>
    );
  }

  if (!isLoanEligible) {
    const monthsLeft = Math.max(1, Math.ceil(4 - accountAgeMonths));
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-amber-500">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
        </div>
        <p className="font-bold text-slate-700 dark:text-slate-200 text-base mb-2">Almost There!</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs">
          Business Loan unlocks after 4 months on the Oga plan.{" "}
          <span className="font-bold text-amber-500">{monthsLeft} month{monthsLeft !== 1 ? "s" : ""} remaining.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28">
      {/* Hero card */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-5 text-white mb-5 shadow-md">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-2">Business Loan</p>
        <p className="text-3xl font-black mb-1">Up to ₦5,000,000</p>
        <p className="text-sm opacity-75">Quick financing for your business growth</p>
      </div>

      {/* Feature list */}
      <div className="space-y-2.5 mb-6">
        {[
          { icon: "M9 12l2 2 4-4", text: "Fast approval within 48 hours" },
          { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", text: "Competitive interest rates" },
          { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", text: "No hidden fees" },
          { icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", text: "Flexible repayment terms" },
        ].map(f => (
          <div key={f.text} className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl px-4 py-3 shadow-sm border border-slate-100 dark:border-slate-700/50">
            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d={f.icon}/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{f.text}</p>
          </div>
        ))}
      </div>

      <button onClick={onApply}
        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-sm active:scale-95 transition shadow-md">
        Apply for Business Loan
      </button>
    </div>
  );
}

// ── Credit summary card (always visible at top) ───────────────────────────────
function CreditSummaryCard({ credits }) {
  if (!credits.length) return null;
  const totalOut    = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const activeCount = credits.filter(c => c.status !== "paid").length;
  const overdueCount = credits.filter(c => c.status === "overdue").length;

  return (
    <div className="px-4 pt-4 pb-2">
      <div
        className="rounded-2xl p-4 text-white shadow-md"
        style={{ background: "linear-gradient(135deg, #1B2A5E 0%, #2d4a8a 100%)" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-3">Credit Tracker</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] opacity-60 mb-0.5">Outstanding</p>
            <p className="text-base font-black leading-tight">{fmt(totalOut)}</p>
          </div>
          <div className="border-l border-white/20 pl-3">
            <p className="text-[10px] opacity-60 mb-0.5">Debtors</p>
            <p className="text-base font-black leading-tight">{activeCount}</p>
          </div>
          <div className="border-l border-white/20 pl-3">
            <p className="text-[10px] opacity-60 mb-0.5">Overdue</p>
            <p className={`text-base font-black leading-tight ${overdueCount > 0 ? "text-red-300" : "text-white"}`}>
              {overdueCount}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Finance({
  store, plan, onUpgrade,
  autoOpenTab, onAutoOpened,
  userId, session,
  onSelectCoopOrg,
  inventory,
  invoiceHook,
}) {
  const [tab,      setTab]      = useState(autoOpenTab || "credit");
  const [showLoan, setShowLoan] = useState(false);

  useEffect(() => {
    if (autoOpenTab) setTab(autoOpenTab);
  }, [autoOpenTab]);

  const credits = store.credits || [];
  const hasCreditAccess = canDo(plan, "credit");

  const invoices       = invoiceHook?.invoices || [];
  const hasInvAccess   = canDo(plan, "invoices");
  const isEnterprise   = canDo(plan, "loanAccess");
  const accountAgeMonths = session?.user?.created_at
    ? (Date.now() - new Date(session.user.created_at)) / (30 * 24 * 60 * 60 * 1000)
    : 0;
  const isLoanEligible = isEnterprise && accountAgeMonths >= 4;

  const tabs = TABS.map(t => {
    if (t.id === "credit"   && hasCreditAccess) return { ...t, count: credits.filter(c => c.status !== "paid").length || null };
    if (t.id === "invoices" && hasInvAccess)    return { ...t, count: invoices.length || null };
    return t;
  });

  return (
    <div className="flex flex-col min-h-full">

      {/* Credit summary card — shown when credit feature is active and has records */}
      {hasCreditAccess && credits.length > 0 && (
        <CreditSummaryCard credits={credits} />
      )}

      {/* X/Twitter-style tab bar */}
      <TabBar tabs={tabs} active={tab} onSelect={setTab} />

      {/* Tab content */}
      {tab === "credit" && (
        <Credit
          store={store}
          plan={plan}
          autoOpen={autoOpenTab === "credit"}
          onAutoOpened={onAutoOpened}
          onUpgrade={onUpgrade}
          embedded
        />
      )}

      {tab === "ajo" && (
        <Aso
          store={store}
          plan={plan}
          autoOpen={autoOpenTab === "ajo"}
          onAutoOpened={onAutoOpened}
          onUpgrade={onUpgrade}
          embedded
        />
      )}

      {tab === "loan" && (
        <LoanTab
          isEnterprise={isEnterprise}
          isLoanEligible={isLoanEligible}
          accountAgeMonths={accountAgeMonths}
          onUpgrade={onUpgrade}
          onApply={() => setShowLoan(true)}
        />
      )}

      {tab === "org" && (
        <CoopList
          userId={userId}
          onOpen={onSelectCoopOrg}
          onClose={null}
          embedded
        />
      )}

      {tab === "invoices" && (
        <Invoices
          invoiceHook={invoiceHook}
          plan={plan}
          onUpgrade={onUpgrade}
          profile={store.profile}
          inventory={inventory}
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
