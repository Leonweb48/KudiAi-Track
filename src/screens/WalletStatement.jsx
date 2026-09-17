import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { WalletTxRow } from "../components/WalletPanel";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import PeriodFilter from "../components/shared/PeriodFilter";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useWallet } from "../hooks/useWallet";
import { supabase } from "../utils/supabase";
import { applyPeriodFilter } from "../utils/helpers";
import { buildWalletStatementCSV, walletStatementCSVFilename, shareCSV } from "../utils/exportCSV";

// A dedicated, independent query — useWallet's own `ledger` is deliberately
// capped at the last 50 rows for its realtime hot-path; a statement needs the
// full history, so this queries wallet_ledger directly rather than widening
// that cap. Bounded at 1000 rows (well beyond what any date-range filter or
// CSV export below would realistically need) rather than truly unbounded.
const STATEMENT_ROW_CAP = 1000;

export default function WalletStatement({ session, store }) {
  const userId = session?.user?.id || null;
  const navigate = useNavigate();
  const { walletEnabled } = usePlatformConfig();
  // Reused only for receiptFor/banks/withdrawals — its own capped `ledger`
  // state is never rendered here.
  const w = useWallet(userId, walletEnabled);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [exporting, setExporting] = useState(false);

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

  const openReceipt = (row) => setReceipt(w.receiptFor(row, store?.profile?.business_name, store?.profile?.owner_name));

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = buildWalletStatementCSV(filtered);
      await shareCSV(csv, walletStatementCSVFilename(dateFrom, dateTo));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="pb-28">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">Statement</h1>
        <button onClick={handleExport} disabled={exporting || filtered.length === 0}
          className="ml-auto text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting ? "Exporting…" : "Export"}
        </button>
      </div>

      <div className="px-4 space-y-3">
        <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />

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
      </div>

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
