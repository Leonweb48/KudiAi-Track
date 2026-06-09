import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import { AsoReceipt }    from "../components/shared/Receipt";
import { ClientProfile } from "../components/shared/ClientProfile";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { supabase } from "../utils/supabase";
import { canDo } from "../utils/plans";
import { fmt, today } from "../utils/helpers";
import { useT } from "../contexts/LanguageContext";

const BLANK = {
  full_name: "", contribution_frequency: "daily", contribution_amount: "",
  registration_charge: "", withdrawal_fee_percent: 5, notes: "",
  phone: "", email: "", nin: "",
  address: "", state: "", lga: "", ward: "",
  next_of_kin: "", next_of_kin_phone: "", next_of_kin_email: "", next_of_kin_address: "",
};

const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30 };

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-5 mb-2">
      {children}
    </p>
  );
}

async function uploadPhoto(file, id) {
  const path = `clients/aso/${id}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

function daysDiff(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.floor((t - d) / 86400000);
}

function getMissedPayments(c) {
  if (!c.registration_date || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = daysDiff(c.registration_date);
  const expected = Math.floor(since / days);
  const actual   = Math.floor((c.total_saved || 0) / c.contribution_amount);
  return Math.max(0, expected - actual);
}

function getContribsMade(c) {
  if (!c.contribution_amount || c.contribution_amount <= 0) return 0;
  return Math.floor((c.total_saved || 0) / c.contribution_amount);
}

function getExpectedContribs(c) {
  if (!c.registration_date || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days  = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = daysDiff(c.registration_date);
  return Math.floor(since / days);
}

function isOverdue(c) {
  return c.status === "active" && c.next_contribution_date && daysDiff(c.next_contribution_date) > 0;
}

function buildReminderMsg(c, businessName) {
  const missed  = getMissedPayments(c);
  const freqMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
  const missedLine = missed > 0
    ? `\n⚠ Missed payments: ${missed}`
    : "";
  const biz = businessName ? `\nBusiness: ${businessName}` : "";
  return `Dear ${c.full_name},\n\nThis is a friendly reminder about your Aso savings contribution.${missedLine}\n\nFrequency: ${freqMap[c.contribution_frequency] || c.contribution_frequency}\nContribution Amount: ${fmt(c.contribution_amount)}\nNext Due Date: ${c.next_contribution_date || "N/A"}\nCurrent Balance: ${fmt(c.current_balance)}\nTotal Contributed: ${fmt(c.total_saved)}${biz}\n\nPlease keep your contributions up to date. Thank you!`;
}

function isGroupAccount(c) {
  const keywords = ["cooperative", "group", "association", "union", "society", "club", "community", "women", "men", "market", "traders"];
  const name = (c.full_name || "").toLowerCase();
  return keywords.some(k => name.includes(k));
}

export default function Aso({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const t = useT();
  const [showAdd,      setShowAdd]      = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [action,       setAction]       = useState(null);
  const [amt,          setAmt]          = useState("");
  const [receipt,      setReceipt]      = useState(null);
  const [clientProf,   setClientProf]   = useState(null);
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [adding,       setAdding]       = useState(false);
  const [reminderFor,  setReminderFor]  = useState(null);
  const [copied,       setCopied]       = useState(false);
  const [showPins,      setShowPins]      = useState({});
  const [portalCopied,  setPortalCopied]  = useState(null);
  const [createdClient, setCreatedClient] = useState(null);
  const [copiedField,   setCopiedField]   = useState(null);

  // Filters
  const [search,         setSearch]         = useState("");
  const [filter,         setFilter]         = useState("all");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dueBefore,      setDueBefore]      = useState("");

  const { asoClients, addAsoClient, asoContribute, asoWithdraw, updateAsoClient, profile, staffMap = {} } = store;

  const [f, setF] = useState(BLANK);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const lgas  = getLGAs(f.state);
  const wards = getWards(f.state, f.lga);

  useEffect(() => {
    if (autoOpen && canDo(plan, "aso")) {
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, onAutoOpened, plan]);

  // Aggregate stats
  const totalBal      = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const totalSaved    = asoClients.reduce((s, c) => s + (c.total_saved     || 0), 0);
  const overdueList   = asoClients.filter(isOverdue);
  const groupClients  = asoClients.filter(isGroupAccount);
  const indivClients  = asoClients.filter(c => !isGroupAccount(c));

  // Filtered list
  const filtered = asoClients
    .filter(c => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (c.full_name || "").toLowerCase().includes(q) || (c.phone || "").includes(q);
    })
    .filter(c => {
      if (filter === "active")   return c.status === "active" && !isOverdue(c);
      if (filter === "overdue")  return isOverdue(c);
      if (filter === "inactive") return c.status !== "active";
      if (filter === "groups")   return isGroupAccount(c);
      return true;
    })
    .filter(c => !dueBefore || (c.next_contribution_date && c.next_contribution_date <= dueBefore));

  const CHIPS = [
    { key: "all",      label: "All",      count: asoClients.length },
    { key: "active",   label: "Active",   count: asoClients.filter(c => c.status === "active" && !isOverdue(c)).length },
    { key: "overdue",  label: "Overdue",  count: overdueList.length },
    { key: "inactive", label: "Inactive", count: asoClients.filter(c => c.status !== "active").length },
    { key: "groups",   label: "Groups",   count: groupClients.length },
  ].filter(ch => ch.key === "all" || ch.count > 0);

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
    if (!f.full_name) return;
    setAdding(true);
    const { data, error } = await addAsoClient({
      ...f,
      contribution_amount:    parseFloat(f.contribution_amount    || 0),
      registration_charge:    parseFloat(f.registration_charge    || 0),
      withdrawal_fee_percent: parseFloat(f.withdrawal_fee_percent || 5),
      status:                 "active",
      next_contribution_date: today(),
    });
    if (!error && data && photoFile) {
      try {
        const url = await uploadPhoto(photoFile, data.id);
        await updateAsoClient(data.id, { profile_image_url: url });
      } catch (err) {
        console.error("Photo upload:", err);
      }
    }
    setAdding(false);
    if (!error && data) {
      resetAdd();
      setCreatedClient(data);
    } else {
      resetAdd();
    }
  };

  const copyField = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleCopy = (msg) => {
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reminderMsg = reminderFor ? buildReminderMsg(reminderFor, profile?.business_name) : "";
  const waLink = reminderFor?.phone
    ? `https://wa.me/${reminderFor.phone.replace(/\D/g, "")}?text=${encodeURIComponent(reminderMsg)}`
    : null;

  if (!canDo(plan, "aso")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-violet-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Business Plan Required</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 max-w-xs leading-relaxed">
          Aso savings management is available on the Business plan and above.
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">Manage client contributions, withdrawals & statements.</p>
        <button onClick={onUpgrade}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-md">
          Upgrade to Business — ₦2,500/mo
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">{t("aso.title")}</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-violet-600 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Hero */}
      <div className="rounded-3xl px-5 py-5 mb-4 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(135deg,#7c3aed 0%,#5b21b6 55%,#4c1d95 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Total Balance</p>
          <p className="text-3xl font-black tabular mb-4">{fmt(totalBal)}</p>
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Total Saved</p>
              <p className="text-sm font-extrabold tabular text-green-200">{fmt(totalSaved)}</p>
            </div>
            <div className="px-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Clients</p>
              <p className="text-sm font-extrabold tabular">
                {asoClients.length}
                {overdueList.length > 0 && (
                  <span className="ml-1 text-red-200"> · ⚠{overdueList.length}</span>
                )}
              </p>
            </div>
            <div className="pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Groups</p>
              <p className="text-sm font-extrabold tabular">{groupClients.length} <span className="text-white/40 font-normal text-[10px]">/ {indivClients.length} ind.</span></p>
            </div>
          </div>
        </div>
      </div>

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
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">Contributions past due date</p>
          </div>
          <button onClick={() => setFilter("overdue")}
            className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-transform">
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
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400/60 transition" />
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
                ? key === "overdue"  ? "bg-red-500 text-white shadow-sm"
                  : key === "groups" ? "bg-blue-500 text-white shadow-sm"
                  : "bg-violet-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            }`}>
            {label}
            {count > 0 && (
              <span className={`text-[10px] font-black ${filter === key ? "opacity-80" : "opacity-50"}`}>{count}</span>
            )}
          </button>
        ))}
        <button onClick={() => setShowDateFilter(v => !v)}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
            dueBefore ? "bg-blue-500 text-white shadow-sm" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          }`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {dueBefore || "Date"}
        </button>
      </div>

      {/* Date filter panel */}
      {showDateFilter && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 mb-2 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Next payment due on or before</p>
            <input type="date" value={dueBefore} onChange={e => setDueBefore(e.target.value)}
              className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none" />
          </div>
          {dueBefore && (
            <button onClick={() => setDueBefore("")}
              className="text-xs font-bold text-red-400 hover:text-red-600 transition">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {(search || filter !== "all" || dueBefore) && asoClients.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 font-medium">
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
          {search && ` for "${search}"`}
        </p>
      )}

      {/* Empty states */}
      {asoClients.length === 0 ? (
        <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-violet-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No savings clients yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to enroll your first client</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No matches found</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Try a different search or filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const initials       = (c.full_name || "?")[0].toUpperCase();
            const overdue        = isOverdue(c);
            const missed         = getMissedPayments(c);
            const made           = getContribsMade(c);
            const expected       = getExpectedContribs(c);
            const isGroup        = isGroupAccount(c);
            const nextDaysDiff   = daysDiff(c.next_contribution_date);
            const nextIsToday    = c.next_contribution_date === today();
            const nextIsSoon     = nextDaysDiff > -3 && nextDaysDiff <= 0;

            return (
              <div key={c.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border ${
                  overdue ? "border-red-200 dark:border-red-800/50" : "border-slate-100 dark:border-slate-700/60"
                }`}>

                {/* Card header — avatar opens profile */}
                <div className="flex items-start gap-3 mb-3">
                  <button onClick={() => setClientProf(c)}
                    className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform">
                    {c.profile_image_url
                      ? <img src={c.profile_image_url} alt={c.full_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white font-black text-base">{initials}</div>
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{c.full_name}</p>
                      {isGroup && (
                        <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Group</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {c.phone && <span className="text-xs text-slate-400 dark:text-slate-500">{c.phone}</span>}
                      {c.phone && <span className="text-slate-300 dark:text-slate-600 text-xs">·</span>}
                      <span className="text-xs text-slate-400 dark:text-slate-500 capitalize">{c.contribution_frequency} · {fmt(c.contribution_amount)}</span>
                    </div>
                    {staffMap[c.staff_id] && (
                      <span className="inline-block text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold mt-1">
                        {staffMap[c.staff_id]}
                      </span>
                    )}
                    {c.membership_number && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                          {c.membership_number}
                        </span>
                        {c.portal_pin && (
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            PIN: {showPins[c.id] ? c.portal_pin : "••••"}
                            <button
                              onClick={() => setShowPins(p => ({ ...p, [c.id]: !p[c.id] }))}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                {showPins[c.id]
                                  ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                                }
                              </svg>
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge status={overdue ? "overdue" : c.status} />
                    {missed > 0 && (
                      <span className="text-[10px] font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full">
                        {missed} missed
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-2 mb-3">
                  {[
                    { label: "Balance",   value: c.current_balance, color: "text-violet-700 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
                    { label: "Saved",     value: c.total_saved,     color: "text-green-700 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20"   },
                    { label: "Withdrawn", value: c.total_withdrawn,  color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-900/20"       },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`flex-1 ${bg} rounded-xl p-2.5`}>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-extrabold tabular ${color}`}>{fmt(value)}</p>
                    </div>
                  ))}
                </div>

                {/* Contribution tracking row */}
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Contribution Tracking</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${missed > 0 ? "bg-red-400" : "bg-violet-500"}`}
                          style={{ width: expected > 0 ? `${Math.min(100, (made / expected) * 100)}%` : "0%" }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {made}/{expected > 0 ? expected : "—"}
                      </span>
                    </div>
                    {missed > 0 && (
                      <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mt-1">{missed} payment{missed !== 1 ? "s" : ""} overdue</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Next Due</p>
                    <p className={`text-xs font-extrabold mt-0.5 ${
                      overdue ? "text-red-500 dark:text-red-400"
                        : nextIsToday || nextIsSoon ? "text-amber-500 dark:text-amber-400"
                        : "text-slate-700 dark:text-slate-200"
                    }`}>
                      {c.next_contribution_date || "—"}
                    </p>
                    {nextIsToday && <p className="text-[9px] text-amber-500 font-bold">Today!</p>}
                    {overdue && <p className="text-[9px] text-red-500 font-bold">{nextDaysDiff}d late</p>}
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                {/* Actions */}
                <div className="flex gap-2 pt-2.5 border-t border-slate-50 dark:border-slate-700/60">
                  <button onClick={() => { setSelected(c); setAction("contribute"); }}
                    className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 active:scale-95 transition">
                    + Contribute
                  </button>
                  <button onClick={() => { setSelected(c); setAction("withdraw"); }}
                    className="flex-1 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-xs border border-red-200 dark:border-red-800 active:scale-95 transition">
                    Withdraw
                  </button>
                  <button onClick={() => { setReminderFor(c); setCopied(false); }}
                    className={`py-2 px-3 rounded-xl font-bold text-xs border transition flex items-center gap-1.5 active:scale-[0.99] ${
                      overdue || missed > 0
                        ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                        : "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800"
                    }`}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                    </svg>
                    Remind
                  </button>
                  <button onClick={() => setReceipt(c)}
                    className="py-2 px-3 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-xl font-bold text-xs border border-violet-200 dark:border-violet-800 active:scale-[0.99] transition flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8" />
                    </svg>
                    Stmt
                  </button>
                  {c.membership_number && (
                    <button
                      onClick={() => {
                        const url = `https://kuditrack-kappa.vercel.app/?portal=1`;
                        navigator.clipboard.writeText(`Membership: ${c.membership_number}\nPIN: ${c.portal_pin}\nPortal: ${url}`).then(() => {
                          setPortalCopied(c.id);
                          setTimeout(() => setPortalCopied(null), 2000);
                        });
                      }}
                      className={`py-2 px-3 rounded-xl font-bold text-xs border transition flex items-center gap-1.5 active:scale-[0.99] ${
                        portalCopied === c.id
                          ? "bg-green-500 text-white border-green-500"
                          : "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                      }`}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        {portalCopied === c.id
                          ? <path d="M20 6L9 17l-5-5" />
                          : <><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="9" y1="7" x2="15" y2="7" /><line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="12" y2="15" /></>
                        }
                      </svg>
                      {portalCopied === c.id ? "Copied!" : "Portal"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Aso Client Modal ─────────────────────────────────────── */}
      {showAdd && (
        <Modal title="New Aso Client" onClose={resetAdd}>

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
              <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-violet-600 hover:bg-violet-700 rounded-full flex items-center justify-center cursor-pointer shadow-md transition active:scale-95">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
                </svg>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Tap camera to add photo</p>
          </div>

          <SectionLabel>Savings Settings</SectionLabel>
          <Field label="Full Name / Group Name *" value={f.full_name}
            onChange={e => set("full_name", e.target.value)} placeholder="e.g. Mama Ngozi Cooperative" />
          <Field label="Contribution Frequency" as="select" value={f.contribution_frequency}
            onChange={e => set("contribution_frequency", e.target.value)}>
            {["daily", "weekly", "monthly"].map(o => (
              <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
            ))}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Contribution (₦)" type="number" value={f.contribution_amount}
              onChange={e => set("contribution_amount", e.target.value)} placeholder="0.00" />
            <Field label="Reg. Fee (₦)" type="number" value={f.registration_charge}
              onChange={e => set("registration_charge", e.target.value)} placeholder="0.00" />
          </div>
          <Field label="Withdrawal Fee %" type="number" value={f.withdrawal_fee_percent}
            onChange={e => set("withdrawal_fee_percent", e.target.value)} placeholder="5" />

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
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes about this client…" />

          <button onClick={handleAdd}
            disabled={!f.full_name || adding}
            className="w-full py-3.5 mt-1 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm disabled:opacity-50">
            {adding ? "Saving…" : "Add Aso Client"}
          </button>
        </Modal>
      )}

      {/* Contribute / Withdraw modal */}
      {selected && action && (
        <Modal
          title={`${action === "contribute" ? "Record Contribution" : "Process Withdrawal"} — ${selected.full_name}`}
          onClose={() => { setSelected(null); setAction(null); setAmt(""); }}>

          <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl px-4 py-3 mb-3 border border-violet-100 dark:border-violet-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Current balance</p>
            <p className="text-xl font-black text-violet-700 dark:text-violet-400 tabular">{fmt(selected.current_balance)}</p>
          </div>

          {/* Contribution stats in modal */}
          {action === "contribute" && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: "Made",     value: getContribsMade(selected),    color: "text-green-600 dark:text-green-400" },
                { label: "Expected", value: getExpectedContribs(selected), color: "text-slate-700 dark:text-slate-200" },
                { label: "Missed",   value: getMissedPayments(selected),   color: getMissedPayments(selected) > 0 ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                  <p className={`text-base font-extrabold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {action === "withdraw" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2">
              ⚠ Withdrawal fee: {selected.withdrawal_fee_percent}% will be deducted
            </p>
          )}

          <Field label={`Amount (₦) — suggested: ${fmt(selected.contribution_amount)}`}
            type="number" inputMode="decimal" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder="Enter amount" />

          {action === "contribute" && selected.contribution_amount > 0 && (
            <button onClick={() => setAmt(String(selected.contribution_amount))}
              className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-3 -mt-1 block hover:underline">
              Use contribution amount ({fmt(selected.contribution_amount)})
            </button>
          )}

          <button
            onClick={() => {
              if (!amt) return;
              const a = parseFloat(amt);
              if (action === "contribute") asoContribute(selected.id, a);
              else asoWithdraw(selected.id, a);
              setSelected(null); setAction(null); setAmt("");
            }}
            className={`w-full py-3.5 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm ${
              action === "contribute" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            }`}>
            Confirm {action === "contribute" ? "Contribution" : "Withdrawal"}
          </button>
        </Modal>
      )}

      {/* Reminder modal */}
      {reminderFor && (
        <Modal title="Send Payment Reminder" onClose={() => setReminderFor(null)}>
          <div className="flex items-center gap-3 mb-4 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800/60">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              {reminderFor.profile_image_url
                ? <img src={reminderFor.profile_image_url} alt={reminderFor.full_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white font-black text-base">
                    {(reminderFor.full_name || "?")[0].toUpperCase()}
                  </div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{reminderFor.full_name}</p>
              <p className="text-xs text-violet-600 dark:text-violet-400 font-semibold capitalize">{reminderFor.contribution_frequency} · {fmt(reminderFor.contribution_amount)}</p>
            </div>
            {getMissedPayments(reminderFor) > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded-full flex-shrink-0">
                {getMissedPayments(reminderFor)} missed
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
        <AsoReceipt client={receipt} profile={profile} onClose={() => setReceipt(null)} />
      )}
      {clientProf && (
        <ClientProfile record={clientProf} type="aso" onSave={updateAsoClient} onClose={() => setClientProf(null)} />
      )}

      {/* ── Client Account Created Modal ─────────────────────────── */}
      {createdClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl max-h-[90vh] flex flex-col">
            <div className="overflow-y-auto flex-1 p-6">

              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-violet-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">Ajo Client Account Created</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Share these credentials with {createdClient.full_name.split(" ")[0]}</p>
                </div>
              </div>

              {/* Credential cards */}
              <div className="space-y-3 mb-5">

                {/* Client name */}
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Client Name</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{createdClient.full_name}</p>
                </div>

                {/* Membership Number */}
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Membership Number</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-white font-mono tracking-wider">{createdClient.membership_number}</p>
                    </div>
                    <button
                      onClick={() => copyField(createdClient.membership_number, "membership")}
                      className="ml-3 text-[11px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                      {copiedField === "membership" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* Portal PIN */}
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Portal PIN</p>
                      <p className="text-2xl font-black tracking-[0.3em] text-violet-600 dark:text-violet-400">{createdClient.portal_pin}</p>
                    </div>
                    <button
                      onClick={() => copyField(createdClient.portal_pin, "pin")}
                      className="ml-3 text-[11px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                      {copiedField === "pin" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* Portal URL */}
                <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide mb-0.5">Portal Login URL</p>
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300 break-all">kuditrack-kappa.vercel.app/?portal=1</p>
                </div>
              </div>

              {/* Copy all */}
              <button
                onClick={() => copyField(
                  `Ajo Client Portal Credentials\n\nName: ${createdClient.full_name}\nMembership: ${createdClient.membership_number}\nPIN: ${createdClient.portal_pin}\nPortal: https://kuditrack-kappa.vercel.app/?portal=1`,
                  "all"
                )}
                className={`w-full py-3 rounded-xl font-bold text-sm mb-3 transition flex items-center justify-center gap-2 active:scale-[0.99] border ${
                  copiedField === "all"
                    ? "bg-green-500 text-white border-green-500"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                }`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  {copiedField === "all"
                    ? <path d="M20 6L9 17l-5-5" />
                    : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>
                  }
                </svg>
                {copiedField === "all" ? "Copied!" : "Copy All Credentials"}
              </button>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl px-4 py-3 mb-4">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                  Client uses their Membership Number + PIN to log into the portal. They can change their PIN after first login.
                </p>
              </div>

              <button
                onClick={() => { setCreatedClient(null); setCopiedField(null); }}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-2xl py-3.5 text-sm transition">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
