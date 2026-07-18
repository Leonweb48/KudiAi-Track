import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import TransactionPinModal from "../components/TransactionPinModal";
import { canDo, upgradeLabel, planAvailableText } from "../utils/plans";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildCreditPaymentReceipt, buildCreditStatementReceipt } from "../utils/receiptConfig";
import { ClientProfile }  from "../components/shared/ClientProfile";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { supabase } from "../utils/supabase";
import { fmt, applyPeriodFilter } from "../utils/helpers";
import PeriodFilter from "../components/shared/PeriodFilter";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
import { buildCreditPaymentsCSV, creditCSVFilename, shareCSV } from "../utils/exportCSV";
import { getLang, speakConfirmation } from "../utils/i18n";
import { useT } from "../contexts/LanguageContext";
import AssignRecordModal from "../components/AssignRecordModal";

const BLANK = {
  customer_name: "", total_amount: "", due_date: "", notes: "",
  phone: "", email: "", nin: "",
  address: "", state: "", lga: "", ward: "",
  next_of_kin: "", next_of_kin_phone: "", next_of_kin_email: "", next_of_kin_address: "",
  interest_type: "", interest_value: "",
};

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-5 mb-2">
      {children}
    </p>
  );
}

async function uploadPhoto(file, id, bucket = "avatars", folder = "credit") {
  const path = `clients/${folder}/${id}`;
  await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

function daysOverdue(due_date) {
  if (!due_date) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(due_date);
  return Math.max(0, Math.floor((today - due) / 86400000));
}

function buildReminderMessage(c, businessName) {
  const days = daysOverdue(c.due_date);
  const overdueLine = days > 0 ? `\nThis payment is ${days} day${days !== 1 ? "s" : ""} overdue.` : "";
  const biz = businessName ? `\nBusiness: ${businessName}` : "";
  return `Dear ${c.customer_name},\n\nThis is a friendly reminder that you have an outstanding balance with us.${overdueLine}\n\nDue Date: ${c.due_date || "N/A"}\nTotal Debt: ${fmt(c.total_amount)}\nAmount Paid: ${fmt(c.amount_paid || 0)}\nBalance Remaining: ${fmt(c.outstanding)}${biz}\n\nKindly make payment at your earliest convenience. Thank you.`;
}

export default function Credit({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade, embedded }) {
  const t = useT();
  const [showAdd,      setShowAdd]      = useState(false);
  const [repaying,     setRepaying]     = useState(null);
  const [assigningCredit, setAssigningCredit] = useState(null);
  const [txnPin,       setTxnPin]       = useState(null);
  const [repayAmt,     setRepayAmt]     = useState("");
  const [repayMethod,  setRepayMethod]  = useState("cash");
  const [repayNote,    setRepayNote]    = useState("");
  const [receipt,      setReceipt]      = useState(null);
  const [historyFor,   setHistoryFor]   = useState(null); // credit record
  const [payReceipt,   setPayReceipt]   = useState(null); // { payment, credit }
  const [profile_,     setProfile_]     = useState(null);
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [adding,       setAdding]       = useState(false);
  const [reminderFor,           setReminderFor]           = useState(null);
  const [copied,                setCopied]                = useState(false);
  // Credit void (admin-approval) state
  const [creditApprovals,       setCreditApprovals]       = useState([]); // pending requests
  const [voidingCredit,         setVoidingCredit]         = useState(null); // credit.id
  const [voidReason,            setVoidReason]            = useState("");
  const [voidSubmitting,        setVoidSubmitting]        = useState(false);
  const [voidMsg,               setVoidMsg]               = useState({ id: null, text: "", ok: false });

  // Filters
  const [search,         setSearch]         = useState("");
  const [filter,         setFilter]         = useState("all");
  const [dueBefore,      setDueBefore]      = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [period,         setPeriod]         = useState("all");
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");

  const { credits, addCredit, repayCredit, updateCredit, profile, staffMap = {}, debtPayments = [] } = store;

  const [f, setF] = useState(BLANK);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const lgas  = getLGAs(f.state);
  const wards = getWards(f.state, f.lga);

  useEffect(() => {
    if (autoOpen) { setShowAdd(true); onAutoOpened?.(); }
  }, [autoOpen, onAutoOpened]);

  // Load pending credit-void approval requests for this owner
  const loadCreditApprovals = async () => {
    try {
      const { data } = await supabase
        .from("admin_approval_requests")
        .select("id, target_id, status, requested_at")
        .eq("request_type", "credit_delete")
        .eq("status", "pending");
      setCreditApprovals(data || []);
    } catch (e) {
      console.error("loadCreditApprovals:", e);
    }
  };

  useEffect(() => { loadCreditApprovals(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCreditVoidRequest = async (c) => {
    if (!voidReason.trim()) return;
    setVoidSubmitting(true);
    try {
      const { error } = await supabase.rpc("submit_approval_request", {
        p_type:      "credit_delete",
        p_target_id: c.id,
        p_payload: {
          customer_name: c.customer_name,
          total_amount:  c.total_amount,
          amount_paid:   c.amount_paid,
          outstanding:   c.outstanding,
          status:        c.status,
          due_date:      c.due_date || null,
          notes:         c.notes || "",
          phone:         c.phone || "",
          email:         c.email || "",
        },
        p_reason: voidReason.trim(),
      });
      if (error) throw error;
      setVoidMsg({ id: c.id, text: "Void request submitted. You'll be notified by email when an admin decides.", ok: true });
      setVoidingCredit(null);
      setVoidReason("");
      loadCreditApprovals();
    } catch (e) {
      setVoidMsg({ id: c.id, text: e?.message || "Failed to submit request", ok: false });
    } finally {
      setVoidSubmitting(false);
    }
  };

  const cancelCreditVoidRequest = async (requestId, creditId) => {
    try {
      const { error } = await supabase.rpc("cancel_approval_request", { p_request_id: requestId });
      if (error) throw error;
      setVoidMsg({ id: creditId, text: "Request cancelled.", ok: true });
      loadCreditApprovals();
    } catch (e) {
      setVoidMsg({ id: creditId, text: e?.message || "Failed to cancel", ok: false });
    }
  };

  if (!canDo(plan, "credit")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-5">
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-blue-600">
            <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Credit Management</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs leading-relaxed">
          Track credit sales, manage repayments, and monitor outstanding balances. {planAvailableText("credit")}
        </p>
        <button onClick={onUpgrade} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition shadow-md">
          {upgradeLabel("credit")}
        </button>
      </div>
    );
  }

  // Owner vs staff: deleteTransaction is null when a staffId is in use (see useStore return)
  const isOwner = !!store.deleteTransaction;

  // Voided records are excluded from all stats, totals, and overdue alerts
  const nonVoided   = credits.filter(c => c.status !== "voided");
  const totalDebt   = nonVoided.reduce((s, c) => s + (c.total_amount  || 0), 0);
  const totalOut    = nonVoided.reduce((s, c) => s + (c.outstanding   || 0), 0);
  const totalRecov  = nonVoided.reduce((s, c) => s + (c.amount_paid   || 0), 0);
  const overdueList = nonVoided.filter(c => c.status === "overdue");
  const voidedCount = credits.length - nonVoided.length;

  // Interest decomposition (owner-only — staff see total-due only per spec)
  const totalInterestDeclared = isOwner
    ? nonVoided.reduce((s, c) => s + (c.interest_amount || 0), 0)
    : 0;
  const hasInterest = isOwner && totalInterestDeclared > 0;

  // Voided tab shows only voided; all other tabs exclude voided
  const filtered = applyPeriodFilter(
    credits
      .filter(c => filter === "voided" ? c.status === "voided" : c.status !== "voided")
      .filter(c => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (c.customer_name || "").toLowerCase().includes(q) || (c.phone || "").includes(q);
      })
      .filter(c => {
        if (filter === "active")  return c.status === "active";
        if (filter === "overdue") return c.status === "overdue";
        if (filter === "paid")    return c.status === "paid";
        return true;
      })
      .filter(c => filter === "voided" || !dueBefore || (c.due_date && c.due_date <= dueBefore)),
    period, dateFrom, dateTo, c => c.created_at
  );

  const CHIPS = [
    { key: "all",     label: "All",     count: nonVoided.length },
    { key: "active",  label: "Active",  count: nonVoided.filter(c => c.status === "active").length },
    { key: "overdue", label: "Overdue", count: overdueList.length },
    { key: "paid",    label: "Paid",    count: nonVoided.filter(c => c.status === "paid").length },
    { key: "voided",  label: "Voided",  count: voidedCount },
  ];

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const resetAdd = () => {
    setShowAdd(false); setF(BLANK);
    setPhotoFile(null); setPhotoPreview(null);
  };

  const handleAdd = async () => {
    if (!f.customer_name || !f.total_amount) return;
    setAdding(true);
    const principal = parseFloat(f.total_amount) || 0;
    const iVal      = parseFloat(f.interest_value) || 0;
    let interestAmount = null;
    if (f.interest_type === "percent" && iVal > 0) {
      interestAmount = parseFloat((principal * iVal / 100).toFixed(2));
    } else if (f.interest_type === "fixed" && iVal > 0) {
      interestAmount = iVal;
    }
    const { data, error } = await addCredit({
      ...f,
      total_amount:    principal,
      interest_amount: interestAmount,
      interest_value:  iVal || null,
      interest_type:   f.interest_type || null,
    });
    if (!error && data && photoFile) {
      try {
        const url = await uploadPhoto(photoFile, data.id, "avatars", "credit");
        await updateCredit(data.id, { profile_image_url: url });
      } catch (err) {
        console.error("Photo upload:", err);
      }
    }
    setAdding(false);
    resetAdd();
  };

  const handleCopy = (msg) => {
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Pre-compute reminder content when modal is open
  const reminderMsg = reminderFor ? buildReminderMessage(reminderFor, profile?.business_name) : "";
  const waLink = reminderFor?.phone
    ? `https://wa.me/${reminderFor.phone.replace(/\D/g, "")}?text=${encodeURIComponent(reminderMsg)}`
    : null;

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className={`${embedded ? "" : "sticky top-0 z-sticky"} bg-white dark:bg-slate-900 -mx-4 px-4 py-3 mb-4 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between`}>
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">{t("credit.title")}</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-brand-500 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Hero */}
      <div className="rounded-3xl px-5 py-5 mb-4 text-white relative overflow-hidden shadow-hero bg-gradient-to-br from-amber-400 via-amber-600 to-amber-700">
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Outstanding Balance</p>
          <AmountDisplay amount={totalOut} size="hero" align="left" className="text-white mb-4" />
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Total Debt</p>
              <AmountDisplay amount={totalDebt} size="small" align="left" className="text-white" />
            </div>
            <div className="px-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Recovered</p>
              <AmountDisplay amount={totalRecov} size="small" align="left" className="text-green-200" />
            </div>
            <div className="pl-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Debtors</p>
              <p className="text-sm font-extrabold tabular-nums">
                {credits.length}
                {overdueList.length > 0 && (
                  <span className="ml-1 text-red-200 inline-flex items-center gap-0.5">
                    · <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 inline" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>{overdueList.length}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Interest breakdown — owner-only, shown only when any credit carries declared interest */}
      {hasInterest && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl px-4 py-3 mb-4">
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">Interest Earned (declared)</p>
          <div className="grid grid-cols-3 divide-x divide-amber-200 dark:divide-amber-800/40">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-0.5">Principal</p>
              <AmountDisplay amount={totalDebt} size="small" align="left" className="text-slate-700 dark:text-slate-200" />
            </div>
            <div className="px-3 min-w-0">
              <p className="text-[9px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-0.5">Interest</p>
              <AmountDisplay amount={totalInterestDeclared} size="small" align="left" className="text-amber-700 dark:text-amber-400" />
            </div>
            <div className="pl-3 min-w-0">
              <p className="text-[9px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-0.5">Total Due</p>
              <AmountDisplay amount={totalDebt + totalInterestDeclared} size="small" align="left" className="text-slate-700 dark:text-slate-200" />
            </div>
          </div>
        </div>
      )}

      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-red-500 dark:text-red-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              {overdueList.length} overdue {overdueList.length === 1 ? "account" : "accounts"}
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
              {fmt(overdueList.reduce((s, c) => s + c.outstanding, 0))} still outstanding
            </p>
          </div>
          <button onClick={() => setFilter("overdue")}
            className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-3 py-1.5 rounded-xl flex-shrink-0 active:scale-95 transition-transform">
            View All
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 transition"
        />
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter chips + date toggle */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {CHIPS.map(({ key, label, count }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
              filter === key
                ? key === "overdue" ? "bg-red-500 text-white shadow-sm"
                  : key === "paid"   ? "bg-green-500 text-white shadow-sm"
                  : key === "voided" ? "bg-slate-500 text-white shadow-sm"
                  : "bg-brand-500 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            }`}>
            {label}
            {count > 0 && (
              <span className={`text-[10px] font-black ${filter === key ? "opacity-80" : "opacity-50"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
        <button onClick={() => setShowDateFilter(v => !v)}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
            dueBefore
              ? "bg-brand-500 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          }`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {dueBefore || "Date"}
        </button>
      </div>

      {/* Period filter (by created date) */}
      <div className="mb-2">
        <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      </div>

      {/* Date filter panel (due date) */}
      {showDateFilter && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 mb-2 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Due on or before</p>
            <input type="date" value={dueBefore} onChange={e => setDueBefore(e.target.value)}
              className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none" />
          </div>
          {dueBefore && (
            <button onClick={() => { setDueBefore(""); }}
              className="text-xs font-bold text-red-400 hover:text-red-600 transition">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {(search || filter !== "all" || dueBefore || period !== "all") && credits.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 font-medium">
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
          {search && ` for "${search}"`}
        </p>
      )}

      {/* Empty states */}
      {credits.length === 0 ? (
        <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-amber-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("credit.noCredit")}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">{t("credit.addDebtor")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No matches found</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Try a different search or filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const pct       = Math.min(100, ((c.amount_paid || 0) / (c.total_amount || 1)) * 100);
            const initials  = (c.customer_name || "?").slice(0, 2).toUpperCase();
            const overdueDays = daysOverdue(c.due_date);
            const isOverdue = overdueDays > 0 && c.status !== "paid" && c.status !== "voided";
            const isPaid    = c.status === "paid";
            const isVoided  = c.status === "voided";

            const pendingVoid    = creditApprovals.find(r => r.target_id === c.id);
            const isVoidLocked   = Boolean(pendingVoid);
            const isVoidOpen     = voidingCredit === c.id;
            const creditVoidMsg  = voidMsg.id === c.id ? voidMsg : null;

            return (
              <div key={c.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border ${
                  isVoided    ? "border-slate-200 dark:border-slate-700/40 opacity-70"
                  : isOverdue ? "border-red-200 dark:border-red-800/50"
                  : isVoidLocked ? "border-amber-200 dark:border-amber-700/50"
                  : "border-slate-100 dark:border-slate-700/60"
                }`}>

                {/* Card header — avatar clickable to open profile */}
                <div className="flex items-start gap-3 mb-3">
                  <button onClick={() => setProfile_(c)}
                    className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform">
                    {c.profile_image_url
                      ? <img src={c.profile_image_url} alt={c.customer_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-black text-base">{initials}</div>
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`font-bold truncate ${isVoided ? "text-slate-400 dark:text-slate-500 line-through decoration-slate-400/60" : "text-slate-800 dark:text-slate-100"}`}>{c.customer_name}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {c.phone && <span className="text-xs text-slate-400 dark:text-slate-500">{c.phone}</span>}
                      {c.due_date && (
                        <>
                          {c.phone && <span className="text-slate-300 dark:text-slate-600 text-xs">·</span>}
                          <span className={`text-xs font-semibold ${
                            isOverdue ? "text-red-500 dark:text-red-400" : "text-slate-400 dark:text-slate-500"
                          }`}>
                            Due {c.due_date}
                          </span>
                        </>
                      )}
                    </div>
                    {staffMap[c.staff_id] && (
                      <span className="inline-block text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold mt-1">
                        {staffMap[c.staff_id]}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge status={c.status} />
                    {isOverdue && overdueDays > 0 && (
                      <span className="text-[10px] font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full">
                        {overdueDays}d late
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex gap-2 mb-3">
                  {[
                    { label: "Owed",  amount: c.outstanding,  colorBy: "out" },
                    { label: "Paid",  amount: c.amount_paid,  colorBy: "in"  },
                    { label: "Total", amount: c.total_amount, colorBy: null  },
                  ].map(({ label, amount, colorBy }) => (
                    <div key={label} className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5 overflow-hidden">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                      <AmountDisplay amount={amount} size="small" align="left" colorBy={colorBy} />
                    </div>
                  ))}
                </div>

                {/* Progress */}
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">
                    <span>Paid {Math.round(pct)}%</span>
                    {isOverdue && overdueDays > 0
                      ? <span className="text-red-400 dark:text-red-500 font-bold">{overdueDays} day{overdueDays !== 1 ? "s" : ""} overdue</span>
                      : c.due_date && !isPaid && <span>Due {c.due_date}</span>
                    }
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOverdue ? "bg-red-400 dark:bg-red-500" : "bg-green-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                {/* Actions */}
                <div className="pt-2.5 border-t border-slate-50 dark:border-slate-700/60 space-y-2">
                  {/* Primary — Record Payment, full width */}
                  {c.outstanding > 0 && !isVoidLocked && !isVoided && (
                    <button onClick={() => setRepaying(c)}
                      className="w-full py-2.5 min-h-[44px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-sm border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Record Payment
                    </button>
                  )}
                  {/* Secondary — 2-column grid so each button always has half the width */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {c.outstanding > 0 && (
                      <button onClick={() => { setReminderFor(c); setCopied(false); }}
                        className={`py-2.5 min-h-[40px] rounded-xl font-semibold text-xs border transition flex items-center justify-center gap-1 active:scale-[0.99] ${
                          isOverdue
                            ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100"
                            : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                        }`}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                        </svg>
                        Remind
                      </button>
                    )}
                    <button onClick={() => setReceipt(c)}
                      className="py-2.5 min-h-[40px] bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 rounded-xl font-semibold text-xs border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center justify-center gap-1 active:scale-[0.99]">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8" />
                      </svg>
                      Statement
                    </button>
                    {debtPayments.some(p => p.credit_id === c.id) && (
                      <button onClick={() => setHistoryFor(c)}
                        className="py-2.5 min-h-[40px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl font-semibold text-xs border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition flex items-center justify-center gap-1 active:scale-[0.99]">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4.5"/>
                          <polyline points="3 3 3 7 7 7"/>
                        </svg>
                        Payments
                      </button>
                    )}
                    {!isVoidLocked && !isVoidOpen && !isVoided && (
                      <button
                        onClick={() => { setVoidingCredit(c.id); setVoidReason(""); setVoidMsg({ id: null, text: "", ok: false }); }}
                        className="py-2.5 min-h-[40px] bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-xl font-semibold text-xs border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition flex items-center justify-center gap-1 active:scale-[0.99]">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                        </svg>
                        Void
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setAssigningCredit(c)}
                        className="py-2.5 min-h-[40px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-xl font-semibold text-xs border border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition flex items-center justify-center gap-1 active:scale-[0.99]">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                        </svg>
                        Assign
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Pending void badge ── */}
                {isVoidLocked && !creditVoidMsg && (
                  <div className="mt-3 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Pending admin approval — void request</p>
                    </div>
                    <button
                      onClick={() => cancelCreditVoidRequest(pendingVoid.id, c.id)}
                      className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex-shrink-0">
                      Cancel
                    </button>
                  </div>
                )}

                {/* ── Void result message ── */}
                {creditVoidMsg && (
                  <p className={`mt-3 text-[10px] font-semibold px-3 py-2 rounded-xl ${creditVoidMsg.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
                    {creditVoidMsg.text}
                  </p>
                )}

                {/* ── Voided record info ── */}
                {isVoided && (c.voided_at || c.voided_reason) && (
                  <div className="mt-3 bg-slate-50 dark:bg-slate-700/30 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700/40 space-y-0.5">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Voided</p>
                    {c.voided_at && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        {new Date(c.voided_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    )}
                    {c.voided_reason && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">"{c.voided_reason}"</p>
                    )}
                  </div>
                )}

                {/* ── Inline void confirmation form ── */}
                {isVoidOpen && (
                  <div className="mt-3 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 space-y-2.5 border border-red-200 dark:border-red-800">
                    <p className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">Request Credit Void</p>
                    <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                      Voiding <strong className="inline-block max-w-[140px] truncate align-text-bottom">{c.customer_name}</strong>'s credit record (₦{fmt(c.total_amount)}) requires admin approval. All payment history will be preserved. The record will be removed from your active list once approved.
                    </p>
                    {c.amount_paid > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 border border-amber-200 dark:border-amber-700/40">
                        <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Partial repayments already recorded</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                          ₦{fmt(c.amount_paid)} has been repaid against this credit. Voiding is permanent — those repayments stay in your transaction history but will no longer count toward outstanding totals.
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">Reason *</p>
                      <textarea rows={2} value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Why do you need to void this credit record?"
                        className="w-full text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2 text-slate-800 dark:text-white focus:outline-none resize-none" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => submitCreditVoidRequest(c)}
                        disabled={voidSubmitting || !voidReason.trim()}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                        {voidSubmitting ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting…</> : "Submit Void Request"}
                      </button>
                      <button onClick={() => { setVoidingCredit(null); setVoidReason(""); }}
                        className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Credit Modal ─────────────────────────────────────────── */}
      {showAdd && (
        <Modal title="New Credit Record" onClose={resetAdd}>

          <div className="flex flex-col items-center mb-4 pt-1">
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 flex items-center justify-center shadow-sm">
                {photoPreview
                  ? <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  : <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-slate-300 dark:text-slate-500" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    </svg>
                }
              </div>
              <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-brand-500 hover:bg-brand-600 rounded-full flex items-center justify-center cursor-pointer shadow-md transition active:scale-95">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
                </svg>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Tap camera to add photo</p>
          </div>

          <SectionLabel>Credit Details</SectionLabel>
          <Field label="Customer Name *" value={f.customer_name}
            onChange={e => set("customer_name", e.target.value)} placeholder="Full name of debtor" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount Owed (₦) *" type="number" inputMode="decimal" value={f.total_amount}
              onChange={e => set("total_amount", e.target.value)} placeholder="0.00" />
            <Field label="Due Date" type="date" value={f.due_date}
              onChange={e => set("due_date", e.target.value)} />
          </div>

          {/* Optional interest — owner sets at creation; immutable after saving */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Interest Type" as="select" value={f.interest_type}
              onChange={e => { set("interest_type", e.target.value); set("interest_value", ""); }}>
              <option value="">No interest</option>
              <option value="percent">% of principal</option>
              <option value="fixed">Fixed ₦ amount</option>
            </Field>
            {f.interest_type ? (
              <Field
                label={f.interest_type === "percent" ? "Interest %" : "Interest (₦)"}
                type="number" inputMode="decimal"
                value={f.interest_value}
                onChange={e => set("interest_value", e.target.value)}
                placeholder={f.interest_type === "percent" ? "e.g. 5" : "e.g. 2000"}
              />
            ) : <div />}
          </div>
          {f.interest_type && f.interest_value && parseFloat(f.interest_value) > 0 && parseFloat(f.total_amount) > 0 && (
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 -mt-1">
              Interest:{" "}
              {f.interest_type === "percent"
                ? `₦${(parseFloat(f.total_amount) * parseFloat(f.interest_value) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `₦${parseFloat(f.interest_value).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
              {" "}· Total due:{" "}
              ₦{(
                parseFloat(f.total_amount) + (
                  f.interest_type === "percent"
                    ? parseFloat(f.total_amount) * parseFloat(f.interest_value) / 100
                    : parseFloat(f.interest_value)
                )
              ).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}

          <SectionLabel>Contact & Identity</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.phone}
              onChange={e => set("phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email" type="email" value={f.email}
              onChange={e => set("email", e.target.value)} placeholder="email@example.com" />
          </div>
          <Field label="NIN" inputMode="numeric" value={f.nin}
            onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="11-digit National ID Number" />

          <SectionLabel>Address</SectionLabel>
          <Field label="Street Address" value={f.address}
            onChange={e => set("address", e.target.value)} placeholder="12 Market Road, Onitsha" />
          <Field label="State" as="select" value={f.state}
            onChange={e => { set("state", e.target.value); set("lga", ""); set("ward", ""); }}>
            <option value="">Select State…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="LGA" as="select" value={f.lga} disabled={!f.state}
              onChange={e => { set("lga", e.target.value); set("ward", ""); }}>
              <option value="">{f.state ? "Select LGA…" : "State first"}</option>
              {lgas.map(l => <option key={l} value={l}>{l}</option>)}
            </Field>
            <Field label="Ward" as="select" value={f.ward} disabled={!f.lga}
              onChange={e => set("ward", e.target.value)}>
              <option value="">{f.lga ? "Select Ward…" : "LGA first"}</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </Field>
          </div>

          <SectionLabel>Next of Kin</SectionLabel>
          <Field label="Full Name" value={f.next_of_kin}
            onChange={e => set("next_of_kin", e.target.value)} placeholder="Next of kin name" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.next_of_kin_phone}
              onChange={e => set("next_of_kin_phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email" type="email" value={f.next_of_kin_email}
              onChange={e => set("next_of_kin_email", e.target.value)} placeholder="email@example.com" />
          </div>
          <Field label="Address" value={f.next_of_kin_address}
            onChange={e => set("next_of_kin_address", e.target.value)} placeholder="Next of kin address" />

          <SectionLabel>Notes</SectionLabel>
          <Field as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes…" />

          <button onClick={handleAdd}
            disabled={!f.customer_name || !f.total_amount || adding}
            className="w-full py-3.5 mt-1 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm disabled:opacity-50">
            {adding ? "Saving…" : "Save Credit Record"}
          </button>
        </Modal>
      )}

      {/* Repayment modal */}
      {repaying && (
        <Modal title={`Record Payment — ${repaying.customer_name}`}
          onClose={() => { setRepaying(null); setRepayAmt(""); setRepayMethod("cash"); setRepayNote(""); }}>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3 mb-4 border border-red-100 dark:border-red-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding balance</p>
            <AmountDisplay amount={repaying.outstanding} size="stat" align="left" className="text-red-500 dark:text-red-400" />
          </div>
          <Field label="Payment Amount (₦)" type="number" inputMode="decimal" value={repayAmt}
            onChange={e => setRepayAmt(e.target.value)} placeholder="Enter amount paid" />
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Payment Method</label>
            <select value={repayMethod} onChange={e => setRepayMethod(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Field label="Notes (optional)" value={repayNote}
            onChange={e => setRepayNote(e.target.value)} placeholder="e.g. partial payment, bank ref..." />
          <button
            onClick={() => {
              if (!repayAmt) return;
              setTxnPin({
                title: "Confirm Payment",
                amount: Math.round(parseFloat(repayAmt) * 100),
                recipient: repaying.customer_name || undefined,
                description: `Credit repayment · ${repayMethod}`,
                onApprove: (verifiedPin) => {
                  setTxnPin(null);
                  repayCredit(repaying.id, parseFloat(repayAmt), repayMethod, repayNote, verifiedPin);
                  speakConfirmation("creditSaved", getLang());
                  setRepaying(null); setRepayAmt(""); setRepayMethod("cash"); setRepayNote("");
                },
              });
            }}
            className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm">
            Confirm Payment
          </button>
        </Modal>
      )}

      {/* Reminder modal */}
      {reminderFor && (
        <Modal title="Send Payment Reminder" onClose={() => setReminderFor(null)}>
          <div className="flex items-center gap-3 mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/60">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              {reminderFor.profile_image_url
                ? <img src={reminderFor.profile_image_url} alt={reminderFor.customer_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-black text-base">
                    {(reminderFor.customer_name || "?")[0].toUpperCase()}
                  </div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{reminderFor.customer_name}</p>
              <p className="text-xs text-red-500 dark:text-red-400 font-semibold">{fmt(reminderFor.outstanding)} outstanding</p>
            </div>
            {daysOverdue(reminderFor.due_date) > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded-full flex-shrink-0">
                {daysOverdue(reminderFor.due_date)}d overdue
              </span>
            )}
          </div>

          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Message Preview</p>
          <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-4 mb-4 border border-slate-200 dark:border-slate-600 max-h-52 overflow-y-auto">
            <pre className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{reminderMsg}</pre>
          </div>

          <div className="flex gap-2">
            <button onClick={() => handleCopy(reminderMsg)}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 active:scale-[0.99] border ${
                copied
                  ? "bg-green-500 text-white border-green-500"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600"
              }`}>
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy
                </>
              )}
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-3 bg-[#25D366] hover:bg-[#1fba59] text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 active:scale-[0.99]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>
            )}
          </div>
        </Modal>
      )}

      {receipt && (
        <TransactionDetailModal
          data={buildCreditStatementReceipt(receipt, profile?.business_name || profile?.owner_name || "My Business")}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* Payment receipt overlay */}
      {payReceipt && (
        <TransactionDetailModal
          data={buildCreditPaymentReceipt(payReceipt.payment, payReceipt.credit, profile?.business_name || profile?.owner_name || "My Business")}
          onClose={() => setPayReceipt(null)}
        />
      )}

      {/* Payment history overlay */}
      {historyFor && (() => {
        const payments = debtPayments.filter(p => p.credit_id === historyFor.id);
        const bizName  = profile?.business_name || profile?.owner_name || "My Business";

        const exportCreditPdf = async () => {
          const totalAmt = parseFloat(historyFor.total_amount) || 0;
          const sorted   = [...payments].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
          let outstanding = totalAmt;
          const rows = sorted.map(p => {
            const amt = parseFloat(p.amount) || 0;
            outstanding -= amt;
            return {
              date:        pdfFmtDate(p.created_at || p.payment_date),
              description: `Payment · ${(p.payment_method || "cash").replace(/_/g, " ")}`,
              reference:   p.notes || "—",
              debit:       "",
              credit:      pdfFmt(amt),
              balance:     pdfFmt(Math.max(0, outstanding)),
            };
          });
          const totPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
          const pdf = await createReportPdf({
            title: "Credit Payment History", businessName: bizName,
            period: historyFor.customer_name,
            headerRight: [
              { value: bizName },
              { value: historyFor.customer_name, sub: true },
              profile?.phone ? { value: profile.phone, sub: true } : null,
              profile?.email ? { value: profile.email, sub: true } : null,
            ].filter(Boolean),
            entityDetails: [
              { label: "Debtor",      value: historyFor.customer_name },
              { label: "Total Debt",  value: pdfFmt(totalAmt) },
              { label: "Total Paid",  value: pdfFmt(historyFor.amount_paid || totPaid) },
              { label: "Outstanding", value: pdfFmt(historyFor.outstanding || Math.max(0, totalAmt - totPaid)) },
            ],
          });
          pdf.addStats([
            { label: "Total Debt",   value: pdfFmt(totalAmt),                               color: "#64748b" },
            { label: "Amount Paid",  value: pdfFmt(historyFor.amount_paid || totPaid),        color: "#22c55e" },
            { label: "Outstanding",  value: pdfFmt(historyFor.outstanding || Math.max(0, totalAmt - totPaid)), color: "#ef4444" },
            { label: "Payments",     value: String(payments.length) },
          ]);
          pdf.addStatement(rows, { openingBalance: totalAmt, totalCredits: totPaid });
          await pdf.save(`Credit_Payments_${historyFor.customer_name.replace(/\s+/g, "_")}.pdf`);
        };

        return (
          <div className="fixed inset-0 z-[60] bg-black/60 flex flex-col">
            {payReceipt && (
              <TransactionDetailModal
                data={buildCreditPaymentReceipt(payReceipt.payment, payReceipt.credit, bizName)}
                onClose={() => setPayReceipt(null)}
              />
            )}
            <div className="bg-white dark:bg-slate-900 flex flex-col h-full max-w-lg w-full mx-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pb-4 border-b border-slate-100 dark:border-slate-800" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
                <div>
                  <h2 className="text-base font-black text-slate-800 dark:text-white">{historyFor.customer_name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Payment History · {payments.length} record{payments.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {payments.length > 0 && (
                    <button onClick={exportCreditPdf}
                      className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
                      </svg>
                    </button>
                  )}
                  {payments.length > 0 && (
                    <button onClick={async () => { const csv = buildCreditPaymentsCSV(payments, historyFor); await shareCSV(csv, creditCSVFilename(historyFor.customer_name)); }}
                      title="Export CSV"
                      className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </button>
                  )}
                  <button onClick={() => setHistoryFor(null)}
                    className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Credit summary bar */}
              <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/40 flex gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Total Paid</p>
                  <AmountDisplay amount={historyFor.amount_paid} size="small" align="left" colorBy="in" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Outstanding</p>
                  <AmountDisplay amount={historyFor.outstanding} size="small" align="left" colorBy="out" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Status</p>
                  <p className="text-sm font-black text-amber-600 capitalize truncate">{(historyFor.status || "active").replace(/_/g, " ")}</p>
                </div>
              </div>

              {/* Payment list */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {payments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <p className="text-slate-400 text-sm font-semibold">No payment records yet</p>
                    <p className="text-slate-400 text-xs mt-1">Payments recorded going forward will appear here</p>
                  </div>
                ) : payments.map(p => {
                  const dateStr = p.created_at
                    ? new Date(p.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                    : p.payment_date || "";
                  return (
                    <button key={p.id}
                      onClick={() => setPayReceipt({ payment: p, credit: historyFor })}
                      className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 active:scale-[0.98] transition-transform">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
                          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-extrabold text-green-600 dark:text-green-400 tabular-nums">+{fmt(p.amount)}</span>
                            <span className="text-[10px] font-bold text-slate-400">{dateStr}</span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                            {(p.payment_method || "cash").replace(/_/g, " ")}
                          </p>
                          {p.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{p.notes}"</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {profile_ && (
        <ClientProfile record={profile_} type="credit" onSave={updateCredit} onClose={() => setProfile_(null)} />
      )}
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
      {assigningCredit && (
        <AssignRecordModal
          type="credit"
          record={assigningCredit}
          branchList={store.branchList || []}
          staffList={store.staffList  || []}
          onSave={async (brId, stId) => {
            await store.updateCredit(assigningCredit.id, { branch_id: brId, staff_id: stId });
          }}
          onClose={() => setAssigningCredit(null)}
        />
      )}
    </div>
  );
}
