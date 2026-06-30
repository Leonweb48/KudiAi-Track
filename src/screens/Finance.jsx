import { useState, useEffect } from "react";
import Credit               from "./Credit";
import Aso                  from "./Aso";
import CoopList             from "./CoopList";
import Invoices             from "./Invoices";
import LoanApplicationModal from "../components/LoanApplicationModal";
import { canDo, getLowestPlanWithFeature } from "../utils/plans";
import { fmt }              from "../utils/helpers";

const FINANCE_TILES = [
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

// ── Credit tracker card — tappable, opens Credit sub-screen ──────────────────
function CreditSummaryCard({ credits, onClick }) {
  const totalOut     = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const activeCount  = credits.filter(c => c.status !== "paid").length;
  const overdueCount = credits.filter(c => c.status === "overdue").length;

  return (
    <button onClick={onClick} className="w-full text-left active:scale-[0.98] transition-transform duration-150">
      <div className="rounded-2xl p-4 text-white shadow-md"
        style={{ background: "linear-gradient(135deg, #1B2A5E 0%, #2d4a8a 100%)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Credit Tracker</p>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
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
    </button>
  );
}

// ── Finance Tools card — Quick Services style tile grid ───────────────────────
function FinanceToolsCard({ tiles, onSelect }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
      <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">
        Finance Tools
      </p>
      <div className="grid grid-cols-4 gap-y-5">
        {tiles.map(s => (
          <button key={s.id} onClick={() => onSelect(s.id)}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
              style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {s.icon.split("|").map((d, i) => <path key={i} d={d} />)}
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[64px]">
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

// ── Loan sub-screen ───────────────────────────────────────────────────────────
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
          Apply for quick business financing.{" "}
          {getLowestPlanWithFeature("loanAccess")
            ? `Available on the ${getLowestPlanWithFeature("loanAccess").name} plan and above.`
            : "Upgrade to access this feature."}
        </p>
        <button onClick={onUpgrade}
          className="bg-brand-600 text-white font-bold px-6 py-3 rounded-2xl text-sm active:scale-95 transition">
          {`Upgrade to ${getLowestPlanWithFeature("loanAccess")?.name ?? "a higher plan"}`}
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
          {`Business Loan unlocks after 4 months on the ${getLowestPlanWithFeature("loanAccess")?.name ?? "required"} plan.`}{" "}
          <span className="font-bold text-amber-500">{monthsLeft} month{monthsLeft !== 1 ? "s" : ""} remaining.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28">
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-5 text-white mb-5 shadow-md">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-2">Business Loan</p>
        <p className="text-3xl font-black mb-1">Up to ₦5,000,000</p>
        <p className="text-sm opacity-75">Quick financing for your business growth</p>
      </div>

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
    if (autoOpenTab) setSection(autoOpenTab);
  }, [autoOpenTab]);

  const credits         = store.credits || [];
  const hasCreditAccess = canDo(plan, "credit");
  const isEnterprise    = canDo(plan, "loanAccess");
  const accountAgeMonths = session?.user?.created_at
    ? (Date.now() - new Date(session.user.created_at)) / (30 * 24 * 60 * 60 * 1000)
    : 0;
  const isLoanEligible = isEnterprise && accountAgeMonths >= 4;

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
            isLoanEligible={isLoanEligible}
            accountAgeMonths={accountAgeMonths}
            onUpgrade={onUpgrade}
            onApply={() => setShowLoan(true)}
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

  // ── Finance dashboard ───────────────────────────────────────────────────────
  return (
    <div className="px-4 pt-4 pb-28 space-y-4">
      {hasCreditAccess && (
        <CreditSummaryCard credits={credits} onClick={() => openSection("credit")} />
      )}
      <FinanceToolsCard tiles={FINANCE_TILES} onSelect={openSection} />
    </div>
  );
}
