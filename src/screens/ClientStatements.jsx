import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import PeriodFilter from "../components/shared/PeriodFilter";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";
import { formatWATDate, formatWATTime, monthKeyLabel } from "../utils/statementPdfLayout";
import { saveMonthlyStatementPdf, saveSavingsStatementPdf } from "../utils/generateClientStatementPdf";
import { buildSavingsStatementCSV, savingsStatementCSVFilename, shareCSV } from "../utils/exportCSV";
import WalletStatement from "./WalletStatement";

// A client's statements (Ajo/savings client portal) — the client-side counterpart of the owner's wallet statement:
//   Savings  every completed savings entry in the period with the running balance, PDF + CSV
//   Wallet   the owner's own wallet statement screen, on the client's wallet
//   Monthly  one statement per month (savings + wallet) — the same PDF that is emailed on the 1st of the next month
// The numbers come from the server (ajo-portal → client_savings_statement / client_statement_data, migration 20270273),
// the same ones the monthly email uses.

const WAT_MS = 3600000;
const watToday = () => new Date(Date.now() + WAT_MS).toISOString().slice(0, 10);
const addDay = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const startOfDay = (ymd) => `${ymd}T00:00:00+01:00`;

/** The period chips as a WAT time range [from, to). */
export function statementRange(period, dateFrom, dateTo, today = watToday()) {
  let from = "2000-01-01", to = today;
  if (period === "today") from = today;
  else if (period === "week") {
    const d = new Date(`${today}T00:00:00Z`);
    from = new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);   // Sunday, as the chips do elsewhere
  } else if (period === "month") from = `${today.slice(0, 7)}-01`;
  else if (period === "custom") { from = dateFrom || "2000-01-01"; to = dateTo || today; }
  return { from: startOfDay(from), to: startOfDay(addDay(to)) };
}

/** Months a client can download, newest first: from the month they joined to this month (at most 24). */
export function statementMonths(since, today = watToday()) {
  const cur = today.slice(0, 7);
  const start = since && /^\d{4}-\d{2}/.test(String(since)) ? String(since).slice(0, 7) : cur;
  const out = [];
  let [y, m] = cur.split("-").map(Number);
  while (out.length < 24) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key <= start) break;
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

function SummaryCard({ label, value, tone }) {
  const color = tone === "in" ? "text-[#0f7b3e] dark:text-[#3ccf7a]" : tone === "out" ? "text-[#b91c1c] dark:text-[#ef7171]" : "text-slate-900 dark:text-slate-50";
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-3 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-[15px] font-extrabold mt-1 truncate tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function SavingsTab({ call, clientId }) {
  const [period, setPeriod] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const range = useMemo(() => statementRange(period, dateFrom, dateTo), [period, dateFrom, dateTo]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    call("get-savings-statement", { client_id: clientId, from: range.from, to: range.to })
      .then((r) => { if (live) setStatement(r?.statement || null); })
      .catch((e) => { if (live) setError(e?.message || "Could not load your statement"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [call, clientId, range.from, range.to]);

  const rows = useMemo(() => [...(statement?.entries || [])].reverse(), [statement]);

  const exportPdf = async () => {
    setExporting("pdf");
    try { await saveSavingsStatementPdf(statement, range); }
    catch (e) { console.warn("[statement] PDF failed:", e?.message); }
    finally { setExporting(""); }
  };
  const exportCsv = async () => {
    setExporting("csv");
    try { await shareCSV(buildSavingsStatementCSV(statement), savingsStatementCSVFilename(range.from, range.to)); }
    finally { setExporting(""); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <PeriodFilter className="flex-1 min-w-0" period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      </div>
      <div className="flex items-center justify-end gap-3">
        <button onClick={exportPdf} disabled={!!exporting || !statement}
          className="text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "pdf" ? "Preparing…" : "PDF"}
        </button>
        <button onClick={exportCsv} disabled={!!exporting || !rows.length}
          className="text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "csv" ? "Exporting…" : "CSV"}
        </button>
      </div>

      {error ? (
        <p className="text-[13px] text-red-500 text-center py-6">{error}</p>
      ) : loading && !statement ? (
        <div className="py-10 flex justify-center"><div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <SummaryCard label="Opening balance" value={fmt(statement?.opening || 0)} />
            <SummaryCard label="Closing balance" value={fmt(statement?.closing || 0)} />
            <SummaryCard label="Money in" value={fmt(statement?.total_in || 0)} tone="in" />
            <SummaryCard label="Money out" value={fmt(statement?.total_out || 0)} tone="out" />
          </div>
          <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
            {rows.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-8 text-center">No savings transactions in this range.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {rows.map((e, i) => (
                  <div key={`${e.ref || ""}-${e.at}-${i}`} className="py-3 flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${e.credit ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                      <Icon name={e.credit ? "arrow-down" : "arrow-up"} size={16} className={e.credit ? "text-green-600" : "text-red-500"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{e.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{formatWATDate(e.at)} · {formatWATTime(e.at)}</p>
                      {e.ref && <p className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">{e.ref}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-[13px] font-extrabold tabular-nums ${e.credit ? "text-[#0f7b3e] dark:text-[#3ccf7a]" : "text-[#b91c1c] dark:text-[#ef7171]"}`}>
                        {e.credit ? "+" : "−"}{fmt(e.amount)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">Bal {fmt(e.balance)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {Number(statement?.brought_forward || 0) !== 0 && period === "all" && (
            <p className="text-[11px] text-slate-400 text-center">Includes {fmt(statement.brought_forward)} brought forward from before your first recorded transaction.</p>
          )}
        </>
      )}
    </div>
  );
}

function MonthlyTab({ call, clientId, since, email, highlight }) {
  const months = useMemo(() => statementMonths(since), [since]);
  const [sent, setSent] = useState({});          // month -> emailed_at / notified_at
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const current = watToday().slice(0, 7);

  useEffect(() => {
    let live = true;
    supabase.from("client_statements").select("month, emailed_at, notified_at").eq("aso_client_id", clientId)
      .then(({ data }) => {
        if (!live) return;
        const m = {};
        for (const r of data || []) m[String(r.month).slice(0, 7)] = r.emailed_at || r.notified_at;
        setSent(m);
      }, () => {});
    return () => { live = false; };
  }, [clientId]);

  const download = async (month) => {
    setBusy(month); setError("");
    try {
      const r = await call("get-monthly-statement", { client_id: clientId, month });
      if (!r?.statement) throw new Error("No statement for this month");
      await saveMonthlyStatementPdf(r.statement);
    } catch (e) {
      setError(e?.message || "Could not prepare the statement");
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/40 px-4 py-3">
        <p className="text-[12px] font-bold text-brand-700 dark:text-brand-300">Monthly statements</p>
        <p className="text-[11px] text-brand-700/80 dark:text-brand-300/80 mt-0.5 leading-relaxed">
          On the 1st of every month we send you last month's statement — your savings and wallet, every transaction with the balance after it
          {email ? <> — to <strong>{email}</strong> and</> : ""} here in the app.
        </p>
      </div>
      {error && <p className="text-[12px] text-red-500 text-center">{error}</p>}
      <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 divide-y divide-slate-100 dark:divide-slate-700/60">
        {months.map((m) => (
          <div key={m} className={`flex items-center gap-3 px-4 py-3.5 ${highlight === m ? "bg-brand-50/60 dark:bg-brand-900/10" : ""}`}>
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Icon name="bills" size={16} className="text-slate-500 dark:text-slate-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{monthKeyLabel(m)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {m === current ? "So far this month" : sent[m] ? `Sent ${formatWATDate(sent[m])}` : "Savings and wallet"}
              </p>
            </div>
            <button onClick={() => download(m)} disabled={!!busy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-600 text-white text-[12px] font-bold disabled:opacity-50 active:scale-95 transition">
              <Icon name="download" size={13} /> {busy === m ? "Preparing…" : "PDF"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClientStatements({ call, clientId, clientName, clientEmail, since, walletUserId, hasWallet,
                                           initialTab = "savings", initialMonth = "", onClose }) {
  const tabs = [["savings", "Savings"], ...(hasWallet ? [["wallet", "Wallet"]] : []), ["monthly", "Monthly"]];
  const [tab, setTab] = useState(tabs.some(([id]) => id === initialTab) ? initialTab : "savings");

  return (
    <div className="pb-28">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={onClose} aria-label="Back" className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">Statements</h1>
      </div>
      <div className="px-4 mb-3">
        <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                tab === id ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "savings" && <div className="px-4"><SavingsTab call={call} clientId={clientId} /></div>}
      {tab === "wallet" && <WalletStatement userId={walletUserId} displayName={clientName} embedded />}
      {tab === "monthly" && <div className="px-4"><MonthlyTab call={call} clientId={clientId} since={since} email={clientEmail} highlight={initialMonth} /></div>}
    </div>
  );
}
