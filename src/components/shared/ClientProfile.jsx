/**
 * Full client profile view + edit modal for Credit and Aso clients.
 * Handles photo upload, personal info, address (state/LGA/ward dropdowns),
 * NIN, and next-of-kin details.
 */
import { useState, useEffect } from "react";
import BankSelect from "./BankSelect";
import { supabase } from "../../utils/supabase";
import { bankLookup } from "../../utils/bankLookup";
import { STATES, getLGAs, getWards } from "../../utils/nigeriaData";
import { AmountDisplay } from "./AmountDisplay";
import { sendEmailTrigger } from "../../utils/emailTrigger";
import { useT } from "../../contexts/LanguageContext";

const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

/* ── Supabase image upload ────────────────────────────────────────── */
async function uploadClientPhoto(file, recordId, type) {
  const path = `clients/${type}/${recordId}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/* ── Shared form input style ─────────────────────────────────────── */
const inputCls =
  "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-slate-700 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50 transition";

function FormField({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SectionHead({ title, icon }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className="text-base">{icon}</span>
      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{title}</p>
    </div>
  );
}

/* ── Info row (view mode) ─────────────────────────────────────────── */
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 w-32">{label}</span>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right flex-1 break-words leading-relaxed">{value}</span>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────────── */
// On-screen status labels (the stored status never changes).
const STATUS_KEY = {
  active:           "ajo.profile.st_active",
  paid:             "ajo.profile.st_paid",
  partially_paid:   "ajo.profile.st_partially_paid",
  overdue:          "ajo.profile.st_overdue",
  pending_approval: "ajo.profile.st_pending_approval",
  rejected:         "ajo.profile.st_rejected",
  archived:         "ajo.profile.st_archived",
  inactive:         "ajo.profile.st_inactive",
};

function StatusBadge({ status }) {
  const t = useT();
  const map = {
    active:          "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    paid:            "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    partially_paid:  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    overdue:         "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  };
  const cls = map[status] || map.active;
  return (
    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide ${cls}`}>
      {STATUS_KEY[status || "active"] ? t(STATUS_KEY[status || "active"]) : (status || "active").replace("_", " ")}
    </span>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export function ClientProfile({ record, type, onSave, onClose, staffList = [], groups = [], onResetPwd, onDelete, onRequestArchive, canEditBank = false, businessName = "" }) {
  const t = useT();
  // Frequency is stored in English; only the label on screen is translated.
  const freqLabel = (f) => ({ daily: t("ajo.today.freq_daily"), weekly: t("ajo.today.freq_weekly"), monthly: t("ajo.today.freq_monthly"), custom: t("ajo.today.freq_custom") }[f] || f);
  // A self-registered client, awaiting the owner's terms + approval — open
  // straight into edit mode with the savings-terms fields ready to fill in.
  const isPendingReg = type === "aso" && record?.status === "pending_approval";
  const [editing,      setEditing]      = useState(isPendingReg);
  const [form,         setForm]         = useState({ ...record });
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState("");
  const [resetting,    setResetting]    = useState(false);
  const [resetErr,     setResetErr]     = useState("");
  const [confirmDel,   setConfirmDel]   = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [delErr,       setDelErr]       = useState("");
  const [archivePin,    setArchivePin]    = useState("");
  const [pinErr,        setPinErr]        = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveReqSent, setArchiveReqSent] = useState(false);

  // Deposit subaccount editing state (owner-only)
  const [banks,                      setBanks]                      = useState([]);
  const [bankResolving,              setBankResolving]              = useState(false);
  const [bankResolvedName,           setBankResolvedName]           = useState("");
  const [bankErr,                    setBankErr]                    = useState("");

  // Withdrawal (payout) account editing state
  const [withdrawalBankResolving,    setWithdrawalBankResolving]    = useState(false);
  const [withdrawalBankResolvedName, setWithdrawalBankResolvedName] = useState("");
  const [withdrawalBankErr,          setWithdrawalBankErr]          = useState("");

  // Multi-group membership state (aso clients only)
  const [groupMemberships, setGroupMemberships] = useState([]);
  const [addGroupId,       setAddGroupId]       = useState("");
  const [groupOpBusy,      setGroupOpBusy]      = useState(false);
  const [groupOpErr,       setGroupOpErr]       = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const isCredit = type === "credit";
  // Ajo clients now do their own KYC (BVN/NIN/address/next of kin) on first
  // login — the owner never sets or edits it, here or at "Add client".
  const isAso    = type === "aso";

  // Load bank list when entering edit mode for any Aso client
  useEffect(() => {
    if (!editing || isCredit || banks.length > 0) return;
    bankLookup("list-banks")
      .then(({ data }) => { if (data?.data) setBanks(data.data); })
      .catch(() => {});
  }, [editing, isCredit, banks.length]);

  // Load group memberships for aso clients
  useEffect(() => {
    if (isCredit || !record?.id) return;
    supabase.from("aso_client_group_memberships")
      .select("group_id, status, ajo_groups(id, name, group_mode)")
      .eq("client_id", record.id)
      .eq("status", "active")
      .then(({ data }) => setGroupMemberships(data || []))
      .catch(() => {});
  }, [record?.id, isCredit]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoinGroup = async () => {
    if (!addGroupId || groupOpBusy) return;
    setGroupOpBusy(true); setGroupOpErr("");
    const { error } = await supabase.functions.invoke("ajo-portal", {
      body: { action: "join-group", client_id: record.id, group_id: addGroupId, owner_id: record.user_id },
    });
    if (error) { setGroupOpErr(t("ajo.profile.addGroupFailed")); }
    else {
      const grp = groups.find(g => g.id === addGroupId);
      if (grp) setGroupMemberships(prev => [...prev, { group_id: grp.id, status: "active", ajo_groups: grp }]);
      setAddGroupId("");
    }
    setGroupOpBusy(false);
  };

  const handleLeaveGroup = async (groupId) => {
    if (groupOpBusy) return;
    setGroupOpBusy(true); setGroupOpErr("");
    const { error } = await supabase.functions.invoke("ajo-portal", {
      body: { action: "leave-group", client_id: record.id, group_id: groupId, owner_id: record.user_id },
    });
    if (error) { setGroupOpErr(t("ajo.profile.removeGroupFailed")); }
    else setGroupMemberships(prev => prev.filter(m => m.group_id !== groupId));
    setGroupOpBusy(false);
  };

  const resolveWithdrawalBank = async () => {
    const acctNo = String(form.withdrawal_account_number || "");
    if (!form.withdrawal_bank_code || acctNo.length < 10) return;
    setWithdrawalBankResolving(true); setWithdrawalBankErr(""); setWithdrawalBankResolvedName("");
    try {
      const { data, error } = await bankLookup("resolve-account", { account_number: acctNo, bank_code: form.withdrawal_bank_code });
      if (error || !data?.status) throw new Error(data?.message || t("ajo.profile.couldNotVerifyAccount"));
      const name = data.data?.account_name || "";
      setWithdrawalBankResolvedName(name);
      set("withdrawal_account_name", name);
      const b = banks.find(bk => bk.code === form.withdrawal_bank_code);
      if (b) set("withdrawal_bank_name", b.name);
    } catch (e) {
      setWithdrawalBankErr(e.message || t("ajo.profile.couldNotVerifyAccountNumber"));
    } finally {
      setWithdrawalBankResolving(false);
    }
  };

  const resolveBank = async () => {
    if (!form.bank_code || !form.account_number || String(form.account_number).length < 10) return;
    setBankResolving(true); setBankErr(""); setBankResolvedName("");
    try {
      const { data, error } = await bankLookup("resolve-account", { account_number: form.account_number, bank_code: form.bank_code });
      if (error || !data?.status) throw new Error(data?.message || t("ajo.profile.couldNotVerifyAccount"));
      const name = data.data?.account_name || "";
      setBankResolvedName(name);
      set("account_name", name);
      const b = banks.find(bk => bk.code === form.bank_code);
      if (b) set("bank_name", b.name);
    } catch (e) {
      setBankErr(e.message || t("ajo.profile.couldNotVerifyAccountNumber"));
    } finally {
      setBankResolving(false);
    }
  };
  const name     = isCredit ? (record.customer_name || t("ajo.profile.client")) : (record.full_name || t("ajo.profile.client"));
  const initials = name[0]?.toUpperCase() || "C";
  const avatarSrc = photoPreview || form.profile_image_url;

  const lgas  = getLGAs(form.state  || "");
  const wards = getWards(form.state || "", form.lga || "");

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleStateChange = (s) => setForm(p => ({ ...p, state: s, lga: "", ward: "" }));
  const handleLgaChange   = (l) => setForm(p => ({ ...p, lga: l, ward: "" }));

  const doReset = async () => {
    setResetting(true);
    setResetErr("");
    const res = await onResetPwd(record);
    setResetting(false);
    if (res?.error) setResetErr(res.error);
  };

  const doDelete = async () => {
    if (!archivePin || archivePin.length < 4) {
      setPinErr(t("ajo.profile.enterPin"));
      return;
    }
    setPinErr("");
    setDeleting(true);
    setDelErr("");
    // Verify PIN server-side first (pin-manager), then pass to onDelete for edge-fn re-verify
    const { data: pinData } = await supabase.functions.invoke("pin-manager", {
      body: { action: "verify_txn_pin", pin: archivePin },
    });
    if (!pinData?.success) {
      setDeleting(false);
      setPinErr(pinData?.locked ? t("ajo.profile.pinLocked") : t("ajo.profile.pinIncorrect"));
      setArchivePin("");
      return;
    }
    const res = await onDelete(record.id, archivePin);
    setDeleting(false);
    if (res?.error) { setDelErr(res.error); return; }
    onClose();
  };

  const doRequestArchive = async () => {
    if (!archivePin || archivePin.length < 4) {
      setPinErr(t("ajo.profile.enterPin"));
      return;
    }
    if (!archiveReason.trim()) {
      setDelErr(t("ajo.profile.reasonRequiredErr"));
      return;
    }
    setPinErr(""); setDelErr(""); setDeleting(true);
    const { data: pinData } = await supabase.functions.invoke("pin-manager", {
      body: { action: "verify_txn_pin", pin: archivePin },
    });
    if (!pinData?.success) {
      setDeleting(false);
      setPinErr(pinData?.locked ? t("ajo.profile.pinLocked") : t("ajo.profile.pinIncorrect"));
      setArchivePin("");
      return;
    }
    const res = await onRequestArchive(record.id, archivePin, archiveReason.trim());
    setDeleting(false);
    if (res?.error) { setDelErr(res.error); return; }
    setArchiveReqSent(true);
    setTimeout(() => onClose(), 2500);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveErr("");
    let imageUrl = form.profile_image_url;

    if (photoFile && record.id) {
      try {
        imageUrl = await uploadClientPhoto(photoFile, record.id, isCredit ? "credit" : "aso");
      } catch (err) {
        setSaveErr(t("ajo.profile.photoUploadFailed", { msg: err.message }));
        setSaving(false);
        return;
      }
    }

    const updates = { ...form, profile_image_url: imageUrl };
    const { error } = await onSave(record.id, updates);
    if (error) {
      setSaving(false);
      setSaveErr(error.message || t("ajo.profile.saveFailed"));
      return;
    }

    setSaving(false);
    setEditing(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    setBankResolvedName("");
    setBankErr("");
  };

  const approve = async () => {
    setSaving(true); setSaveErr("");
    const updates = { ...form, status: "active", next_contribution_date: new Date().toISOString().slice(0, 10) };
    const { error } = await onSave(record.id, updates);
    setSaving(false);
    if (error) { setSaveErr(error.message || t("ajo.profile.approveFailed")); return; }
    if (record.email) {
      sendEmailTrigger("ajo_registration_approved", {
        client_email: record.email,
        client_name:  form.full_name || record.full_name || "",
        business_name: businessName || "",
      });
    }
    onClose();
  };

  const decline = async () => {
    setSaving(true); setSaveErr("");
    const { error } = await onSave(record.id, { status: "rejected" });
    setSaving(false);
    if (error) { setSaveErr(error.message || t("ajo.profile.declineFailed")); return; }
    onClose();
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm({ ...record });
    setPhotoFile(null);
    setPhotoPreview(null);
    setSaveErr("");
    setBankResolvedName("");
    setBankErr("");
  };

  /* ── shared overlay wrapper ─────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50 dark:bg-slate-900 fade-in">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
        <button onClick={editing ? cancelEdit : onClose}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 dark:text-white text-base truncate">{name}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{isCredit ? t("ajo.profile.creditProfile") : t("ajo.profile.asoClientProfile")}</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition active:scale-95">
            {t("common.edit")}
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Profile header card ─────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <div className="px-5 pt-6 pb-5 flex items-center gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-slate-100 dark:border-slate-600 shadow-sm">
                {avatarSrc
                  ? <img src={avatarSrc} alt={name} className="w-full h-full object-cover" />
                  : <div className={`w-full h-full flex items-center justify-center text-white font-black text-3xl ${
                      isCredit ? "bg-gradient-to-br from-amber-400 to-amber-600" : "bg-gradient-to-br from-violet-500 to-violet-700"
                    }`}>
                      {initials}
                    </div>
                }
              </div>
              {editing && (
                <label className="absolute -bottom-1 -right-1 w-7 h-7 bg-brand-600 rounded-full flex items-center justify-center cursor-pointer shadow-md hover:bg-brand-700 transition">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
              )}
            </div>

            {/* Name + status */}
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-xl text-slate-900 dark:text-white leading-tight truncate">{name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusBadge status={record.status} />
                {record.phone && <p className="text-xs text-slate-400 dark:text-slate-500">{record.phone}</p>}
              </div>
            </div>
          </div>

          {/* Financial summary strip */}
          {isCredit ? (
            <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
              {[
                { label: t("common.total"),            amount: record.total_amount, color: '#334155' },
                { label: t("ajo.profile.paid"),        amount: record.amount_paid,  color: '#16a34a' },
                { label: t("ajo.profile.outstanding"), amount: record.outstanding,  color: '#ef4444' },
              ].map(({ label, amount, color }) => (
                <div key={label} className="px-2 py-3 text-center min-w-0">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
                  <AmountDisplay amount={amount} size="small" align="center" style={{ color, marginTop: 2 }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
              {[
                { label: t("ajo.profile.balance"),   amount: record.current_balance, color: '#7c3aed' },
                { label: t("ajo.profile.deposited"), amount: record.total_saved,     color: '#16a34a' },
                { label: t("ajo.profile.withdrawn"), amount: record.total_withdrawn,  color: '#475569' },
              ].map(({ label, amount, color }) => (
                <div key={label} className="px-2 py-3 text-center min-w-0">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
                  <AmountDisplay amount={amount} size="small" align="center" style={{ color, marginTop: 2 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="px-4 py-5 space-y-5">

          {editing ? (
            /* ===== EDIT MODE ===== */
            <>
              {isPendingReg && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-2xl px-4 py-3.5">
                  <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-1">{t("ajo.profile.newRegistration")}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    {t("ajo.profile.newRegistrationBody", { name: form.full_name })}
                  </p>
                </div>
              )}
              {/* Personal info */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.personalInfo")} icon="👤" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label={isCredit ? t("ajo.profile.customerName") : t("ajo.profile.fullName")} required>
                    <input
                      value={isCredit ? (form.customer_name || "") : (form.full_name || "")}
                      onChange={e => set(isCredit ? "customer_name" : "full_name", e.target.value)}
                      placeholder={isCredit ? t("ajo.profile.customerFullNamePh") : t("ajo.profile.clientFullNamePh")}
                      className={inputCls}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label={t("ajo.profile.phone")}>
                      <input type="tel" value={form.phone || ""} onChange={e => set("phone", e.target.value)}
                        placeholder="08012345678" className={inputCls} />
                    </FormField>
                    <FormField label={t("ajo.profile.email")}>
                      <input type="email" value={form.email || ""} onChange={e => set("email", e.target.value)}
                        placeholder="email@example.com" className={inputCls} />
                    </FormField>
                  </div>
                  {!isAso && (
                    <FormField label={t("ajo.profile.nin")}>
                      <input type="text" inputMode="numeric" value={form.nin || ""}
                        onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
                        placeholder={t("ajo.profile.ninPh")} className={inputCls} />
                    </FormField>
                  )}
                </div>
              </div>

              {/* Savings settings — Aso only */}
              {!isCredit && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.savingsSettings")} icon="💰" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("ajo.profile.frequency")}>
                        <select value={form.contribution_frequency || "monthly"} onChange={e => set("contribution_frequency", e.target.value)} className={inputCls}>
                          {["daily","weekly","monthly"].map(fr => <option key={fr} value={fr}>{t(`ajo.profile.freqOpt_${fr}`)}</option>)}
                        </select>
                      </FormField>
                      <FormField label={t("ajo.profile.contributionNaira")}>
                        <input type="number" value={form.contribution_amount || ""} onChange={e => set("contribution_amount", parseFloat(e.target.value)||0)} className={inputCls} placeholder="0.00" />
                      </FormField>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("ajo.profile.withdrawalFee")}>
                        <select value={form.commission_model || "none"} onChange={e => set("commission_model", e.target.value)} className={inputCls}>
                          <option value="none">{t("ajo.profile.noFee")}</option>
                          {form.commission_model === "first_period" && <option value="first_period" disabled>{t("ajo.firstPeriodRetired")}</option>}
                          <option value="percent">{t("ajo.profile.percentage")}</option>
                        </select>
                      </FormField>
                      {form.commission_model === "percent" && (
                        <FormField label={t("ajo.profile.feePct")}>
                          <input type="number" value={form.commission_percent || ""} onChange={e => set("commission_percent", parseFloat(e.target.value) || null)} className={inputCls} placeholder={t("ajo.profile.eg5")} min="0.01" max="100" step="0.01" />
                        </FormField>
                      )}
                    </div>
                    <FormField label={t("ajo.profile.registrationFeeNaira")}>
                      <input type="number" min="0" value={form.registration_charge || ""} onChange={e => set("registration_charge", parseFloat(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-snug">{t("ajo.profile.regFeeNote")}</p>
                    </FormField>
                    <FormField label={t("ajo.profile.nextDueDate")}>
                      <input type="date" value={form.next_contribution_date || ""} onChange={e => set("next_contribution_date", e.target.value)} className={inputCls} />
                    </FormField>
                    {staffList.length > 0 && (
                      <FormField label={t("ajo.profile.assignedStaff")}>
                        <select value={form.staff_id || ""} onChange={e => set("staff_id", e.target.value)} className={inputCls}>
                          <option value="">{t("ajo.profile.noStaff")}</option>
                          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </FormField>
                    )}
                    {/* Group Memberships — multi-group support */}
                    {!isCredit && (
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">{t("ajo.profile.groupMemberships")}</p>
                        {groupMemberships.length === 0 && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-2">{t("ajo.profile.notInGroup")}</p>
                        )}
                        <div className="space-y-1.5 mb-2">
                          {groupMemberships.map(m => (
                            <div key={m.group_id} className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{m.ajo_groups?.name || t("ajo.profile.unknownGroup")}</p>
                                <p className="text-[10px] text-slate-400">{m.ajo_groups?.group_mode === "rotating" ? t("ajo.profile.esusuRotating") : t("ajo.profile.savingsGroup")}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleLeaveGroup(m.group_id)}
                                disabled={groupOpBusy}
                                className="ml-2 text-[10px] font-bold text-red-500 dark:text-red-400 disabled:opacity-40 flex-shrink-0 active:opacity-60"
                              >
                                {t("ajo.profile.remove")}
                              </button>
                            </div>
                          ))}
                        </div>
                        {groups.filter(g => !groupMemberships.some(m => m.group_id === g.id)).length > 0 && (
                          <div className="flex gap-2 items-center">
                            <select
                              value={addGroupId}
                              onChange={e => setAddGroupId(e.target.value)}
                              className={inputCls + " text-xs py-2"}
                            >
                              <option value="">{t("ajo.profile.addToGroup")}</option>
                              {groups.filter(g => !groupMemberships.some(m => m.group_id === g.id)).map(g => (
                                <option key={g.id} value={g.id}>{g.name}{g.group_mode === "rotating" ? " (Esusu)" : ""}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={handleJoinGroup}
                              disabled={!addGroupId || groupOpBusy}
                              className="px-3 py-2 bg-brand-500 text-white rounded-xl text-xs font-bold disabled:opacity-40 whitespace-nowrap active:scale-95 transition-transform"
                            >
                              {groupOpBusy ? "…" : t("ajo.profile.add")}
                            </button>
                          </div>
                        )}
                        {groupOpErr && <p className="text-[11px] text-red-500 mt-1">{groupOpErr}</p>}
                      </div>
                    )}
                    <FormField label={t("ajo.profile.notes")}>
                      <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={2}
                        placeholder={t("ajo.profile.optionalNotesPh")} className={inputCls + " resize-none"} />
                    </FormField>
                  </div>
                </div>
              )}

              {/* Payout Account — where money is sent TO this client on withdrawal */}
              {!isCredit && canEditBank && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.payoutAccount")} icon="🏦" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed -mt-1">
                      {t("ajo.profile.payoutAccountNoteOwner")}
                    </p>
                    <FormField label={t("ajo.profile.bank")}>
                      <BankSelect banks={banks} value={form.bank_code || ""} disabled={banks.length === 0} className="h-11"
                        placeholder={banks.length === 0 ? t("ajo.profile.loadingBanks") : t("ajo.profile.selectBank")}
                        onChange={(code, b) => {
                          set("bank_code", code);
                          set("bank_name", b?.name || "");
                          set("account_name", "");
                          setBankResolvedName(""); setBankErr("");
                        }} />
                    </FormField>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <FormField label={t("ajo.profile.accountNumber")}>
                          <input
                            type="text" inputMode="numeric"
                            value={form.account_number || ""}
                            onChange={e => {
                              set("account_number", e.target.value.replace(/\D/g, "").slice(0, 10));
                              set("account_name", "");
                              setBankResolvedName(""); setBankErr("");
                            }}
                            placeholder={t("ajo.profile.nubanPh")}
                            className={inputCls}
                          />
                        </FormField>
                      </div>
                      <button type="button" onClick={resolveBank}
                        disabled={bankResolving || !form.bank_code || String(form.account_number || "").length < 10}
                        className="mb-0.5 px-3 py-[11px] rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                        {bankResolving ? t("ajo.profile.checking") : t("ajo.profile.verify")}
                      </button>
                    </div>
                    {(bankResolvedName || form.account_name) && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold -mt-1 flex items-center gap-1">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        {bankResolvedName || form.account_name}
                      </p>
                    )}
                    {bankErr && <p className="text-xs text-red-500 -mt-1">{bankErr}</p>}
                  </div>
                </div>
              )}

              {/* Ajo clients: withdrawal payouts auto-route to the client's own KudiAI
                  Wallet (next business working day) — no bank account to configure. */}
              {!isCredit && isAso && (
                <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/40 rounded-2xl px-4 py-3.5 flex items-start gap-2.5">
                  <span className="text-lg leading-none">💸</span>
                  <div>
                    <p className="text-[13px] font-bold text-slate-800 dark:text-white">{t("ajo.profile.payoutAccount")}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      {t("ajo.profile.payoutToWalletNote")}
                    </p>
                  </div>
                </div>
              )}

              {/* Payout (Withdrawal) Account — client-set, optional, verifiable (Coop) */}
              {!isCredit && !isAso && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.payoutAccount")} icon="💸" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed -mt-1">
                      {t("ajo.profile.payoutAccountNoteCoop")}
                    </p>
                    <FormField label={t("ajo.profile.bank")}>
                      <BankSelect banks={banks} value={form.withdrawal_bank_code || ""} className="h-11"
                        placeholder={banks.length === 0 ? t("ajo.profile.loadingBanks") : t("ajo.profile.selectBank")}
                        onChange={(code, b) => {
                          set("withdrawal_bank_code", code);
                          set("withdrawal_bank_name", b?.name || "");
                          set("withdrawal_account_name", "");
                          setWithdrawalBankResolvedName(""); setWithdrawalBankErr("");
                        }} />
                    </FormField>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <FormField label={t("ajo.profile.accountNumber")}>
                          <input
                            type="text" inputMode="numeric"
                            value={form.withdrawal_account_number || ""}
                            onChange={e => {
                              set("withdrawal_account_number", e.target.value.replace(/\D/g, "").slice(0, 10));
                              set("withdrawal_account_name", "");
                              setWithdrawalBankResolvedName(""); setWithdrawalBankErr("");
                            }}
                            placeholder={t("ajo.profile.nubanPh")}
                            className={inputCls}
                          />
                        </FormField>
                      </div>
                      <button type="button" onClick={resolveWithdrawalBank}
                        disabled={withdrawalBankResolving || !form.withdrawal_bank_code || String(form.withdrawal_account_number || "").length < 10}
                        className="mb-0.5 px-3 py-[11px] rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                        {withdrawalBankResolving ? t("ajo.profile.checking") : t("ajo.profile.verify")}
                      </button>
                    </div>
                    {(withdrawalBankResolvedName || form.withdrawal_account_name) && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold -mt-1 flex items-center gap-1">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        {withdrawalBankResolvedName || form.withdrawal_account_name}
                      </p>
                    )}
                    {withdrawalBankErr && <p className="text-xs text-red-500 -mt-1">{withdrawalBankErr}</p>}
                  </div>
                </div>
              )}

              {/* Address — Ajo clients set this themselves on first login */}
              {!isAso && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.address")} icon="📍" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <FormField label={t("ajo.profile.streetAddress")}>
                      <input value={form.address || ""} onChange={e => set("address", e.target.value)}
                        placeholder="12 Market Road, Onitsha" className={inputCls} />
                    </FormField>
                    <FormField label={t("ajo.profile.state")}>
                      <select value={form.state || ""} onChange={e => handleStateChange(e.target.value)} className={inputCls}>
                        <option value="">{t("ajo.profile.selectState")}</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("ajo.profile.lga")}>
                        <select value={form.lga || ""} onChange={e => handleLgaChange(e.target.value)}
                          disabled={!form.state} className={inputCls}>
                          <option value="">{form.state ? t("ajo.profile.selectLga") : t("ajo.profile.selectStateFirst")}</option>
                          {lgas.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </FormField>
                      <FormField label={t("ajo.profile.ward")}>
                        <select value={form.ward || ""} onChange={e => set("ward", e.target.value)}
                          disabled={!form.lga} className={inputCls}>
                          <option value="">{form.lga ? t("ajo.profile.selectWard") : t("ajo.profile.selectLgaFirst")}</option>
                          {wards.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </FormField>
                    </div>
                  </div>
                </div>
              )}

              {/* Next of Kin — Ajo clients set this themselves on first login */}
              {!isAso && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.nextOfKin")} icon="👨‍👩‍👦" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <FormField label={t("ajo.profile.fullName")}>
                      <input value={form.next_of_kin || ""} onChange={e => set("next_of_kin", e.target.value)}
                        placeholder={t("ajo.profile.nokNamePh")} className={inputCls} />
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("ajo.profile.phone")}>
                        <input type="tel" value={form.next_of_kin_phone || ""} onChange={e => set("next_of_kin_phone", e.target.value)}
                          placeholder="08012345678" className={inputCls} />
                      </FormField>
                      <FormField label={t("ajo.profile.email")}>
                        <input type="email" value={form.next_of_kin_email || ""} onChange={e => set("next_of_kin_email", e.target.value)}
                          placeholder="email@example.com" className={inputCls} />
                      </FormField>
                    </div>
                    <FormField label={t("ajo.profile.address")}>
                      <input value={form.next_of_kin_address || ""} onChange={e => set("next_of_kin_address", e.target.value)}
                        placeholder={t("ajo.profile.nokAddressPh")} className={inputCls} />
                    </FormField>
                  </div>
                </div>
              )}

              {/* Error */}
              {saveErr && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                  {saveErr}
                </div>
              )}

              {/* Save / Cancel — or Approve / Decline for a pending self-registration */}
              {isPendingReg ? (
                <div className="grid grid-cols-2 gap-3 pb-6">
                  <button onClick={decline} disabled={saving}
                    className="py-3.5 rounded-xl font-bold text-sm bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 transition active:scale-[0.99] disabled:opacity-60">
                    {t("ajo.profile.decline")}
                  </button>
                  <button onClick={approve} disabled={saving}
                    className="py-3.5 rounded-xl font-bold text-sm bg-brand-600 hover:bg-brand-700 text-white transition active:scale-[0.99] disabled:opacity-60 shadow-sm">
                    {saving ? t("ajo.profile.approving") : t("ajo.profile.approveActivate")}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pb-6">
                  <button onClick={cancelEdit}
                    className="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-[0.99]">
                    {t("common.cancel")}
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="py-3.5 rounded-xl font-bold text-sm bg-brand-600 hover:bg-brand-700 text-white transition active:scale-[0.99] disabled:opacity-60 shadow-sm">
                    {saving ? t("common.saving") : t("ajo.profile.saveProfile")}
                  </button>
                </div>
              )}
            </>
          ) : (
            /* ===== VIEW MODE ===== */
            <>
              {/* Personal info */}
              {(record.phone || record.email || record.nin || record.address) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.personalInfo")} icon="👤" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label={t("ajo.profile.phone")}   value={record.phone} />
                    <InfoRow label={t("ajo.profile.email")}   value={record.email} />
                    <InfoRow label={t("ajo.profile.nin")}     value={record.nin} />
                    <InfoRow label={t("ajo.profile.address")} value={record.address} />
                    <InfoRow label={t("ajo.profile.state")}   value={[record.state, record.lga, record.ward].filter(Boolean).join(" · ") || null} />
                  </div>
                </div>
              )}

              {/* Next of Kin */}
              {(record.next_of_kin || record.next_of_kin_phone) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.nextOfKin")} icon="👨‍👩‍👦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label={t("common.name")}    value={record.next_of_kin} />
                    <InfoRow label={t("ajo.profile.phone")}   value={record.next_of_kin_phone} />
                    <InfoRow label={t("ajo.profile.email")}   value={record.next_of_kin_email} />
                    <InfoRow label={t("ajo.profile.address")} value={record.next_of_kin_address} />
                  </div>
                </div>
              )}

              {/* Credit / Aso specific info */}
              {isCredit ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.creditDetails")} icon="💳" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label={t("ajo.profile.dueDate")}   value={record.due_date} />
                    <InfoRow label={t("ajo.profile.dateGiven")} value={record.date_given} />
                    <InfoRow label={t("ajo.profile.notes")}      value={record.notes} />
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title={t("ajo.profile.savingsDetails")} icon="🏦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label={t("ajo.profile.frequency")}    value={freqLabel(record.contribution_frequency)} />
                    <InfoRow label={t("ajo.profile.contribution")} value={fmt(record.contribution_amount)} />
                    {Number(record.registration_charge) > 0 && <InfoRow label={t("ajo.profile.registrationFee")} value={fmt(record.registration_charge)} />}
                    <InfoRow label={t("ajo.profile.nextDue")}     value={record.next_contribution_date} />
                    <InfoRow label={t("ajo.profile.registered")}   value={record.registration_date} />
                    <InfoRow label={t("ajo.profile.notes")}        value={record.notes} />
                    {record.account_number && (
                      <>
                        <div className="pt-1 pb-0.5">
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t("ajo.profile.payoutAccount")}</p>
                        </div>
                        <InfoRow label={t("ajo.profile.bank")}         value={record.bank_name} />
                        <InfoRow label={t("ajo.profile.accountNo")}  value={record.account_number} />
                        <InfoRow label={t("ajo.profile.accountName")} value={record.account_name} />
                      </>
                    )}
                    {record.withdrawal_account_number && (
                      <>
                        <div className="pt-2 pb-0.5">
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t("ajo.profile.payoutAccount")}</p>
                        </div>
                        <InfoRow label={t("ajo.profile.bank")}         value={record.withdrawal_bank_name} />
                        <InfoRow label={t("ajo.profile.accountNo")}  value={record.withdrawal_account_number} />
                        <InfoRow label={t("ajo.profile.accountName")} value={record.withdrawal_account_name} />
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Reset portal password — Aso only */}
              {!isCredit && onResetPwd && (
                <div className="space-y-2">
                  {resetErr && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                      {resetErr}
                    </div>
                  )}
                  <button onClick={doReset} disabled={resetting}
                    className="w-full py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-2xl font-bold text-sm border border-amber-200 dark:border-amber-800 active:scale-[0.99] transition disabled:opacity-60">
                    {resetting ? t("ajo.profile.resettingPassword") : t("ajo.profile.resetPortalPassword")}
                  </button>
                </div>
              )}

              {/* Archive client — Aso only (approval-gated; preserves all history) */}
              {!isCredit && onRequestArchive && (
                <div className="space-y-2">
                  {archiveReqSent ? (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl px-4 py-4 text-center">
                      <p className="text-sm font-extrabold text-green-700 dark:text-green-400">{t("ajo.profile.requestSubmitted")}</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1 leading-relaxed">{t("ajo.profile.requestSubmittedBody")}</p>
                    </div>
                  ) : (
                    <>
                      {delErr && (
                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                          {delErr}
                        </div>
                      )}
                      {!confirmDel ? (
                        <button
                          onClick={() => {
                            if ((record.current_balance || 0) !== 0) {
                              setDelErr(t("ajo.profile.balanceMustBeZeroRequest", { balance: fmt(record.current_balance) }));
                              return;
                            }
                            setDelErr(""); setArchivePin(""); setPinErr(""); setArchiveReason("");
                            setConfirmDel(true);
                          }}
                          className="w-full py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-2xl font-bold text-sm border border-amber-200 dark:border-amber-800 active:scale-[0.99] transition flex items-center justify-center gap-2">
                          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                            <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                          </svg>
                          {t("ajo.profile.requestClientArchive")}
                        </button>
                      ) : (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-3">
                          <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400">{t("ajo.profile.requestArchiveFor", { name: record.full_name })}</p>

                          {/* Client snapshot */}
                          <div className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 space-y-1 border border-amber-100 dark:border-amber-900/40">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t("ajo.profile.clientSummary")}</p>
                            {record.membership_number && <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{record.membership_number}</p>}
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">{t("ajo.profile.totalDeposited")} <span className="font-bold text-green-600 dark:text-green-400">{fmt(record.total_saved)}</span></p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">{t("ajo.profile.totalWithdrawn")} <span className="font-bold">{fmt(record.total_withdrawn)}</span></p>
                            <p className="text-[11px] font-bold text-green-700 dark:text-green-400 flex items-center gap-1">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              {t("ajo.profile.balanceConfirmedZero")}
                            </p>
                          </div>

                          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            {t("ajo.profile.archiveRequestNote")}
                          </p>

                          {/* Reason */}
                          <div>
                            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">{t("ajo.profile.reason")} <span className="text-red-500">*</span></p>
                            <textarea
                              rows={2}
                              value={archiveReason}
                              onChange={e => { setArchiveReason(e.target.value); setDelErr(""); }}
                              placeholder={t("ajo.profile.whyArchivePh")}
                              className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                          </div>

                          {/* PIN */}
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder={t("ajo.profile.pinPh")}
                            value={archivePin}
                            onChange={e => { setArchivePin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinErr(""); }}
                            className="w-full px-3 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono text-center tracking-[0.4em] placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                          {pinErr && <p className="text-xs text-red-500">{pinErr}</p>}

                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => { setConfirmDel(false); setArchivePin(""); setPinErr(""); setArchiveReason(""); setDelErr(""); }} disabled={deleting}
                              className="py-2.5 rounded-xl font-bold text-sm bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 transition">
                              {t("common.cancel")}
                            </button>
                            <button onClick={doRequestArchive} disabled={deleting || archivePin.length < 4 || !archiveReason.trim()}
                              className="py-2.5 rounded-xl font-bold text-sm bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-60">
                              {deleting ? t("ajo.profile.submitting") : t("ajo.profile.submitRequest")}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Legacy direct-archive path (kept for non-Aso callers that still pass onDelete) */}
              {!isCredit && onDelete && !onRequestArchive && (
                <div className="space-y-2">
                  {delErr && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                      {delErr}
                    </div>
                  )}
                  {!confirmDel ? (
                    <button
                      onClick={() => {
                        if ((record.current_balance || 0) !== 0) {
                          setDelErr(t("ajo.profile.balanceMustBeZeroArchive", { balance: fmt(record.current_balance) }));
                          return;
                        }
                        setDelErr(""); setArchivePin(""); setPinErr(""); setConfirmDel(true);
                      }}
                      className="w-full py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-2xl font-bold text-sm border border-amber-200 dark:border-amber-800 active:scale-[0.99] transition flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                      </svg>
                      {t("ajo.profile.archiveClient")}
                    </button>
                  ) : (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-3">
                      <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400">{t("ajo.profile.archiveName", { name: record.full_name })}</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                        {t("ajo.profile.archiveNote")}
                      </p>
                      <input type="password" inputMode="numeric" maxLength={4} placeholder={t("ajo.profile.pinPh")}
                        value={archivePin} onChange={e => { setArchivePin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinErr(""); }}
                        className="w-full px-3 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono text-center tracking-[0.4em] placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      {pinErr && <p className="text-xs text-red-500">{pinErr}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { setConfirmDel(false); setArchivePin(""); setPinErr(""); }} disabled={deleting}
                          className="py-2.5 rounded-xl font-bold text-sm bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 transition">
                          {t("common.cancel")}
                        </button>
                        <button onClick={doDelete} disabled={deleting || archivePin.length < 4}
                          className="py-2.5 rounded-xl font-bold text-sm bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-60">
                          {deleting ? t("ajo.profile.archiving") : t("ajo.profile.archive")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state prompt */}
              {!record.phone && !record.email && !record.nin && !record.next_of_kin && (
                <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-600">
                  <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">{t("ajo.profile.profileIncomplete")}</p>
                  <p className="text-slate-300 dark:text-slate-600 text-xs mt-1 mb-3">{t("ajo.profile.addContactKyc")}</p>
                  <button onClick={() => setEditing(true)}
                    className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition">
                    {t("ajo.profile.completeProfile")}
                  </button>
                </div>
              )}

              <div className="pb-6" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
