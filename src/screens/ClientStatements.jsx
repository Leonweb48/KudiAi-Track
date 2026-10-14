import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import PeriodFilter from "../components/shared/PeriodFilter";
import ScreenErrorBoundary from "../components/shared/ScreenErrorBoundary";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";
import { clientHolder, formatWATDate, formatWATTime, monthKeyLabel } from "../utils/statementPdfLayout";
import { statementDates, statementMonths, statementRange, watToday } from "../utils/statementPeriod";
import { saveMonthlyStatementPdf, saveSavingsStatementPdf } from "../utils/generateClientStatementPdf";
import { buildSavingsStatementCSV, savingsStatementCSVFilename, shareCSV } from "../utils/exportCSV";
import WalletStatement from "./WalletStatement";
import { useT, tNow } from "../contexts/LanguageContext";

export { statementMonths, statementRange };

// A client's statements (Ajo/savings client portal) — the client-side counterpart of the owner's wallet statement:
//   Savings  every completed savings entry in the period with the running balance, PDF + CSV
//   Wallet   the owner's own wallet statement screen, on the client's wallet
//   Monthly  one statement per month (savings + wallet) — the same PDF that is emailed on the 1st of the next month
// The numbers come from the server (ajo-portal → client_savings_statement / client_statement_data, migration 20270273),
// the same ones the monthly email uses. Every PDF carries the client's details and a verify reference + QR code.
//
// Back (the arrow, the Android back button, the browser's back): the previous tab first, then out of Statements to
// wherever it was opened from. Statements is one entry in the browser history, so the Android back button
// (App.jsx: navigate(-1) while there is history, otherwise exit) comes here instead of closing the app.

// Fill {name}-style slots in translated text with elements (the bold email); the rest stays plain text.
function withNodes(text, nodes) {
  return String(text).split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] !== undefined ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
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
  const t = useT();
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
      .catch((e) => { if (live) setError(e?.message || tNow("circles.stmt.loadFail")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [call, clientId, range.from, range.to]);

  const rows = useMemo(() => [...(statement?.entries || [])].reverse(), [statement]);
  const dates = () => statementDates(range, statement?.entries?.[0]?.at);

  const exportPdf = async () => {
    setExporting("pdf");
    try { await saveSavingsStatementPdf(statement, dates()); }
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
      <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      <div className="flex items-center justify-end gap-3">
        <button onClick={exportPdf} disabled={!!exporting || !statement}
          className="text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "pdf" ? t("circles.stmt.preparing") : "PDF"}
        </button>
        <button onClick={exportCsv} disabled={!!exporting || !rows.length}
          className="text-[12px] font-bold text-brand-600 dark:text-brand-400 disabled:opacity-40 flex items-center gap-1">
          <Icon name="download" size={14} /> {exporting === "csv" ? t("circles.stmt.exporting") : "CSV"}
        </button>
      </div>

      {error ? (
        <p className="text-[13px] text-red-500 text-center py-6">{error}</p>
      ) : loading && !statement ? (
        <div className="py-10 flex justify-center"><div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <SummaryCard label={t("circles.stmt.opening")} value={fmt(statement?.opening || 0)} />
            <SummaryCard label={t("circles.stmt.closing")} value={fmt(statement?.closing || 0)} />
            <SummaryCard label={t("circles.stmt.moneyIn")} value={fmt(statement?.total_in || 0)} tone="in" />
            <SummaryCard label={t("circles.stmt.moneyOut")} value={fmt(statement?.total_out || 0)} tone="out" />
          </div>
          <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
            {rows.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-8 text-center">{t("circles.stmt.noTx")}</p>
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
                      <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{t("circles.stmt.bal", { amount: fmt(e.balance) })}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {Number(statement?.brought_forward || 0) !== 0 && period === "all" && (
            <p className="text-[11px] text-slate-400 text-center">{t("circles.stmt.broughtForward", { amount: fmt(statement.brought_forward) })}</p>
          )}
        </>
      )}
    </div>
  );
}

function MonthlyTab({ call, clientId, since, email, highlight }) {
  const t = useT();
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
      if (!r?.statement) throw new Error(t("circles.stmt.noMonth"));
      await saveMonthlyStatementPdf(r.statement);
    } catch (e) {
      setError(e?.message || t("circles.stmt.prepareFail"));
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/40 px-4 py-3">
        <p className="text-[12px] font-bold text-brand-700 dark:text-brand-300">{t("circles.stmt.monthlyTitle")}</p>
        <p className="text-[11px] text-brand-700/80 dark:text-brand-300/80 mt-0.5 leading-relaxed">
          {email
            ? withNodes(t("circles.stmt.monthlyBodyEmail"), { email: <strong>{email}</strong> })
            : t("circles.stmt.monthlyBody")}
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
                {m === current ? t("circles.stmt.soFar") : sent[m] ? t("circles.stmt.sentOn", { date: formatWATDate(sent[m]) }) : t("circles.stmt.savingsWallet")}
              </p>
            </div>
            <button onClick={() => download(m)} disabled={!!busy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-600 text-white text-[12px] font-bold disabled:opacity-50 active:scale-95 transition">
              <Icon name="download" size={13} /> {busy === m ? t("circles.stmt.preparing") : "PDF"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @param client  the client row (full_name, phone, email, address, lga, state) — printed on the wallet PDF
 * @param onClose called once Statements is left (after its history entry is gone) — the portal returns to where it came from
 */
export default function ClientStatements({ call, clientId, client = {}, since, walletUserId, hasWallet,
                                           initialTab = "savings", initialMonth = "", onClose }) {
  const t = useT();
  const tabs = [["savings", t("circles.stmt.tabSavings")], ...(hasWallet ? [["wallet", t("circles.stmt.tabWallet")]] : []), ["monthly", t("circles.stmt.tabMonthly")]];
  const [tab, setTab] = useState(tabs.some(([id]) => id === initialTab) ? initialTab : "savings");
  const tabHistory = useRef([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const holder = useMemo(() => clientHolder({
    name: client.full_name, phone: client.phone, email: client.email,
    address: client.address, lga: client.lga, state: client.state,
  }), [client.full_name, client.phone, client.email, client.address, client.lga, client.state]);

  const goTab = (id) => {
    if (id === tabRef.current) return;
    tabHistory.current.push(tabRef.current);
    setTab(id);
  };

  // One history entry for the whole screen: a back press (Android button / browser) lands here.
  useEffect(() => {
    const marker = `statements-${Date.now()}`;
    let closed = false;
    const arm = () => window.history.pushState({ ...(window.history.state || {}), ktOverlay: marker }, "");
    arm();
    const onPop = () => {
      if (tabHistory.current.length) { setTab(tabHistory.current.pop()); arm(); return; }
      closed = true;
      onCloseRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // left some other way (signed out, a new screen): take our entry back off the history
      if (!closed && window.history.state?.ktOverlay === marker) window.history.back();
    };
  }, []);

  // The arrow: previous tab, else leave (through the history entry, so it's gone too)
  const back = () => {
    if (tabHistory.current.length) { setTab(tabHistory.current.pop()); return; }
    window.history.back();
  };

  return (
    <div className="pb-28">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={back} aria-label={t("common.back")} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">{t("circles.stmt.title")}</h1>
      </div>
      <div className="px-4 mb-3">
        <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => goTab(id)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                tab === id ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ScreenErrorBoundary key={tab} onBack={back}>
        {tab === "savings" && <div className="px-4"><SavingsTab call={call} clientId={clientId} /></div>}
        {tab === "wallet" && <WalletStatement userId={walletUserId} displayName={client.full_name} holder={holder} embedded />}
        {tab === "monthly" && <div className="px-4"><MonthlyTab call={call} clientId={clientId} since={since} email={client.email} highlight={initialMonth} /></div>}
      </ScreenErrorBoundary>
    </div>
  );
}
