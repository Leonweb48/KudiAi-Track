import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { WalletTxRow } from "../components/WalletPanel";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import PeriodFilter from "../components/shared/PeriodFilter";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useWallet } from "../hooks/useWallet";
import { supabase } from "../utils/supabase";
import { applyPeriodFilter, fmt } from "../utils/helpers";
import { bizFromProfile } from "../utils/receiptConfig";
import { buildWalletStatementCSV, walletStatementCSVFilename, shareCSV } from "../utils/exportCSV";
import { saveWalletStatementPdf } from "../utils/generateWalletStatementPdf";

// A dedicated, independent query — useWallet's own `ledger` is deliberately
// capped at the last 50 rows for its realtime hot-path; a statement needs the
// full history, so this queries wallet_ledger directly rather than widening
// that cap. Bounded at 1000 rows (well beyond what any date-range filter or
// CSV export below would realistically need) rather than truly unbounded.
const STATEMENT_ROW_CAP = 1000;

// Fixed categorical order/colors — dataviz skill's validated default palette,
// slots 1/2/3/4/5/7 (skipping 6=green and 8=red, both already semantically
// "credit"/"error" elsewhere in this app — WalletTxRow colors credits green).
// A given category always maps to the same slot regardless of sort order or
// which categories are present in a given period — color follows identity,
// never rank.
const SPEND_CATEGORIES = [
  { key: "bills",        label: "Bills",           barClass: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { key: "transfers",    label: "Transfers out",   barClass: "bg-[#eb6834] dark:bg-[#d95926]" },
  { key: "ajo",          label: "Ajo & Esusu",     barClass: "bg-[#1baf7a] dark:bg-[#199e70]" },
  { key: "subscription", label: "Subscription",    barClass: "bg-[#eda100] dark:bg-[#c98500]" },
  { key: "fees",         label: "Fees & levies",   barClass: "bg-[#e87ba4] dark:bg-[#d55181]" },
  { key: "other",        label: "Other",           barClass: "bg-[#4a3aa7] dark:bg-[#9085e9]" },
];

function classifySource(source) {
  if (source === "topup" || source === "sale") return "income"; // excluded from the spend breakdown
  if (source === "bill_spend" || source === "bill_reversal") return "bills";
  if (source === "withdrawal" || source === "withdrawal_reversal") return "transfers";
  if (source === "ajo_contribution" || source === "ajo_collection" || source === "ajo_payout") return "ajo";
  if (source === "subscription_spend" || source === "subscription_reversal") return "subscription";
  if (source === "transfer_fee" || source === "cbn_levy" || source === "wallet_fee") return "fees";
  return "other";
}

// Reachable two ways: as a routed screen (owner, /wallet/statement — back
// button navigates(-1)) or as a local overlay rendered directly by a portal
// that doesn't have this route in its router branch at all, e.g. the Ajo
// client portal (pass userId/displayName/onClose to mount it inline instead).
export default function WalletStatement({ session, store, userId: userIdOverride, displayName, onClose }) {
  const userId = userIdOverride || session?.user?.id || null;
  const bizName = displayName || store?.profile?.business_name || "";
  const ownerName = displayName || store?.profile?.owner_name || "";
  const navigate = useNavigate();
  const goBack = onClose || (() => navigate(-1));
  const { walletEnabled } = usePlatformConfig();
  // Reused only for receiptFor/banks/withdrawals — its own capped `ledger`
  // state is never rendered here.
  const w = useWallet(userId, walletEnabled);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");   // list | insights
  const [period, setPeriod] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [exporting, setExporting] = useState("");   // "" | "csv" | "pdf"

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    supabase.from("wallet_ledger").select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(STATEMENT_ROW_CAP)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [userId]);

  const periodFiltered = useMemo(
    () => applyPeriodFilter(rows, period, dateFrom, dateTo, (r) => r.created_at),
    [rows, period, dateFrom, dateTo]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return periodFiltered;
    return periodFiltered.filter((r) =>
      (r.narration || "").toLowerCase().includes(s) ||
      (r.source || "").toLowerCase().includes(s) ||
      String(r.amount_kobo / 100).includes(s)
    );
  }, [periodFiltered, q]);

  // "Where it went" for the selected period — a category's net is debits minus
  // any same-category reversal credits (a fully-refunded category drops off
  // the chart entirely rather than showing as negative spend).
  const insights = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    const catTotals = {};
    for (const r of periodFiltered) {
      const amt = Number(r.amount_kobo || 0) / 100;
      if (r.direction === "credit") totalIn += amt;
      if (r.direction === "debit") totalOut += amt;
      const cat = classifySource(r.source);
      if (cat === "income") continue;
      const signed = r.direction === "debit" ? amt : -amt;
      catTotals[cat] = (catTotals[cat] || 0) + signed;
    }
    const categories = SPEND_CATEGORIES
      .map((c) => ({ ...c, amount: catTotals[c.key] || 0 }))
      .filter((c) => c.amount > 0.5)
      .sort((a, b) => b.amount - a.amount);
    const maxAmount = Math.max(1, ...categories.map((c) => c.amount));
    return { totalIn, totalOut, net: totalIn - totalOut, categories, maxAmount };
  }, [periodFiltered]);

  const openReceipt = (row) => setReceipt(w.receiptFor(row, bizName, ownerName, bizFromProfile(store?.profile)));

  const handleExportCsv = async () => {
    setExporting("csv");
    try {
      const csv = buildWalletStatementCSV(filtered);
      await shareCSV(csv, walletStatementCSVFilename(dateFrom, dateTo));
    } finally {
      setExporting("");
    }
  };

  // The PDF covers the whole selected period (one page per month), not the
  // search box — a statement with rows filtered out would not add up.
  const handleExportPdf = async () => {
    setExporting("pdf");
    try {
      const biz = bizFromProfile(store?.profile);
      await saveWalletStatementPdf(periodFiltered, {
        name:    bizName,
        address: biz.address,
        phone:   biz.phone,
        account: w.wallet?.flw_account_number || "",
      });
    } catch (e) {
      console.warn("[statement] PDF export failed:", e?.message);
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="pb-28">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={goBack} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">Statement</h1>
        <button onClick={handleExportPdf} disabled={!!exporting || periodFiltered.length === 0}
          className="ml-auto text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "pdf" ? "Preparing…" : "PDF"}
        </button>
        <button onClick={handleExportCsv} disabled={!!exporting || filtered.length === 0}
          className="text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "csv" ? "Exporting…" : "CSV"}
        </button>
      </div>

      <div className="px-4 space-y-3">
        <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />

        <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
          {[["list", "List"], ["insights", "Insights"]].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                view === id ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>

        {view === "insights" ? (
          loading ? (
            <div className="py-10 flex justify-center">
              <div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Money in</p>
                  <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50 mt-1 truncate">{fmt(insights.totalIn)}</p>
                </div>
                <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Money out</p>
                  <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50 mt-1 truncate">{fmt(insights.totalOut)}</p>
                </div>
                <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Net</p>
                  <p className={`text-[15px] font-extrabold mt-1 truncate ${insights.net >= 0 ? "text-[#0ca30c]" : "text-[#d03b3b] dark:text-[#e66767]"}`}>
                    {insights.net >= 0 ? "+" : "−"}{fmt(Math.abs(insights.net))}
                  </p>
                </div>
              </div>

              <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-3">Where it went</p>
                {insights.categories.length === 0 ? (
                  <p className="text-[13px] text-slate-400 py-6 text-center">No spending in this range.</p>
                ) : (
                  <div className="space-y-3.5">
                    {insights.categories.map((c) => (
                      <div key={c.key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{c.label}</span>
                          <span className="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 tabular-nums">{fmt(c.amount)}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700/50 overflow-hidden">
                          <div className={`h-full rounded-full ${c.barClass}`} style={{ width: `${Math.max(4, (c.amount / insights.maxAmount) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search narration, type, amount…"
              className="w-full text-[13px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />

            <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
              {loading ? (
                <div className="py-10 flex justify-center">
                  <div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-8 text-center">No transactions in this range.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((row) => <WalletTxRow key={row.id} row={row} hidden={false} onOpen={openReceipt} />)}
                </div>
              )}
            </div>
            {rows.length === STATEMENT_ROW_CAP && (
              <p className="text-[11px] text-slate-400 text-center">Showing the most recent {STATEMENT_ROW_CAP.toLocaleString()} transactions.</p>
            )}
          </>
        )}
      </div>

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
