/**
 * Full client profile view + edit modal for Credit and Aso clients.
 * Handles photo upload, personal info, address (state/LGA/ward dropdowns),
 * NIN, and next-of-kin details.
 */
import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";
import { STATES, getLGAs, getWards } from "../../utils/nigeriaData";
import { AmountDisplay } from "./AmountDisplay";

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
function StatusBadge({ status }) {
  const map = {
    active:          "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    paid:            "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    partially_paid:  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    overdue:         "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  };
  const cls = map[status] || map.active;
  return (
    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide ${cls}`}>
      {(status || "active").replace("_", " ")}
    </span>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export function ClientProfile({ record, type, onSave, onClose, staffList = [], groups = [], onResetPwd, onDelete, onRequestArchive, canEditBank = false, businessName = "" }) {
  const [editing,      setEditing]      = useState(false);
  const [form,         setForm]         = useState({ ...record });
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState("");
  const [subAcctWarn,  setSubAcctWarn]  = useState("");
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

  // Load bank list when entering edit mode for any Aso client
  useEffect(() => {
    if (!editing || isCredit || banks.length > 0) return;
    supabase.functions.invoke("paystack", { body: { action: "list-banks" } })
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
    if (error) { setGroupOpErr("Couldn't add to group — try again."); }
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
    if (error) { setGroupOpErr("Couldn't remove from group — try again."); }
    else setGroupMemberships(prev => prev.filter(m => m.group_id !== groupId));
    setGroupOpBusy(false);
  };

  const resolveWithdrawalBank = async () => {
    const acctNo = String(form.withdrawal_account_number || "");
    if (!form.withdrawal_bank_code || acctNo.length < 10) return;
    setWithdrawalBankResolving(true); setWithdrawalBankErr(""); setWithdrawalBankResolvedName("");
    try {
      const { data, error } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: acctNo, bank_code: form.withdrawal_bank_code },
      });
      if (error || !data?.status) throw new Error(data?.message || "Could not verify account");
      const name = data.data?.account_name || "";
      setWithdrawalBankResolvedName(name);
      set("withdrawal_account_name", name);
      const b = banks.find(bk => bk.code === form.withdrawal_bank_code);
      if (b) set("withdrawal_bank_name", b.name);
    } catch (e) {
      setWithdrawalBankErr(e.message || "Could not verify account number");
    } finally {
      setWithdrawalBankResolving(false);
    }
  };

  const resolveBank = async () => {
    if (!form.bank_code || !form.account_number || String(form.account_number).length < 10) return;
    setBankResolving(true); setBankErr(""); setBankResolvedName("");
    try {
      const { data, error } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: form.account_number, bank_code: form.bank_code },
      });
      if (error || !data?.status) throw new Error(data?.message || "Could not verify account");
      const name = data.data?.account_name || "";
      setBankResolvedName(name);
      set("account_name", name);
      const b = banks.find(bk => bk.code === form.bank_code);
      if (b) set("bank_name", b.name);
    } catch (e) {
      setBankErr(e.message || "Could not verify account number");
    } finally {
      setBankResolving(false);
    }
  };
  const name     = isCredit ? (record.customer_name || "Client") : (record.full_name || "Client");
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
      setPinErr("Enter your 4-digit transaction PIN to confirm.");
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
      setPinErr(pinData?.locked ? "PIN locked — try again later." : "Incorrect PIN. Try again.");
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
      setPinErr("Enter your 4-digit transaction PIN to confirm.");
      return;
    }
    if (!archiveReason.trim()) {
      setDelErr("A reason is required.");
      return;
    }
    setPinErr(""); setDelErr(""); setDeleting(true);
    const { data: pinData } = await supabase.functions.invoke("pin-manager", {
      body: { action: "verify_txn_pin", pin: archivePin },
    });
    if (!pinData?.success) {
      setDeleting(false);
      setPinErr(pinData?.locked ? "PIN locked — try again later." : "Incorrect PIN. Try again.");
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
        setSaveErr(`Photo upload failed: ${err.message}`);
        setSaving(false);
        return;
      }
    }

    const updates = { ...form, profile_image_url: imageUrl };
    const { error } = await onSave(record.id, updates);
    if (error) {
      setSaving(false);
      setSaveErr(error.message || "Failed to save profile.");
      return;
    }

    // Sync Paystack subaccount when bank details changed (owner only)
    if (!isCredit && canEditBank) {
      const bankChanged = form.bank_code !== record.bank_code || form.account_number !== record.account_number;
      if (bankChanged && form.bank_code && form.account_number && form.account_name) {
        setSubAcctWarn("");
        const paystackBody = record.paystack_subaccount_code
          ? { action: "update-subaccount", client_id: record.id, settlement_bank: form.bank_code, account_number: form.account_number, bank_name: form.bank_name || "" }
          : { action: "create-subaccount", client_id: record.id, business_name: form.full_name || businessName, bank_code: form.bank_code, account_number: form.account_number, percentage_charge: 100, bank_name: form.bank_name || "" };
        const { data: sData, error: subErr } = await supabase.functions
          .invoke("paystack", { body: paystackBody })
          .catch(e => ({ data: null, error: e }));
        if (subErr || sData?.error) {
          let msg = sData?.error || "";
          if (!msg && subErr) {
            try { const b = await subErr.context?.json?.(); msg = b?.error || b?.message || ""; } catch {}
            if (!msg) msg = "Failed to link bank account";
          }
          console.error("Paystack subaccount sync failed:", msg);
          setSubAcctWarn(`Profile saved. Bank account link failed: ${msg} — save again to retry.`);
        }
      }
    }

    setSaving(false);
    setEditing(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    setBankResolvedName("");
    setBankErr("");
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
          <p className="text-xs text-slate-400 dark:text-slate-500">{isCredit ? "Credit Profile" : "Aso Client Profile"}</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition active:scale-95">
            Edit
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
                { label: "Total",       amount: record.total_amount, color: '#334155' },
                { label: "Paid",        amount: record.amount_paid,  color: '#16a34a' },
                { label: "Outstanding", amount: record.outstanding,  color: '#ef4444' },
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
                { label: "Balance",   amount: record.current_balance, color: '#7c3aed' },
                { label: "Deposited", amount: record.total_saved,     color: '#16a34a' },
                { label: "Withdrawn", amount: record.total_withdrawn,  color: '#475569' },
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
              {/* Personal info */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Personal Information" icon="👤" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label={isCredit ? "Customer Name" : "Full Name"} required>
                    <input
                      value={isCredit ? (form.customer_name || "") : (form.full_name || "")}
                      onChange={e => set(isCredit ? "customer_name" : "full_name", e.target.value)}
                      placeholder={isCredit ? "Customer full name" : "Client full name"}
                      className={inputCls}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Phone">
                      <input type="tel" value={form.phone || ""} onChange={e => set("phone", e.target.value)}
                        placeholder="08012345678" className={inputCls} />
                    </FormField>
                    <FormField label="Email">
                      <input type="email" value={form.email || ""} onChange={e => set("email", e.target.value)}
                        placeholder="email@example.com" className={inputCls} />
                    </FormField>
                  </div>
                  <FormField label="NIN">
                    <input type="text" inputMode="numeric" value={form.nin || ""}
                      onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder="11-digit NIN" className={inputCls} />
                  </FormField>
                </div>
              </div>

              {/* Savings settings — Aso only */}
              {!isCredit && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Savings Settings" icon="💰" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Frequency">
                        <select value={form.contribution_frequency || "monthly"} onChange={e => set("contribution_frequency", e.target.value)} className={inputCls}>
                          {["daily","weekly","monthly"].map(fr => <option key={fr} value={fr}>{fr.charAt(0).toUpperCase()+fr.slice(1)}</option>)}
                        </select>
                      </FormField>
                      <FormField label="Contribution (₦)">
                        <input type="number" value={form.contribution_amount || ""} onChange={e => set("contribution_amount", parseFloat(e.target.value)||0)} className={inputCls} placeholder="0.00" />
                      </FormField>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Withdrawal Fee">
                        <select value={form.commission_model || "none"} onChange={e => set("commission_model", e.target.value)} className={inputCls}>
                          <option value="none">No fee</option>
                          {!form.ajo_group_id && <option value="first_period">First period</option>}
                          <option value="percent">Percentage</option>
                        </select>
                      </FormField>
                      {form.commission_model === "percent" && (
                        <FormField label="Fee %">
                          <input type="number" value={form.commission_percent || ""} onChange={e => set("commission_percent", parseFloat(e.target.value) || null)} className={inputCls} placeholder="e.g. 5" min="0.01" max="100" step="0.01" />
                        </FormField>
                      )}
                    </div>
                    <FormField label="Next Due Date">
                      <input type="date" value={form.next_contribution_date || ""} onChange={e => set("next_contribution_date", e.target.value)} className={inputCls} />
                    </FormField>
                    {staffList.length > 0 && (
                      <FormField label="Assigned Staff">
                        <select value={form.staff_id || ""} onChange={e => set("staff_id", e.target.value)} className={inputCls}>
                          <option value="">No staff assigned</option>
                          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </FormField>
                    )}
                    {/* Group Memberships — multi-group support */}
                    {!isCredit && (
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">Group Memberships</p>
                        {groupMemberships.length === 0 && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-2">Not enrolled in any group.</p>
                        )}
                        <div className="space-y-1.5 mb-2">
                          {groupMemberships.map(m => (
                            <div key={m.group_id} className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{m.ajo_groups?.name || "Unknown group"}</p>
                                <p className="text-[10px] text-slate-400">{m.ajo_groups?.group_mode === "rotating" ? "Esusu (rotating)" : "Savings group"}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleLeaveGroup(m.group_id)}
                                disabled={groupOpBusy}
                                className="ml-2 text-[10px] font-bold text-red-500 dark:text-red-400 disabled:opacity-40 flex-shrink-0 active:opacity-60"
                              >
                                Remove
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
                              <option value="">Add to a group…</option>
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
                              {groupOpBusy ? "…" : "Add"}
                            </button>
                          </div>
                        )}
                        {groupOpErr && <p className="text-[11px] text-red-500 mt-1">{groupOpErr}</p>}
                      </div>
                    )}
                    <FormField label="Notes">
                      <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={2}
                        placeholder="Optional notes…" className={inputCls + " resize-none"} />
                    </FormField>
                  </div>
                </div>
              )}

              {/* Deposit Subaccount — owner-only, routes Paystack contributions */}
              {!isCredit && canEditBank && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Deposit Subaccount" icon="🏦" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed -mt-1">
                      Owner-set dedicated account for this client — all manual and Paystack contributions route here. Only the owner can change this.
                    </p>
                    <FormField label="Bank">
                      <select
                        value={form.bank_code || ""}
                        onChange={e => {
                          const b = banks.find(bk => bk.code === e.target.value);
                          set("bank_code", e.target.value);
                          set("bank_name", b?.name || "");
                          set("account_name", "");
                          setBankResolvedName(""); setBankErr("");
                        }}
                        className={inputCls}
                        disabled={banks.length === 0}>
                        <option value="">{banks.length === 0 ? "Loading banks…" : "Select bank…"}</option>
                        {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                      </select>
                    </FormField>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <FormField label="Account Number">
                          <input
                            type="text" inputMode="numeric"
                            value={form.account_number || ""}
                            onChange={e => {
                              set("account_number", e.target.value.replace(/\D/g, "").slice(0, 10));
                              set("account_name", "");
                              setBankResolvedName(""); setBankErr("");
                            }}
                            placeholder="10-digit NUBAN"
                            className={inputCls}
                          />
                        </FormField>
                      </div>
                      <button type="button" onClick={resolveBank}
                        disabled={bankResolving || !form.bank_code || String(form.account_number || "").length < 10}
                        className="mb-0.5 px-3 py-[11px] rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                        {bankResolving ? "Checking…" : "Verify"}
                      </button>
                    </div>
                    {(bankResolvedName || form.account_name) && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold -mt-1 flex items-center gap-1">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        {bankResolvedName || form.account_name}
                      </p>
                    )}
                    {bankErr && <p className="text-xs text-red-500 -mt-1">{bankErr}</p>}
                    {record.paystack_subaccount_code && (
                      <p className="text-[10px] text-green-600 dark:text-green-400 font-semibold">
                        Subaccount active · {record.paystack_subaccount_code}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Payout (Withdrawal) Account — client-set, optional, verifiable */}
              {!isCredit && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Payout Account" icon="💸" /></div>
                  <div className="px-4 pb-4 space-y-3.5">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed -mt-1">
                      The account where withdrawal payouts are sent. Optional — client can also set or update this from their portal or at the point of withdrawal.
                    </p>
                    <FormField label="Bank">
                      <select
                        value={form.withdrawal_bank_code || ""}
                        onChange={e => {
                          const b = banks.find(bk => bk.code === e.target.value);
                          set("withdrawal_bank_code", e.target.value);
                          set("withdrawal_bank_name", b?.name || "");
                          set("withdrawal_account_name", "");
                          setWithdrawalBankResolvedName(""); setWithdrawalBankErr("");
                        }}
                        className={inputCls}>
                        <option value="">{banks.length === 0 ? "Loading banks…" : "Select bank…"}</option>
                        {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                      </select>
                    </FormField>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <FormField label="Account Number">
                          <input
                            type="text" inputMode="numeric"
                            value={form.withdrawal_account_number || ""}
                            onChange={e => {
                              set("withdrawal_account_number", e.target.value.replace(/\D/g, "").slice(0, 10));
                              set("withdrawal_account_name", "");
                              setWithdrawalBankResolvedName(""); setWithdrawalBankErr("");
                            }}
                            placeholder="10-digit NUBAN"
                            className={inputCls}
                          />
                        </FormField>
                      </div>
                      <button type="button" onClick={resolveWithdrawalBank}
                        disabled={withdrawalBankResolving || !form.withdrawal_bank_code || String(form.withdrawal_account_number || "").length < 10}
                        className="mb-0.5 px-3 py-[11px] rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                        {withdrawalBankResolving ? "Checking…" : "Verify"}
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

              {/* Address */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Address" icon="📍" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label="Street Address">
                    <input value={form.address || ""} onChange={e => set("address", e.target.value)}
                      placeholder="12 Market Road, Onitsha" className={inputCls} />
                  </FormField>
                  <FormField label="State">
                    <select value={form.state || ""} onChange={e => handleStateChange(e.target.value)} className={inputCls}>
                      <option value="">Select State…</option>
                      {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="LGA">
                      <select value={form.lga || ""} onChange={e => handleLgaChange(e.target.value)}
                        disabled={!form.state} className={inputCls}>
                        <option value="">{form.state ? "Select LGA…" : "Select state first"}</option>
                        {lgas.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Ward">
                      <select value={form.ward || ""} onChange={e => set("ward", e.target.value)}
                        disabled={!form.lga} className={inputCls}>
                        <option value="">{form.lga ? "Select Ward…" : "Select LGA first"}</option>
                        {wards.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </FormField>
                  </div>
                </div>
              </div>

              {/* Next of Kin */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Next of Kin" icon="👨‍👩‍👦" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label="Full Name">
                    <input value={form.next_of_kin || ""} onChange={e => set("next_of_kin", e.target.value)}
                      placeholder="Next of kin full name" className={inputCls} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Phone">
                      <input type="tel" value={form.next_of_kin_phone || ""} onChange={e => set("next_of_kin_phone", e.target.value)}
                        placeholder="08012345678" className={inputCls} />
                    </FormField>
                    <FormField label="Email">
                      <input type="email" value={form.next_of_kin_email || ""} onChange={e => set("next_of_kin_email", e.target.value)}
                        placeholder="email@example.com" className={inputCls} />
                    </FormField>
                  </div>
                  <FormField label="Address">
                    <input value={form.next_of_kin_address || ""} onChange={e => set("next_of_kin_address", e.target.value)}
                      placeholder="Next of kin address" className={inputCls} />
                  </FormField>
                </div>
              </div>

              {/* Error */}
              {saveErr && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                  {saveErr}
                </div>
              )}

              {/* Save / Cancel */}
              <div className="grid grid-cols-2 gap-3 pb-6">
                <button onClick={cancelEdit}
                  className="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-[0.99]">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="py-3.5 rounded-xl font-bold text-sm bg-brand-600 hover:bg-brand-700 text-white transition active:scale-[0.99] disabled:opacity-60 shadow-sm">
                  {saving ? "Saving…" : "Save Profile"}
                </button>
              </div>
            </>
          ) : (
            /* ===== VIEW MODE ===== */
            <>
              {subAcctWarn && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{subAcctWarn}</p>
                    <button onClick={() => setSubAcctWarn("")} className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold underline mt-1">Dismiss</button>
                  </div>
                </div>
              )}

              {/* Personal info */}
              {(record.phone || record.email || record.nin || record.address) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Personal Information" icon="👤" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Phone"   value={record.phone} />
                    <InfoRow label="Email"   value={record.email} />
                    <InfoRow label="NIN"     value={record.nin} />
                    <InfoRow label="Address" value={record.address} />
                    <InfoRow label="State"   value={[record.state, record.lga, record.ward].filter(Boolean).join(" · ") || null} />
                  </div>
                </div>
              )}

              {/* Next of Kin */}
              {(record.next_of_kin || record.next_of_kin_phone) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Next of Kin" icon="👨‍👩‍👦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Name"    value={record.next_of_kin} />
                    <InfoRow label="Phone"   value={record.next_of_kin_phone} />
                    <InfoRow label="Email"   value={record.next_of_kin_email} />
                    <InfoRow label="Address" value={record.next_of_kin_address} />
                  </div>
                </div>
              )}

              {/* Credit / Aso specific info */}
              {isCredit ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Credit Details" icon="💳" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Due Date"   value={record.due_date} />
                    <InfoRow label="Date Given" value={record.date_given} />
                    <InfoRow label="Notes"      value={record.notes} />
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Savings Details" icon="🏦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Frequency"    value={record.contribution_frequency} />
                    <InfoRow label="Contribution" value={fmt(record.contribution_amount)} />
                    <InfoRow label="Next Due"     value={record.next_contribution_date} />
                    <InfoRow label="Registered"   value={record.registration_date} />
                    <InfoRow label="Notes"        value={record.notes} />
                    {record.account_number && (
                      <>
                        <div className="pt-1 pb-0.5">
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Deposit Subaccount</p>
                        </div>
                        <InfoRow label="Bank"         value={record.bank_name} />
                        <InfoRow label="Account No."  value={record.account_number} />
                        <InfoRow label="Account Name" value={record.account_name} />
                        {record.paystack_subaccount_code && (
                          <InfoRow label="Subaccount Code" value={record.paystack_subaccount_code} />
                        )}
                      </>
                    )}
                    {record.withdrawal_account_number && (
                      <>
                        <div className="pt-2 pb-0.5">
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Payout Account</p>
                        </div>
                        <InfoRow label="Bank"         value={record.withdrawal_bank_name} />
                        <InfoRow label="Account No."  value={record.withdrawal_account_number} />
                        <InfoRow label="Account Name" value={record.withdrawal_account_name} />
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
                    {resetting ? "Resetting password…" : "Reset Portal Password"}
                  </button>
                </div>
              )}

              {/* Archive client — Aso only (approval-gated; preserves all history) */}
              {!isCredit && onRequestArchive && (
                <div className="space-y-2">
                  {archiveReqSent ? (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl px-4 py-4 text-center">
                      <p className="text-sm font-extrabold text-green-700 dark:text-green-400">Request submitted</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1 leading-relaxed">The admin team will review and action this shortly. The client card will show a pending badge until resolved.</p>
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
                              setDelErr(`Balance must be ₦0.00 before requesting archive. Current balance: ${fmt(record.current_balance)}. Record a settling withdrawal first.`);
                              return;
                            }
                            setDelErr(""); setArchivePin(""); setPinErr(""); setArchiveReason("");
                            setConfirmDel(true);
                          }}
                          className="w-full py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-2xl font-bold text-sm border border-amber-200 dark:border-amber-800 active:scale-[0.99] transition flex items-center justify-center gap-2">
                          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                            <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                          </svg>
                          Request Client Archive
                        </button>
                      ) : (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-3">
                          <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400">Request archive for {record.full_name}?</p>

                          {/* Client snapshot */}
                          <div className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 space-y-1 border border-amber-100 dark:border-amber-900/40">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Client summary</p>
                            {record.membership_number && <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{record.membership_number}</p>}
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">Total deposited: <span className="font-bold text-green-600 dark:text-green-400">{fmt(record.total_saved)}</span></p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">Total withdrawn: <span className="font-bold">{fmt(record.total_withdrawn)}</span></p>
                            <p className="text-[11px] font-bold text-green-700 dark:text-green-400 flex items-center gap-1">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Balance confirmed ₦0.00
                            </p>
                          </div>

                          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            The request will be reviewed by an admin. The client card will show "Archive pending admin approval" until a decision is made. All contribution history is preserved.
                          </p>

                          {/* Reason */}
                          <div>
                            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">Reason <span className="text-red-500">*</span></p>
                            <textarea
                              rows={2}
                              value={archiveReason}
                              onChange={e => { setArchiveReason(e.target.value); setDelErr(""); }}
                              placeholder="Why is this client being archived?"
                              className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                          </div>

                          {/* PIN */}
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="4-digit transaction PIN"
                            value={archivePin}
                            onChange={e => { setArchivePin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinErr(""); }}
                            className="w-full px-3 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono text-center tracking-[0.4em] placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                          {pinErr && <p className="text-xs text-red-500">{pinErr}</p>}

                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => { setConfirmDel(false); setArchivePin(""); setPinErr(""); setArchiveReason(""); setDelErr(""); }} disabled={deleting}
                              className="py-2.5 rounded-xl font-bold text-sm bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 transition">
                              Cancel
                            </button>
                            <button onClick={doRequestArchive} disabled={deleting || archivePin.length < 4 || !archiveReason.trim()}
                              className="py-2.5 rounded-xl font-bold text-sm bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-60">
                              {deleting ? "Submitting…" : "Submit Request"}
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
                          setDelErr(`Balance must be ₦0.00 before archiving. Current balance: ${fmt(record.current_balance)}. Record a settling withdrawal first.`);
                          return;
                        }
                        setDelErr(""); setArchivePin(""); setPinErr(""); setConfirmDel(true);
                      }}
                      className="w-full py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-2xl font-bold text-sm border border-amber-200 dark:border-amber-800 active:scale-[0.99] transition flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                      </svg>
                      Archive Client
                    </button>
                  ) : (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-3">
                      <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400">Archive {record.full_name}?</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                        The client and all their contribution history will be preserved but moved to the archived list. Their portal login will be deactivated. Enter your transaction PIN to confirm.
                      </p>
                      <input type="password" inputMode="numeric" maxLength={4} placeholder="4-digit transaction PIN"
                        value={archivePin} onChange={e => { setArchivePin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinErr(""); }}
                        className="w-full px-3 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono text-center tracking-[0.4em] placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      {pinErr && <p className="text-xs text-red-500">{pinErr}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { setConfirmDel(false); setArchivePin(""); setPinErr(""); }} disabled={deleting}
                          className="py-2.5 rounded-xl font-bold text-sm bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 transition">
                          Cancel
                        </button>
                        <button onClick={doDelete} disabled={deleting || archivePin.length < 4}
                          className="py-2.5 rounded-xl font-bold text-sm bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-60">
                          {deleting ? "Archiving…" : "Archive"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state prompt */}
              {!record.phone && !record.email && !record.nin && !record.next_of_kin && (
                <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-600">
                  <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">Profile incomplete</p>
                  <p className="text-slate-300 dark:text-slate-600 text-xs mt-1 mb-3">Add contact and KYC details</p>
                  <button onClick={() => setEditing(true)}
                    className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition">
                    Complete Profile
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
