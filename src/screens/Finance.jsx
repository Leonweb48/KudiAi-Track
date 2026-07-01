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
          <p className="text-xl font-black leading-tight tabular">
            {hasCreditAccess ? fmt(totalOut) : "Upgrade"}
          </p>
          {hasCreditAccess && (
            <p className="text-[10px] opacity-60 mt-1.5">
              {overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} record${credits.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </button>
        <button onClick={onAjoClick}
          className="bg-white/10 rounded-2xl p-3 text-left active:bg-white/20 transition">
          <p className="text-[9px] font-bold opacity-60 uppercase tracking-wider mb-1.5">Ajo Savings</p>
          <p className="text-xl font-black leading-tight tabular">{fmt(ajoBalance)}</p>
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
      <div className="grid grid-cols-4 gap-y-6">
        {tiles.map(s => (
          <button key={s.id} onClick={() => onSelect(s.id)}
            className="flex flex-col items-center gap-2.5 active:scale-90 transition-transform duration-150">
            <div className="w-[60px] h-[60px] rounded-[18px] flex items-center justify-center shadow-md"
              style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {s.icon.split("|").map((d, i) => <path key={i} d={d} />)}
              </svg>
            </div>
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[64px]">
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
    if (autoOpenTab) {
      setSection(autoOpenTab);
      onAutoOpened?.();
    }
  }, [autoOpenTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
