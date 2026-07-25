import { useState, useEffect, useMemo, useRef } from "react";
import { useToast } from "../components/Toast";
import { supabase } from "../utils/supabase";
import Icon   from "../components/Icon";
import { AddTxnModal } from "../components/shared/AddTxnModal";
import { useCampaigns }        from "../hooks/useCampaigns";
import AnnouncementBarSlot     from "../components/slots/AnnouncementBarSlot";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../utils/receiptConfig";
import { fmt, applyPeriodFilter, isBillPayment } from "../utils/helpers";
import PeriodFilter from "../components/shared/PeriodFilter";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { TxRow } from "../components/shared/TxRow";
import { canDo, planLimits } from "../utils/plans";
import { createReportPdf, fmtCurrency, fmtDate } from "../utils/generateReportPdf";
import { buildTransactionsCSV, transactionsCSVFilename, shareCSV } from "../utils/exportCSV";
import { useT } from "../contexts/LanguageContext";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
export { AddTxnModal };



/* ══════════════════════════════════════════════════════════════════════
   Date utilities
   ══════════════════════════════════════════════════════════════════════ */
function getDateLabel(dateStr) {
  const now      = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yest     = new Date(now - 86400000);
  const yestStr  = yest.toISOString().slice(0, 10);
  if (dateStr === todayStr)  return "Today";
  if (dateStr === yestStr)   return "Yesterday";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function groupByDate(txns) {
  const groups  = {};
  const keyOrder = [];
  for (const tx of txns) {
    const key = tx.transaction_date || "";
    if (!key) continue;
    if (!groups[key]) {
      const d = new Date(key + "T00:00:00");
      groups[key] = {
        key, label: getDateLabel(key), date: d,
        month: d.getMonth(), year: d.getFullYear(),
        txns: [], netIn: 0, netOut: 0,
      };
      keyOrder.push(key);
    }
    groups[key].txns.push(tx);
    const amt = parseFloat(tx.amount) || 0;
    if (tx.type === "in") groups[key].netIn += amt;
    else                  groups[key].netOut += amt;
  }
  keyOrder.sort((a, b) => b.localeCompare(a));
  return keyOrder.map(k => ({ ...groups[k], net: groups[k].netIn - groups[k].netOut }));
}

/* ══════════════════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════════════════ */

/* Sticky section header — "Today · Yesterday · 12 Jul" + subtotal chip */
function SectionHeader({ label, net }) {
  const pos   = net >= 0;
  return (
    <div
      className="sticky flex items-center justify-between bg-white dark:bg-slate-900 py-1.5 -mx-4 px-4 border-b border-slate-50 dark:border-slate-800 mb-1.5 mt-3 first:mt-0"
      style={{ top: "108px", zIndex: "var(--z-sticky)" }}>
      <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
        {label}
      </span>
      <div className={`flex items-center rounded-full px-2 py-0.5 ${pos ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
        <span className={`text-[9px] font-bold mr-0.5 ${pos ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
          {pos ? "+" : "−"}
        </span>
        <AmountDisplay
          amount={Math.abs(net)} size="small" align="right"
          className={pos ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
        />
      </div>
    </div>
  );
}

/* Month-boundary summary card — inserted when feed crosses a month */
function MonthSummaryCard({ date, totalIn, totalOut }) {
  const net = totalIn - totalOut;
  const label = new Date(date.getFullYear(), date.getMonth(), 1)
    .toLocaleDateString("en-NG", { month: "long", year: "numeric" });
  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700/40 my-3">
      <p className="text-[9px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
        {label} summary
      </p>
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5">Total In</p>
          <AmountDisplay amount={totalIn} size="small" align="left" className="text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5">Total Out</p>
          <AmountDisplay amount={totalOut} size="small" align="left" className="text-red-500 dark:text-red-400" />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5">Net</p>
          <AmountDisplay
            amount={Math.abs(net)} size="small" align="right"
            className={net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
          />
        </div>
      </div>
    </div>
  );
}

/* Per-filter empty states — warm copy */
function EmptyState({ filter, onAdd }) {
  const msg = {
    in:     { title: "No money-in yet",       sub: "Record your first sale to see it here." },
    out:    { title: "No expenses recorded",  sub: "Expenses and stock purchases appear here." },
    bills:  { title: "No bill payments yet",  sub: "Bill payments via Quick Services show here." },
    credit: { title: "No credit transactions",sub: "Credit sales and debt repayments appear here." },
    all:    { title: "No transactions yet",   sub: "Record your first sale and watch this space come alive." },
  };
  const { title, sub } = msg[filter] || msg.all;
  return (
    <div className="text-center py-14 px-4">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>
        </svg>
      </div>
      <p className="text-slate-700 dark:text-slate-300 text-base font-bold mb-1">{title}</p>
      <p className="text-slate-400 dark:text-slate-500 text-sm mb-5">{sub}</p>
      {onAdd && (
        <button onClick={onAdd}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white active:scale-95 transition shadow-sm"
          style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
          + Record Transaction
        </button>
      )}
    </div>
  );
}

/* Loading skeleton — matches reserved height of section-header + 3 rows */
function FeedSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-7 w-32 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse mt-4 mb-2" />
      {[1,2,3].map(i => (
        <div key={i} className="h-[68px] bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 animate-pulse" />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════════════════ */
export default function Transactions({ store, plan = "starter", onVoiceOpen, autoOpen, autoType, autoCategory, onAutoOpened, onUpgrade, readOnly, inventory = null }) {
  const t = useT();
  const toast = useToast();
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar", "upsell_inline"], "business", "business.sales");
  const salesAnnBars = camSlots.announcement_bar || [];

  const [showAdd,         setShowAdd]         = useState(false);
  const [initType,        setInitType]        = useState("in");
  const [initCategory,    setInitCategory]    = useState("sale");
  const [filter,          setFilter]          = useState("all");
  const [search,          setSearch]          = useState("");
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [receipt,         setReceipt]         = useState(null);
  const [ajoContribs,     setAjoContribs]     = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [displayCount,    setDisplayCount]    = useState(50);
  const [isRefreshing,    setIsRefreshing]    = useState(false);
  const [period,          setPeriod]          = useState("all");
  const [dateFrom,        setDateFrom]        = useState("");
  const [dateTo,          setDateTo]          = useState("");
  const searchRef = useRef(null);

  const { transactions, addTransaction, deleteTransaction, profile, staffMap = {}, asoClients = [] } = store;

  const asoClientMap = useMemo(() => {
    const m = {};
    asoClients.forEach(c => { m[c.id] = c; });
    return m;
  }, [asoClients]);

  /* Ajo data fetch unchanged */
  useEffect(() => {
    if (filter !== "ajo") { setAjoContribs(null); return; }
    if (asoClients.length === 0) { setAjoContribs([]); return; }
    supabase
      .from("ajo_contributions")
      .select("id, aso_client_id, type, amount, payment_method, created_at, status")
      .in("aso_client_id", asoClients.map(c => c.id))
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setAjoContribs(data || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, asoClients.length]);

  const limits         = planLimits(plan);
  const now            = new Date();
  const thisMonthTx    = transactions.filter(tx => {
    const d = new Date(tx.transaction_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const txLimitReached = limits.maxTxPerMonth !== Infinity && thisMonthTx.length >= limits.maxTxPerMonth;
  const pdfAllowed     = canDo(plan, "pdfExport");

  useEffect(() => {
    if (autoOpen && !txLimitReached) {
      setInitType(autoType || "in");
      setInitCategory(autoCategory || "sale");
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, autoType, autoCategory, onAutoOpened, txLimitReached]);

  /* Reset display count when filter / search / period changes */
  useEffect(() => { setDisplayCount(50); }, [filter, search, period, dateFrom, dateTo]);

  const isAjoMode = filter === "ajo";

  /* ── Memoised filter (without search) — grouping source ── */
  const filterBase = useMemo(() => {
    if (isAjoMode) return [];
    const byType = transactions.filter(tx => {
      if (filter === "in")     { if (tx.type !== "in"  || tx.payment_type === "bill_payment") return false; }
      else if (filter === "out")   { if (tx.type !== "out" || tx.payment_type === "bill_payment") return false; }
      else if (filter === "bills") { if (tx.payment_type !== "bill_payment") return false; }
      else if (filter === "credit"){ if (tx.category !== "credit sale" && tx.category !== "debt repayment") return false; }
      return true;
    });
    return applyPeriodFilter(byType, period, dateFrom, dateTo, tx => tx.transaction_date);
  }, [transactions, filter, isAjoMode, period, dateFrom, dateTo]);

  /* ── Date grouping — never recomputes per search keystroke ── */
  const groupedSections = useMemo(() => groupByDate(filterBase), [filterBase]);

  /* ── Month totals pre-computed from grouped sections ── */
  const monthTotals = useMemo(() => {
    const m = {};
    for (const s of groupedSections) {
      const key = `${s.year}-${s.month}`;
      if (!m[key]) m[key] = { date: s.date, totalIn: 0, totalOut: 0 };
      m[key].totalIn  += s.netIn;
      m[key].totalOut += s.netOut;
    }
    return m;
  }, [groupedSections]);

  /* ── Sections filtered by search — cheap per-keystroke pass ── */
  const searchedSections = useMemo(() => {
    if (!search) return groupedSections;
    const q = search.toLowerCase();
    return groupedSections
      .map(s => ({
        ...s,
        txns: s.txns.filter(tx =>
          tx.item_name?.toLowerCase().includes(q) ||
          tx.customer_name?.toLowerCase().includes(q)
        ),
      }))
      .filter(s => s.txns.length > 0);
  }, [groupedSections, search]);

  /* ── Paginated flat render list ── */
  const { visibleItems, totalRows } = useMemo(() => {
    const items    = [];
    let rowCount   = 0;
    let prevMonthKey = null;

    for (const section of searchedSections) {
      if (rowCount >= displayCount) break;

      const monthKey = `${section.year}-${section.month}`;
      if (prevMonthKey !== null && prevMonthKey !== monthKey && monthTotals[prevMonthKey]) {
        items.push({ type: "month-card", key: `mc-${prevMonthKey}`, ...monthTotals[prevMonthKey] });
      }
      prevMonthKey = monthKey;

      items.push({ type: "header", key: `hdr-${section.key}`, label: section.label, net: section.net });

      for (const tx of section.txns) {
        if (rowCount >= displayCount) break;
        items.push({ type: "row", key: tx.id, tx });
        rowCount++;
      }
    }

    const total = searchedSections.reduce((s, sec) => s + sec.txns.length, 0);
    return { visibleItems: items, totalRows: total };
  }, [searchedSections, displayCount, monthTotals]);

  const hasMore = displayCount < totalRows;

  /* Summary totals — bill payments excluded from out/net (pass-through) */
  const totIn  = transactions.reduce((s, tx) => tx.type === "in"  ? s + tx.amount : s, 0);
  const totOut = transactions.reduce((s, tx) => tx.type === "out" && !isBillPayment(tx) ? s + tx.amount : s, 0);
  const net    = totIn - totOut;

  const openAdd = (type = "in") => {
    if (txLimitReached) return;
    setInitType(type);
    setShowAdd(true);
  };

  /* Export handlers unchanged */
  const handleExportCsv = async () => {
    const csv = buildTransactionsCSV(filterBase);
    const filename = transactionsCSVFilename(filter, null, null);
    await shareCSV(csv, filename);
  };

  const handleExportPdf = async () => {
    const biz    = store.profile?.business_name || store.profile?.owner_name || "My Business";
    const labels = { all: "All Transactions", in: "Income", out: "Expenses", bills: "Bill Payments", credit: "Credit" };
    const sorted = [...filterBase].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
    let runBal = 0, totD = 0, totC = 0;
    const rows = sorted.map(tx => {
      const isIn = tx.type === "in";
      const amt  = parseFloat(tx.amount) || 0;
      if (isIn) { runBal += amt; totC += amt; } else { runBal -= amt; totD += amt; }
      return {
        date:        fmtDate(tx.transaction_date),
        description: tx.item_name || "—",
        reference:   tx.payment_type || "—",
        debit:       isIn ? "" : fmtCurrency(amt),
        credit:      isIn ? fmtCurrency(amt) : "",
        balance:     fmtCurrency(runBal),
      };
    });
    const pdf = await createReportPdf({
      title: "Transaction Statement", businessName: biz,
      period: labels[filter] || "All Transactions",
      headerRight: [
        { value: biz },
        store.profile?.owner_name ? { value: store.profile.owner_name, sub: true } : null,
        store.profile?.phone      ? { value: store.profile.phone,      sub: true } : null,
        store.profile?.email      ? { value: store.profile.email,      sub: true } : null,
      ].filter(Boolean),
      entityDetails: [
        { label: "Business",       value: biz },
        { label: "Total Records",  value: String(filterBase.length) },
        { label: "Total Income",   value: fmtCurrency(totIn) },
        { label: "Total Expenses", value: fmtCurrency(totOut) },
      ],
    });
    pdf.addStats([
      { label: "Total Income",   value: fmtCurrency(totIn),          color: "#22c55e" },
      { label: "Total Expenses", value: fmtCurrency(totOut),         color: "#ef4444" },
      { label: "Net Cash Flow",  value: fmtCurrency(totIn - totOut), color: totIn >= totOut ? "#22c55e" : "#ef4444" },
      { label: "Records",        value: String(filterBase.length) },
    ]);
    pdf.addStatement(rows, { openingBalance: 0, totalDebits: totD, totalCredits: totC });
    await pdf.save("Transaction_Statement.pdf");
  };

  /* ── Store ref: stable closure for async callbacks ── */
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);

  /* ── Pull-to-refresh — wired to real silentRefresh, 400ms minimum ── */
  const ptrRef          = useRef(null);
  const ptrState        = useRef({ startY: null, direction: null, active: false });
  const ptrPullPxRef    = useRef(0);
  const isRefreshingRef = useRef(false);
  const [pullPx, setPullPx] = useState(0);

  useEffect(() => {
    const el = ptrRef.current;
    if (!el) return;

    const onStart = (e) => {
      if (window.scrollY > 4 || isRefreshingRef.current) return;
      ptrState.current = { startY: e.touches[0].clientY, direction: null, active: false };
    };

    const onMove = (e) => {
      const s = ptrState.current;
      if (s.startY === null) return;
      if (window.scrollY > 4) { s.startY = null; setPullPx(0); ptrPullPxRef.current = 0; return; }
      const dy = e.touches[0].clientY - s.startY;
      if (s.direction === null) {
        if (Math.abs(dy) < 4) return;
        s.direction = dy > 0 ? "pull" : "scroll";
      }
      if (s.direction !== "pull") return;
      const px = Math.min(Math.max(dy, 0) * 0.45, 56);
      ptrPullPxRef.current = px;
      setPullPx(px);
      s.active = true;
    };

    const onEnd = () => {
      const s = ptrState.current;
      if (s.active && ptrPullPxRef.current > 40 && !isRefreshingRef.current) {
        isRefreshingRef.current = true;
        setPullPx(40);
        setIsRefreshing(true);
        const t0 = Date.now();
        Promise.resolve(storeRef.current.silentRefresh?.() || Promise.resolve())
          .catch(() => {})
          .finally(() => {
            const wait = Math.max(0, 400 - (Date.now() - t0));
            setTimeout(() => {
              setIsRefreshing(false);
              setPullPx(0);
              ptrPullPxRef.current = 0;
              isRefreshingRef.current = false;
            }, wait);
          });
      } else {
        setPullPx(0);
        ptrPullPxRef.current = 0;
      }
      ptrState.current = { startY: null, direction: null, active: false };
    };

    el.addEventListener("touchstart",  onStart, { passive: true });
    el.addEventListener("touchmove",   onMove,  { passive: true });
    el.addEventListener("touchend",    onEnd,   { passive: true });
    el.addEventListener("touchcancel", onEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart",  onStart);
      el.removeEventListener("touchmove",   onMove);
      el.removeEventListener("touchend",    onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Resume refresh — visibilitychange (web) + appStateChange (APK), debounced 10s ── */
  const lastResumeRef = useRef(0);

  useEffect(() => {
    const onResume = () => {
      if (Date.now() - lastResumeRef.current < 10_000) return;
      lastResumeRef.current = Date.now();
      storeRef.current.silentRefresh?.().catch(() => {});
    };

    const onVisibility = () => { if (!document.hidden) onResume(); };
    document.addEventListener("visibilitychange", onVisibility);

    let appListener;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) onResume(); })
        .then(l => { appListener = l; });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      appListener?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 30s backup poll — only fires when realtime channel is not SUBSCRIBED ── */
  useEffect(() => {
    const id = setInterval(() => {
      if (!storeRef.current.rtConnected) storeRef.current.silentRefresh?.().catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  /* ── Filter chip definitions ── */
  const FILTERS = [
    { id: "all",    label: t("txn.all")    },
    { id: "in",     label: t("txn.cashIn") },
    { id: "out",    label: t("txn.cashOut")},
    { id: "bills",  label: "Bills"         },
    { id: "credit", label: "Credit"        },
    { id: "ajo",    label: "Ajo"           },
  ];

  /* ── Ajo feed (unchanged render logic) ── */
  const filteredAjo = isAjoMode
    ? (ajoContribs || []).filter(c =>
        !search || (asoClientMap[c.aso_client_id]?.full_name || "").toLowerCase().includes(search.toLowerCase())
      )
    : [];

  /* ════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════ */
  return (
    <div ref={ptrRef} className="pb-28 screen-enter overscroll-contain">

      {/* ── Preamble (scrolls away) ───────────────────────────────── */}
      <AnnouncementBarSlot campaigns={salesAnnBars} loading={camLoading} recordEvent={recordCamEvent} />

      {txLimitReached && (
        <div className="mx-4 mt-4 mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <span className="text-base flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Monthly limit reached</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {limits.maxTxPerMonth} transactions/month limit reached. Upgrade to record more.
            </p>
          </div>
          <button onClick={onUpgrade}
            className="text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-200 dark:bg-amber-700 px-2.5 py-1 rounded-lg flex-shrink-0">
            Upgrade
          </button>
        </div>
      )}

      {/* ── Sticky block: header + filter rail ───────────────────── */}
      <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 shadow-sm"
        style={{ zIndex: "var(--z-nav)" }}>

        {/* Header row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            {t("txn.title")}
          </h1>
          <div className="flex gap-2">
            {pdfAllowed && filterBase.length > 0 && (
              <button onClick={handleExportPdf}
                className="w-11 h-11 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center active:scale-95 transition-transform">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
                </svg>
              </button>
            )}
            {filterBase.length > 0 && (
              <button onClick={handleExportCsv}
                className="w-11 h-11 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center active:scale-95 transition-transform">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </button>
            )}
            {onVoiceOpen && !txLimitReached && (
              <button onClick={onVoiceOpen}
                className="w-11 h-11 bg-slate-800 dark:bg-slate-700 rounded-full flex items-center justify-center active:scale-95 transition-transform">
                <Icon name="mic" size={16} className="text-white" />
              </button>
            )}
            <button onClick={txLimitReached ? onUpgrade : () => openAdd("in")}
              className={`w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform ${txLimitReached ? "bg-amber-400" : "bg-green-600"}`}>
              <Icon name={txLimitReached ? "lock" : "plus"} size={18} className="text-white" />
            </button>
          </div>
        </div>

        {/* Filter rail OR search input */}
        <div className="px-4 pb-3">
          {searchOpen ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  ref={searchRef}
                  type="search" autoFocus placeholder="Search item or customer…" value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/40"
                />
              </div>
              <button onClick={() => { setSearchOpen(false); setSearch(""); }}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 flex-shrink-0 active:scale-95 transition-transform">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {FILTERS.map(opt => (
                <button key={opt.id} onClick={() => setFilter(opt.id)}
                  className={`flex-shrink-0 px-3.5 min-h-[44px] rounded-full text-xs font-bold transition-colors inline-flex items-center ${
                    filter === opt.id
                      ? opt.id === "ajo"
                        ? "bg-violet-600 text-white"
                        : "text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                  }`}
                  style={filter === opt.id && opt.id !== "ajo"
                    ? { background: "var(--brand-green)" }
                    : undefined}>
                  {opt.label}
                </button>
              ))}
              {/* Search toggle */}
              <button onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }}
                className="flex-shrink-0 w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-transform ml-1">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Period filter */}
      <div className="px-4 pb-2.5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      </div>

      {/* ── Summary header — BX-NET-01 fixed ────────────────────── */}
      <div className="px-4 pt-3">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-3.5 border border-green-100 dark:border-green-800/60">
            <p className="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase tracking-wide">Total In</p>
            <AmountDisplay amount={totIn} size="stat" align="left" className="text-green-700 dark:text-green-400 mt-0.5" />
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3.5 border border-red-100 dark:border-red-800/60">
            <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase tracking-wide">Total Out</p>
            <AmountDisplay amount={totOut} size="stat" align="left" className="text-red-600 dark:text-red-400 mt-0.5" />
          </div>
        </div>
        {transactions.length > 0 && (
          <div className={`flex items-center justify-between rounded-2xl px-4 py-2.5 mb-3 ${
            net >= 0
              ? "bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40"
              : "bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40"
          }`}>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Net Position</p>
            <div className="flex items-center gap-0.5">
              <span className={`text-[11px] font-bold ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {net >= 0 ? "+" : "−"}
              </span>
              <AmountDisplay
                amount={Math.abs(net)} size="small" align="right"
                className={net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Feed ─────────────────────────────────────────────────── */}
      <div className="px-4">

        {/* PTR indicator */}
        {(pullPx > 0 || isRefreshing) && (
          <div className="flex items-center justify-center overflow-hidden" style={{ height: Math.min(pullPx, 56) }}>
            <div className={`w-6 h-6 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-green-500 spinner ${isRefreshing ? "opacity-100" : pullPx > 40 ? "opacity-80" : "opacity-40"}`} />
          </div>
        )}

        {/* Ajo mode */}
        {isAjoMode && (
          ajoContribs === null ? (
            <FeedSkeleton />
          ) : filteredAjo.length === 0 ? (
            <EmptyState filter="ajo" />
          ) : (
            <div className="space-y-2 mt-2">
              {filteredAjo.map(c => {
                const client   = asoClientMap[c.aso_client_id];
                const isFee    = c.type === "withdrawal_fee" || c.type === "registration_fee";
                const isWd     = c.type === "withdrawal" || isFee;
                const amt      = parseFloat(c.amount) || 0;
                const typeLabel = isFee
                  ? (c.type === "withdrawal_fee" ? "Withdrawal Fee" : "Reg. Fee")
                  : c.type === "withdrawal" ? "Withdrawal"
                  : c.payment_method === "manual_transfer" ? "Manual Deposit"
                  : "Contribution";
                const dateStr  = c.created_at
                  ? new Date(c.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                  : "—";
                return (
                  <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isWd ? "bg-red-100 dark:bg-red-900/30" : "bg-violet-100 dark:bg-violet-900/30"}`}>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={isWd ? "#ef4444" : "#7c3aed"} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          {isWd ? <><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></> : <><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></>}
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{client?.full_name || "Unknown Client"}</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{typeLabel} · {dateStr}</p>
                      </div>
                      <p className={`text-[14px] font-extrabold tabular flex-shrink-0 ${isWd ? "text-red-500" : "text-violet-600 dark:text-violet-400"}`}>
                        {isWd ? "−" : "+"}{fmt(amt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Regular mode */}
        {!isAjoMode && (
          <>
            {/* Empty state */}
            {totalRows === 0 && !isRefreshing && (
              search ? (
                <div className="text-center py-14 px-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-slate-100 dark:bg-slate-800">
                    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 dark:text-slate-500">
                      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                    </svg>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 text-base font-bold mb-1">No results for "{search}"</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm">Try a different item name or customer.</p>
                </div>
              ) : (
                <EmptyState filter={filter} onAdd={txLimitReached ? onUpgrade : () => openAdd("in")} />
              )
            )}

            {/* Date-sectioned feed */}
            {visibleItems.map(item => {
              if (item.type === "month-card") {
                return <MonthSummaryCard key={item.key} date={item.date} totalIn={item.totalIn} totalOut={item.totalOut} />;
              }
              if (item.type === "header") {
                return <SectionHeader key={item.key} label={item.label} net={item.net} />;
              }
              return (
                <TxRow
                  key={item.key}
                  tx={item.tx}
                  variant="transactions"
                  staffName={staffMap[item.tx.staff_id]}
                  onClick={() => setReceipt(buildTransactionReceipt(item.tx, profile))}
                  onSwipeReceipt={() => setReceipt(buildTransactionReceipt(item.tx, profile))}
                  onSwipeDelete={setConfirmDeleteId}
                />
              );
            })}

            {/* Load more — pagination: 50 rows per page */}
            {hasMore && (
              <button
                onClick={() => setDisplayCount(c => c + 50)}
                className="w-full mt-3 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-500 dark:text-slate-400 active:scale-95 transition-transform bg-white dark:bg-slate-800">
                Load {Math.min(50, totalRows - displayCount)} more
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────── */}
      {showAdd && (
        <AddTxnModal defaultType={initType} defaultCategory={initCategory} onAdd={addTransaction} onClose={() => setShowAdd(false)} inventory={inventory} />
      )}

      {receipt && (
        <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />
      )}

      {/* Delete confirm — ZS-01: --z-sub-sheet first consumer */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 flex items-end"
          style={{ zIndex: "var(--z-sub-sheet)" }}
          onClick={() => setConfirmDeleteId(null)}>
          <div
            className="w-full bg-white dark:bg-slate-900 rounded-t-2xl p-6 shadow-2xl overscroll-contain"
            style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}
            onClick={e => e.stopPropagation()}>
            <p className="text-base font-bold text-slate-900 dark:text-white">Delete this transaction?</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">This action cannot be undone.</p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm active:scale-95 transition">
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = confirmDeleteId;
                  setConfirmDeleteId(null);
                  const result = await deleteTransaction(id);
                  if (result?.error) {
                    toast({ type: "error", title: "Couldn't delete — check connection and try again", body: result.error?.message });
                  }
                }}
                className="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm active:scale-95 transition">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
