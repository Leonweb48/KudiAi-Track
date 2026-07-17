import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { canDo, featureLimit, upgradeLabel, planRequiredLabel, planAvailableText } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";

function makeRoles(t) {
  return [
    { id: "cashier",        label: t("staff.cashier"),       color: "blue"   },
    { id: "sales_officer",  label: t("staff.salesOfficer"),  color: "green"  },
    { id: "credit_officer", label: t("staff.creditOfficer"), color: "amber"  },
    { id: "aso_collector",  label: t("staff.asoCollector"),  color: "purple" },
    { id: "manager",        label: t("staff.manager"),       color: "red"    },
  ];
}

function makeModules(t) {
  return [
    { id: "transactions", label: t("staff.transactions")  },
    { id: "bills",        label: t("staff.billPayments")  },
    { id: "credit",       label: t("staff.creditSales")   },
    { id: "aso",          label: t("staff.ajoSavings")    },
    { id: "inventory",    label: t("staff.stockInventory")},
    { id: "insights",     label: t("staff.insights")      },
    { id: "refunds",      label: "Refunds"                 },
    { id: "discounts",    label: "Discounts"               },
  ];
}

const ROLE_DEFAULTS = {
  cashier:        ["transactions", "bills"],
  sales_officer:  ["transactions", "bills", "credit", "inventory", "refunds"],
  credit_officer: ["credit"],
  aso_collector:  ["aso"],
  manager:        ["transactions", "bills", "credit", "aso", "inventory", "insights", "refunds", "discounts"],
};

const ROLE_COLOR_MAP = {
  cashier:        "bg-blue-100   text-blue-700",
  sales_officer:  "bg-green-100  text-green-700",
  credit_officer: "bg-amber-100  text-amber-700",
  aso_collector:  "bg-purple-100 text-purple-700",
  manager:        "bg-red-100    text-red-700",
};

function roleColor(roleId) {
  return ROLE_COLOR_MAP[roleId] || "bg-slate-100 text-slate-600";
}
function roleLabel(roleId, roles) {
  return roles?.find(r => r.id === roleId)?.label || roleId;
}

function Avatar({ url, name, size = "md" }) {
  const sz = size === "lg" ? "w-16 h-16 text-xl" : "w-10 h-10 text-sm";
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} className={`${sz} rounded-full object-cover`} />;
  return (
    <div className={`${sz} rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center`}>
      {initials}
    </div>
  );
}

function PermToggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full transition-colors relative ${checked ? "bg-green-500" : "bg-slate-200"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </div>
      <span className="text-xs text-slate-600">{label}</span>
    </label>
  );
}

export default function StaffManagement({ session, plan = "starter", onBack, onUpgrade }) {
  const t = useT();
  const ROLES   = useMemo(() => makeRoles(t),   [t]);
  const MODULES = useMemo(() => makeModules(t), [t]);
  const userId = session.user.id;

  const [staffList,   setStaffList]   = useState([]);
  const [branches,    setBranches]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showAdd,     setShowAdd]     = useState(false);
  const [selected,    setSelected]    = useState(null); // staff being viewed/edited
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [activeTab,   setActiveTab]   = useState("staff"); // staff | logs

  // audit logs
  const [logs,        setLogs]        = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // add-staff form
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", role: "cashier", status: "active" });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [perms, setPerms] = useState({}); // { module: { can_view, can_create } }
  const [accountMessage, setAccountMessage] = useState("");
  const [addedStaffEmail, setAddedStaffEmail] = useState("");

  // Performance report
  const [reportStaff,       setReportStaff]       = useState(null);
  const [reportData,        setReportData]        = useState(null);
  const [reportLoading,     setReportLoading]     = useState(false);

  // D5: Approvals
  const [approvals,         setApprovals]         = useState([]);
  const [approvalsLoading,  setApprovalsLoading]  = useState(false);
  const [pendingCount,      setPendingCount]      = useState(0);
  const [actionNote,        setActionNote]        = useState("");

  // D6: Disbursement
  const [disburseTarget,    setDisburseTarget]    = useState(null);
  const [disburseForm,      setDisburseForm]      = useState({ type: "salary", amount: "", notes: "" });
  const [disbursePin,       setDisbursePin]       = useState("");
  const [disburseSaving,    setDisburseSaving]    = useState(false);
  const [disburseMsg,       setDisburseMsg]       = useState("");

  const loadStaff = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("staff")
      .select("*, staff_permissions(*)")
      .eq("owner_id", userId)
      .neq("status", "removed")
      .order("created_at", { ascending: false });
    setStaffList(data || []);
    setLoading(false);
  };

  const loadBranches = async () => {
    const { data } = await supabase
      .from("branches")
      .select("id, name")
      .eq("owner_id", userId)
      .eq("is_active", true)
      .order("name");
    setBranches(data || []);
  };

  const branchName = (id) => branches.find(b => b.id === id)?.name || "";

  const loadLogs = async () => {
    setLogsLoading(true);
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    setLogs(data || []);
    setLogsLoading(false);
  };

  const loadApprovals = async () => {
    setApprovalsLoading(true);
    const { data } = await supabase
      .from("approval_requests")
      .select("*, staff(full_name, role)")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    const all = data || [];
    setApprovals(all);
    setPendingCount(all.filter(r => r.status === "pending").length);
    setApprovalsLoading(false);
  };

  const approveRequest = async (id) => {
    await supabase.from("approval_requests").update({ status: "approved", actioned_at: new Date().toISOString(), action_note: actionNote }).eq("id", id);
    setActionNote("");
    await loadApprovals();
  };

  const rejectRequest = async (id) => {
    await supabase.from("approval_requests").update({ status: "rejected", actioned_at: new Date().toISOString(), action_note: actionNote }).eq("id", id);
    setActionNote("");
    await loadApprovals();
  };

  const submitDisbursement = async () => {
    if (!disburseTarget || !disburseForm.amount) return;
    if (!disbursePin || disbursePin.length !== 4) {
      setDisburseMsg("Enter your 4-digit transaction PIN to confirm.");
      return;
    }
    setDisburseSaving(true);
    setDisburseMsg("");
    const { data, error } = await supabase.functions.invoke("coop-portal", {
      body: {
        action:   "disburse-staff",
        staff_id: disburseTarget.id,
        type:     disburseForm.type,
        amount:   Number(disburseForm.amount),
        notes:    disburseForm.notes || null,
        pin:      disbursePin,
      },
    });
    if (error || data?.error) {
      setDisburseMsg(data?.error || error?.message || "Failed to record payment.");
    } else {
      setDisburseMsg("Payment recorded successfully!");
      setDisburseForm({ type: "salary", amount: "", notes: "" });
      setDisbursePin("");
      setTimeout(() => { setDisburseTarget(null); setDisburseMsg(""); }, 1500);
    }
    setDisburseSaving(false);
  };

  useEffect(() => { loadStaff(); loadBranches(); loadApprovals(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "logs") loadLogs(); }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "approvals") loadApprovals(); }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const initPermsForRole = (roleId) => {
    const defaults = ROLE_DEFAULTS[roleId] || [];
    const p = {};
    MODULES.forEach(m => {
      const on = defaults.includes(m.id);
      p[m.id] = m.id === "aso"
        ? { can_view: on, can_create: on, ajo_confirm_deposits: false, ajo_record_withdrawals: false, ajo_manage_clients: false }
        : { can_view: on, can_create: on };
    });
    p["print-airtime"] = { can_view: false, can_create: false };
    p["print-data"]    = { can_view: false, can_create: false };
    setPerms(p);
  };

  const openAdd = () => {
    setForm({ full_name: "", email: "", phone: "", role: "cashier", status: "active", branch_id: "" });
    setPhotoFile(null);
    setPhotoPreview(null);
    setAccountMessage("");
    initPermsForRole("cashier");
    setError("");
    setShowAdd(true);
  };

  const openDetail = (s) => {
    setSelected(s);
    const p = {};
    MODULES.forEach(m => {
      const existing = (s.staff_permissions || []).find(sp => sp.module === m.id);
      p[m.id] = m.id === "aso"
        ? {
            can_view:               existing?.can_view               || false,
            can_create:             existing?.can_create             || false,
            ajo_confirm_deposits:   existing?.ajo_confirm_deposits   || false,
            ajo_record_withdrawals: existing?.ajo_record_withdrawals || false,
            ajo_manage_clients:     existing?.ajo_manage_clients     || false,
          }
        : { can_view: existing?.can_view || false, can_create: existing?.can_create || false };
    });
    const pa = (s.staff_permissions || []).find(sp => sp.module === "print-airtime");
    const pd = (s.staff_permissions || []).find(sp => sp.module === "print-data");
    p["print-airtime"] = { can_view: pa?.can_view || false, can_create: false };
    p["print-data"]    = { can_view: pd?.can_view || false, can_create: false };
    setPerms(p);
    setAccountMessage("");
    setError("");
  };

  const genTempPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    return Array.from(values, n => chars[n % chars.length]).join("");
  };

  const provisionLogin = async (staffRecord, password) => {
    // Get a fresh access token — auto-injection can use a stale one, causing 401
    const { data: sessData } = await supabase.auth.getSession();
    const token = sessData?.session?.access_token;
    if (!token) throw new Error("Session expired. Please log out and log in again.");

    const { data, error: functionError } = await supabase.functions.invoke(
      "manage-staff-account",
      {
        body: { staffId: staffRecord.id, password },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!functionError) {
      if (data?.error) throw new Error(data.error);
      return data;
    }

    // FunctionsHttpError = function ran but returned 4xx/5xx — extract real message from body
    if (functionError.name === "FunctionsHttpError") {
      let msg = functionError.message;
      try {
        const body = await functionError.context.json();
        if (body?.error) msg = body.error;
      } catch (_) {}
      throw new Error(msg);
    }

    // FunctionsFetchError = function not reachable / not deployed — fall back to signUp
    const notDeployed =
      functionError.name === "FunctionsFetchError" ||
      (functionError.message || "").toLowerCase().includes("failed to send") ||
      (functionError.message || "").toLowerCase().includes("unreachable");

    if (!notDeployed) throw new Error(functionError.message || "Edge Function error");

    if (staffRecord.user_id) {
      throw new Error(
        "Cannot reset staff password: Edge Function not deployed. " +
        "Run: npx supabase functions deploy manage-staff-account --project-ref eztohcuzbxxxvnondxfz",
      );
    }

    // New staff only — create via signUp (email confirmation handled at login via OTP)
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: staffRecord.email,
      password,
      options: {
        data: {
          full_name:           staffRecord.full_name,
          account_type:        "staff",
          staff_id:            staffRecord.id,
          owner_id:            staffRecord.owner_id || userId,
          must_change_password: true,
        },
      },
    });

    if (signUpErr) {
      if (signUpErr.message.toLowerCase().includes("already registered")) {
        throw new Error(
          "This email is already registered. Deploy the Edge Function to reset the password: " +
          "npx supabase functions deploy manage-staff-account --project-ref eztohcuzbxxxvnondxfz",
        );
      }
      throw signUpErr;
    }

    if (signUpData.user?.id) {
      await supabase.from("staff").update({ user_id: signUpData.user.id }).eq("id", staffRecord.id);
    }

    return { success: true, created: true, userId: signUpData.user?.id };
  };

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleRoleChange = (roleId) => {
    setForm(f => ({ ...f, role: roleId }));
    initPermsForRole(roleId);
  };

  const saveStaff = async () => {
    setError("");
    if (!form.full_name.trim()) { setError("Full name is required"); return; }
    if (!form.email.trim())     { setError("Email is required"); return; }

    const staffLimit = featureLimit(plan, "staffManagement");
    if (staffLimit !== Infinity && staffList.length >= staffLimit) {
      setError(`Your plan allows up to ${staffLimit} staff member${staffLimit !== 1 ? "s" : ""}. Upgrade to add more.`);
      return;
    }

    setSaving(true);
    let staffRow = null;
    try {
      let profile_image_url = null;
      if (photoFile) {
        const path = `staff/${userId}/${Date.now()}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, photoFile, { upsert: true });
        if (!upErr) profile_image_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }

      const { data: createdStaff, error: staffErr } = await supabase
        .from("staff")
        .insert({ owner_id: userId, ...form, branch_id: form.branch_id || null, profile_image_url })
        .select().single();

      if (staffErr) throw staffErr;
      staffRow = createdStaff;

      // Insert permissions
      const permRows = [
        ...MODULES.map(m => ({
          staff_id:   staffRow.id,
          module:     m.id,
          can_view:   perms[m.id]?.can_view   || false,
          can_create: perms[m.id]?.can_create || false,
          ...(m.id === "aso" ? {
            ajo_confirm_deposits:   perms["aso"]?.ajo_confirm_deposits   || false,
            ajo_record_withdrawals: perms["aso"]?.ajo_record_withdrawals || false,
            ajo_manage_clients:     perms["aso"]?.ajo_manage_clients     || false,
          } : {}),
        })),
        { staff_id: staffRow.id, module: "print-airtime", can_view: perms["print-airtime"]?.can_view || false, can_create: false },
        { staff_id: staffRow.id, module: "print-data",    can_view: perms["print-data"]?.can_view    || false, can_create: false },
      ];
      const { error: permError } = await supabase.from("staff_permissions").insert(permRows);
      if (permError) throw permError;

      // Auto-generate temp password and provision login — manage-staff-account sends the staff_otp email
      await provisionLogin(staffRow, genTempPassword());

      setShowAdd(false);
      setAddedStaffEmail(form.email);
      await loadStaff();
    } catch (e) {
      if (staffRow?.id && !staffRow.user_id) {
        await supabase.from("staff_permissions").delete().eq("staff_id", staffRow.id);
        await supabase.from("staff").delete().eq("id", staffRow.id);
      }
      setError(e.message || "Failed to add staff");
    } finally {
      setSaving(false);
    }
  };

  const updatePermissions = async (staffId) => {
    const permRows = [
      ...MODULES.map(m => ({
        staff_id:   staffId,
        module:     m.id,
        can_view:   perms[m.id]?.can_view   || false,
        can_create: perms[m.id]?.can_create || false,
        ...(m.id === "aso" ? {
          ajo_confirm_deposits:   perms["aso"]?.ajo_confirm_deposits   || false,
          ajo_record_withdrawals: perms["aso"]?.ajo_record_withdrawals || false,
          ajo_manage_clients:     perms["aso"]?.ajo_manage_clients     || false,
        } : {}),
      })),
      { staff_id: staffId, module: "print-airtime", can_view: perms["print-airtime"]?.can_view || false, can_create: false },
      { staff_id: staffId, module: "print-data",    can_view: perms["print-data"]?.can_view    || false, can_create: false },
    ];

    // Delete then re-insert — works without a unique constraint and surfaces errors
    const { error: delErr } = await supabase.from("staff_permissions").delete().eq("staff_id", staffId);
    if (delErr) throw new Error(`Failed to update permissions: ${delErr.message}`);

    const { error: insErr } = await supabase.from("staff_permissions").insert(permRows);
    if (insErr) throw new Error(`Failed to save permissions: ${insErr.message}`);

    // Instant push to staff portal — subscribe() is NOT async, no await
    const _bch = supabase.channel(`perms_${userId}`);
    _bch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        _bch.send({ type: "broadcast", event: "permissions_changed", payload: { staffId } })
          .finally(() => setTimeout(() => supabase.removeChannel(_bch), 1500));
      }
    });
  };

  const saveDetail = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      let photo_url = selected.profile_image_url;
      if (photoFile) {
        const path = `staff/${userId}/${selected.id}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, photoFile, { upsert: true });
        if (!upErr) photo_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }

      const { error: updErr } = await supabase.from("staff").update({
        full_name:         selected.full_name,
        phone:             selected.phone,
        role:              selected.role,
        status:            selected.status,
        branch_id:         selected.branch_id || null,
        profile_image_url: photo_url,
      }).eq("id", selected.id);
      if (updErr) throw updErr;

      await updatePermissions(selected.id);
      setSelected(null);
      await loadStaff();
    } catch (e) {
      setError(e.message || "Failed to update staff");
    } finally {
      setSaving(false);
    }
  };

  const saveLoginAccess = async () => {
    if (!selected) return;
    setError("");
    setAccountMessage("");
    if (selected.status !== "active") {
      setError("Activate this staff member before enabling login");
      return;
    }

    setSaving(true);
    try {
      // Auto-generate temp password — manage-staff-account sends staff_otp email with credentials
      const result = await provisionLogin(selected, genTempPassword());
      setAccountMessage(result?.message || "Login credentials sent to staff email");
      await loadStaff();
      const { data: refreshed } = await supabase
        .from("staff")
        .select("*, staff_permissions(*)")
        .eq("id", selected.id)
        .single();
      if (refreshed) setSelected(refreshed);
    } catch (e) {
      setError(e.message || "Failed to update login access");
    } finally {
      setSaving(false);
    }
  };



  const deleteStaff = async (id) => {
    if (!window.confirm("Remove this staff member? This cannot be undone.")) return;
    const staffMember = staffList.find(s => s.id === id);
    if (staffMember?.user_id) {
      // Keep the auth link blocked so the removed login cannot be mistaken for
      // a new owner account. The admin function can delete it permanently later.
      await supabase.from("staff").update({ status: "removed" }).eq("id", id);
    } else {
      await supabase.from("staff").delete().eq("id", id);
    }
    setSelected(null);
    await loadStaff();
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  };

  const openReport = async (s) => {
    setReportStaff(s);
    setReportData(null);
    setReportLoading(true);
    const [txRes, crRes, asoRes] = await Promise.all([
      supabase.from("transactions").select("type,amount,item_name,transaction_date").eq("user_id", userId).eq("staff_id", s.id),
      supabase.from("credits").select("customer_name,total_amount,outstanding,status").eq("user_id", userId).eq("staff_id", s.id),
      supabase.from("aso_clients").select("full_name,current_balance,total_saved").eq("user_id", userId).eq("staff_id", s.id),
    ]);
    const tx  = txRes.data  || [];
    const cr  = crRes.data  || [];
    const aso = asoRes.data || [];
    const totalIn  = tx.filter(t => t.type === "in").reduce((s, t) => s + Number(t.amount), 0);
    const totalOut = tx.filter(t => t.type === "out").reduce((s, t) => s + Number(t.amount), 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const txThisMonth = tx.filter(t => (t.transaction_date || "").startsWith(thisMonth));
    setReportData({ tx, cr, aso, totalIn, totalOut, txThisMonth });
    setReportLoading(false);
  };

  if (!canDo(plan, "staffManagement")) {
    return (
      <div className="h-full bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">{t("staff.title")}</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-5">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-600" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{planRequiredLabel("staffManagement")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs leading-relaxed">
            Add team members, assign roles and permissions, and track performance. {planAvailableText("staffManagement")}
          </p>
          <button onClick={onUpgrade} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition shadow-md">
            {upgradeLabel("staffManagement")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">{t("staff.title")}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{staffList.length} staff member{staffList.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Staff
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4">
        {[["staff","Staff"],["logs","Audit Logs"],["approvals","Approvals"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`relative py-2.5 px-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === id ? "border-green-500 text-green-600" : "border-transparent text-slate-400"}`}>
            {label}
            {id === "approvals" && pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Staff Tab */}
      {activeTab === "staff" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : staffList.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-slate-300" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4 6v-2m0-4a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">No staff members yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap "Add Staff" to get started</p>
            </div>
          ) : staffList.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
              <button onClick={() => openDetail(s)} className="w-full flex items-center gap-3 text-left">
                <Avatar url={s.profile_image_url} name={s.full_name} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{s.full_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{s.email}</p>
                  {s.branch_id && branchName(s.branch_id) && (
                    <p className="text-xs text-violet-600 dark:text-violet-400 font-semibold mt-0.5 truncate">📍 {branchName(s.branch_id)}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleColor(s.role)}`}>
                    {roleLabel(s.role, ROLES)}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                    {s.status === "active" ? "Active" : "Suspended"}
                  </span>
                </div>
              </button>
              <button onClick={() => openReport(s)}
                className="mt-3 w-full py-2 rounded-xl bg-slate-50 dark:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M18 20V10M12 20V4M6 20v-6" />
                </svg>
                Performance Report
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Audit Logs Tab */}
      {activeTab === "logs" && (
        <div className="flex-1 overflow-y-auto p-4">
          {logsLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-20 text-slate-400 dark:text-slate-500 text-sm">No activity logged yet.</div>
          ) : (
            <div className="space-y-2">
              {logs.map(l => (
                <div key={l.id} className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{l.staff_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{l.action}</p>
                      {l.details && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 italic">{l.details}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      {l.module && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-md capitalize">
                          {l.module}
                        </span>
                      )}
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{fmtDate(l.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* D5: Approvals Tab */}
      {activeTab === "approvals" && (
        <div className="flex-1 overflow-y-auto p-4">
          {approvalsLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : approvals.length === 0 ? (
            <div className="text-center py-20 text-slate-400 dark:text-slate-500 text-sm">No approval requests yet.</div>
          ) : (
            <div className="space-y-3">
              {approvals.map(req => {
                const isPending = req.status === "pending";
                const statusColor = { pending: "bg-amber-50 text-amber-700 border-amber-200", approved: "bg-green-50 text-green-700 border-green-200", rejected: "bg-red-50 text-red-500 border-red-200", expired: "bg-slate-50 text-slate-400 border-slate-200" }[req.status] || "bg-slate-50 text-slate-400 border-slate-200";
                return (
                  <div key={req.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-white capitalize">{req.type} Request</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{req.staff?.full_name || "Staff"} · {req.staff?.role?.replace(/_/g, " ") || ""}</p>
                        {req.amount && <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-1">₦{Number(req.amount).toLocaleString()}</p>}
                        {req.discount_pct && <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-1">{req.discount_pct}% discount</p>}
                        {req.reason && <p className="text-xs text-slate-400 mt-1 italic">{req.reason}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${statusColor}`}>{req.status}</span>
                        <p className="text-[10px] text-slate-400">{fmtDate(req.created_at)}</p>
                      </div>
                    </div>
                    {isPending && (
                      <div className="px-4 pb-3 space-y-2">
                        <input
                          placeholder="Note (optional)"
                          value={actionNote}
                          onChange={e => setActionNote(e.target.value)}
                          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => approveRequest(req.id)}
                            className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-bold hover:bg-green-700 transition-colors">
                            Approve
                          </button>
                          <button onClick={() => rejectRequest(req.id)}
                            className="flex-1 py-2 rounded-xl border-2 border-red-200 text-red-500 text-xs font-semibold hover:bg-red-50 transition-colors">
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                    {!isPending && req.action_note && (
                      <div className="px-4 pb-3">
                        <p className="text-[11px] text-slate-400 italic">{req.action_note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Add Staff Sheet ─────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-sheet flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-white">Add Staff Member</h2>
              <button onClick={() => setShowAdd(false)} className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Photo */}
              <div className="flex flex-col items-center">
                <label className="cursor-pointer relative">
                  <div className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center ${photoPreview ? "border-2 border-green-500" : "bg-slate-100 border-2 border-dashed border-slate-300"}`}>
                    {photoPreview
                      ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                      : <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-slate-400" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
                  </div>
                  <span className="absolute bottom-0 right-0 bg-green-600 rounded-full p-1 shadow">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </label>
                <p className="text-xs text-slate-400 mt-2">Profile Photo (optional)</p>
              </div>

              {/* Fields */}
              {[
                { label: "Full Name *", key: "full_name", type: "text", placeholder: "e.g. Amaka Johnson" },
                { label: "Email Address *", key: "email", type: "email", placeholder: "staff@example.com" },
                { label: "Phone Number", key: "phone", type: "tel", placeholder: "08012345678" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              ))}

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Role *</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map(r => (
                    <button key={r.id} onClick={() => handleRoleChange(r.id)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border-2 transition-colors text-left ${form.role === r.id ? "border-green-500 bg-green-50 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Branch */}
              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    Assign to Branch {form.role === "manager" && <span className="text-violet-600 font-bold">(Manager will get branch access)</span>}
                  </label>
                  <select value={form.branch_id || ""} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">— No branch (Head Office) —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              {/* Permissions */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Module Permissions</label>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 space-y-3">
                  {MODULES.map(m => (
                    <div key={m.id}>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{m.label}</p>
                      <div className="flex gap-4">
                        <PermToggle
                          checked={perms[m.id]?.can_view || false}
                          onChange={v => setPerms(p => ({
                            ...p,
                            [m.id]: { ...p[m.id], can_view: v, can_create: v ? p[m.id]?.can_create : false,
                              ...(m.id === "aso" && !v ? { ajo_confirm_deposits: false, ajo_record_withdrawals: false, ajo_manage_clients: false } : {}),
                            },
                            ...(m.id === "bills" && !v ? { "print-airtime": { can_view: false, can_create: false }, "print-data": { can_view: false, can_create: false } } : {}),
                          }))}
                          label="View"
                        />
                        {m.id !== "aso" && (
                          <PermToggle
                            checked={perms[m.id]?.can_create || false}
                            onChange={v => setPerms(p => ({ ...p, [m.id]: { ...p[m.id], can_create: v, can_view: v ? true : p[m.id]?.can_view } }))}
                            label="Create"
                          />
                        )}
                      </div>
                      {m.id === "aso" && perms["aso"]?.can_view && (
                        <div className="mt-2 ml-1 pl-3 border-l-2 border-violet-200 dark:border-violet-800 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ajo Capabilities</p>
                          <PermToggle
                            checked={perms["aso"]?.can_create || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, can_create: v } }))}
                            label="Record Contributions"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_confirm_deposits || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_confirm_deposits: v } }))}
                            label="Confirm Bank Deposits"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_record_withdrawals || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_record_withdrawals: v } }))}
                            label="Record Withdrawals"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_manage_clients || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_manage_clients: v } }))}
                            label="Manage Clients"
                          />
                        </div>
                      )}
                      {m.id === "bills" && perms["bills"]?.can_view && (
                        <div className="mt-2 ml-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Print Features</p>
                          {plan === "enterprise" ? (
                            <>
                              <PermToggle
                                checked={perms["print-airtime"]?.can_view || false}
                                onChange={v => setPerms(p => ({ ...p, "print-airtime": { can_view: v, can_create: false } }))}
                                label="Print Airtime"
                              />
                              <PermToggle
                                checked={perms["print-data"]?.can_view || false}
                                onChange={v => setPerms(p => ({ ...p, "print-data": { can_view: v, can_create: false } }))}
                                label="Print Data"
                              />
                            </>
                          ) : (
                            <p className="text-[10px] text-amber-500 font-semibold">{planRequiredLabel("printWholesale")} to enable print features</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

              <div className="pb-6">
                <button onClick={saveStaff} disabled={saving}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
                  {saving ? "Adding staff…" : "Add Staff Member"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Staff Added Success Banner ──────────────────────────── */}
      {addedStaffEmail && (
        <div className="fixed inset-0 z-sheet flex items-center justify-center bg-black/50 px-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">Staff Account Created</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Login credentials sent automatically</p>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 rounded-2xl px-4 py-3 mb-5">
              <p className="text-[11px] text-green-800 dark:text-green-300 font-medium leading-relaxed">
                An email with login credentials and a one-time verification code has been sent to{" "}
                <span className="font-bold">{addedStaffEmail}</span>. The staff member will verify their email and set a new password on first login.
              </p>
            </div>
            <button
              onClick={() => setAddedStaffEmail("")}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl py-3.5 text-sm transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Staff Detail Sheet ──────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-sheet flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-white">Staff Details</h2>
              <button onClick={() => { setSelected(null); setPhotoFile(null); setPhotoPreview(null); }}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Photo */}
              <div className="flex flex-col items-center">
                <label className="cursor-pointer relative">
                  <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-green-500">
                    {(photoPreview || selected.profile_image_url)
                      ? <img src={photoPreview || selected.profile_image_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xl">
                          {(selected.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                        </div>}
                  </div>
                  <span className="absolute bottom-0 right-0 bg-green-600 rounded-full p-1 shadow">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </label>
              </div>

              {/* Editable fields */}
              {[
                { label: "Full Name", key: "full_name" },
                { label: "Phone",     key: "phone"     },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{f.label}</label>
                  <input type="text" value={selected[f.key] || ""}
                    onChange={e => setSelected(s => ({ ...s, [f.key]: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              ))}

              {/* Email (read-only) */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Email</label>
                <input readOnly value={selected.email}
                  className="w-full border border-slate-100 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-400 cursor-not-allowed" />
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map(r => (
                    <button key={r.id} onClick={() => { setSelected(s => ({ ...s, role: r.id })); initPermsForRole(r.id); }}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border-2 transition-colors text-left ${selected.role === r.id ? "border-green-500 bg-green-50 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Branch */}
              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    Assign to Branch {selected.role === "manager" && <span className="text-violet-600 font-bold">(Gets branch manager access)</span>}
                  </label>
                  <select value={selected.branch_id || ""} onChange={e => setSelected(s => ({ ...s, branch_id: e.target.value || null }))}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">— No branch (Head Office) —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              {/* Status toggle */}
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Account Status</p>
                  <p className="text-xs text-slate-400 mt-0.5">Suspended staff cannot log in</p>
                </div>
                <button onClick={() => setSelected(s => ({ ...s, status: s.status === "active" ? "suspended" : "active" }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selected.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                  {selected.status === "active" ? "Active" : "Suspended"}
                </button>
              </div>

              {/* Login access */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-white">Login Access</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selected.user_id
                        ? "An authentication account is linked to this staff member."
                        : "No login account has been created yet."}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${
                    selected.user_id
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}>
                    {selected.user_id ? "Login enabled" : "Setup required"}
                  </span>
                </div>

                <button type="button" onClick={saveLoginAccess} disabled={saving || selected.status !== "active"}
                  className="w-full border-2 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 disabled:opacity-50 font-bold rounded-xl py-2.5 text-sm hover:bg-green-50 dark:hover:bg-green-950/20 transition-colors">
                  {selected.user_id ? "Resend Login Credentials" : "Create Login Account"}
                </button>
                {accountMessage && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                    {accountMessage}
                  </p>
                )}
              </div>

              {/* Permissions */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Permissions</label>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 space-y-3">
                  {MODULES.map(m => (
                    <div key={m.id}>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{m.label}</p>
                      <div className="flex gap-4">
                        <PermToggle
                          checked={perms[m.id]?.can_view || false}
                          onChange={v => setPerms(p => ({
                            ...p,
                            [m.id]: { ...p[m.id], can_view: v, can_create: v ? p[m.id]?.can_create : false,
                              ...(m.id === "aso" && !v ? { ajo_confirm_deposits: false, ajo_record_withdrawals: false, ajo_manage_clients: false } : {}),
                            },
                            ...(m.id === "bills" && !v ? { "print-airtime": { can_view: false, can_create: false }, "print-data": { can_view: false, can_create: false } } : {}),
                          }))}
                          label="View"
                        />
                        {m.id !== "aso" && (
                          <PermToggle
                            checked={perms[m.id]?.can_create || false}
                            onChange={v => setPerms(p => ({ ...p, [m.id]: { ...p[m.id], can_create: v, can_view: v ? true : p[m.id]?.can_view } }))}
                            label="Create"
                          />
                        )}
                      </div>
                      {m.id === "aso" && perms["aso"]?.can_view && (
                        <div className="mt-2 ml-1 pl-3 border-l-2 border-violet-200 dark:border-violet-800 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ajo Capabilities</p>
                          <PermToggle
                            checked={perms["aso"]?.can_create || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, can_create: v } }))}
                            label="Record Contributions"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_confirm_deposits || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_confirm_deposits: v } }))}
                            label="Confirm Bank Deposits"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_record_withdrawals || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_record_withdrawals: v } }))}
                            label="Record Withdrawals"
                          />
                          <PermToggle
                            checked={perms["aso"]?.ajo_manage_clients || false}
                            onChange={v => setPerms(p => ({ ...p, aso: { ...p.aso, ajo_manage_clients: v } }))}
                            label="Manage Clients"
                          />
                        </div>
                      )}
                      {m.id === "bills" && perms["bills"]?.can_view && (
                        <div className="mt-2 ml-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Print Features</p>
                          {plan === "enterprise" ? (
                            <>
                              <PermToggle
                                checked={perms["print-airtime"]?.can_view || false}
                                onChange={v => setPerms(p => ({ ...p, "print-airtime": { can_view: v, can_create: false } }))}
                                label="Print Airtime"
                              />
                              <PermToggle
                                checked={perms["print-data"]?.can_view || false}
                                onChange={v => setPerms(p => ({ ...p, "print-data": { can_view: v, can_create: false } }))}
                                label="Print Data"
                              />
                            </>
                          ) : (
                            <p className="text-[10px] text-amber-500 font-semibold">{planRequiredLabel("printWholesale")} to enable print features</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

              <div className="space-y-2 pb-6">
                <button onClick={saveDetail} disabled={saving}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                {/* D6: Disburse payment */}
                <button onClick={() => { setDisburseTarget(selected); setDisburseForm({ type: "salary", amount: "", notes: "" }); setDisburseMsg(""); setDisbursePin(""); }}
                  className="w-full border-2 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 font-semibold rounded-xl py-3 text-sm hover:bg-green-50 dark:hover:bg-green-950/20 transition-colors">
                  Disburse Payment
                </button>
                <button onClick={() => deleteStaff(selected.id)}
                  className="w-full border-2 border-red-200 text-red-500 font-semibold rounded-xl py-3 text-sm hover:bg-red-50 transition-colors">
                  Remove Staff Member
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Performance Report Full Page ──────────────────────── */}
      {reportStaff && (
        <div className="fixed inset-0 z-sub-sheet bg-slate-50 dark:bg-slate-900 flex flex-col">
          <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
            <button onClick={() => { setReportStaff(null); setReportData(null); }}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-slate-800 dark:text-white truncate">{reportStaff.full_name}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 capitalize">{reportStaff.role?.replace(/_/g, " ")} · Performance Report</p>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {reportLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : reportData ? (
                <>
                  {/* Transaction summary */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Transactions</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Total Sales",    value: `₦${reportData.totalIn.toLocaleString()}`,   color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
                        { label: "Total Expenses", value: `₦${reportData.totalOut.toLocaleString()}`,  color: "text-red-500 bg-red-50 dark:bg-red-900/20" },
                        { label: "All Transactions", value: reportData.tx.length,                       color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
                        { label: "This Month",     value: reportData.txThisMonth.length,                color: "text-purple-600 bg-purple-50 dark:bg-purple-900/20" },
                      ].map(stat => (
                        <div key={stat.label} className={`${stat.color} rounded-2xl p-3`}>
                          <p className="text-[10px] font-bold opacity-70 uppercase">{stat.label}</p>
                          <p className="text-lg font-extrabold mt-0.5">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Credit summary */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Credit Sales</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Clients",     value: reportData.cr.length },
                        { label: "Outstanding", value: `₦${reportData.cr.reduce((s, c) => s + Number(c.outstanding || 0), 0).toLocaleString()}` },
                      ].map(stat => (
                        <div key={stat.label} className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-3">
                          <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 opacity-70 uppercase">{stat.label}</p>
                          <p className="text-lg font-extrabold text-amber-700 dark:text-amber-300 mt-0.5">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Aso summary */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Aso Savings</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Clients",       value: reportData.aso.length },
                        { label: "Total Saved",   value: `₦${reportData.aso.reduce((s, c) => s + Number(c.total_saved || 0), 0).toLocaleString()}` },
                      ].map(stat => (
                        <div key={stat.label} className="bg-violet-50 dark:bg-violet-900/20 rounded-2xl p-3">
                          <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 opacity-70 uppercase">{stat.label}</p>
                          <p className="text-lg font-extrabold text-violet-700 dark:text-violet-300 mt-0.5">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {reportData.tx.length === 0 && reportData.cr.length === 0 && reportData.aso.length === 0 && (
                    <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">No activity recorded yet for this staff member.</p>
                  )}
                </>
              ) : null}
          </div>
        </div>
      )}

      {/* D6: Disburse Payment Modal */}
      {disburseTarget && (
        <div className="fixed inset-0 z-sub-sheet flex items-end justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md px-6 pt-6 space-y-4" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                Pay {disburseTarget.full_name}
              </h3>
              <button onClick={() => { setDisburseTarget(null); setDisbursePin(""); }} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Payment Type</label>
              <div className="grid grid-cols-3 gap-2">
                {["salary","commission","allowance","bonus","other"].map(type => (
                  <button key={type} onClick={() => setDisburseForm(f => ({ ...f, type }))}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border-2 capitalize transition-colors ${disburseForm.type === type ? "border-green-500 bg-green-50 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Amount (₦)</label>
              <input type="number" min="0" placeholder="0.00"
                value={disburseForm.amount}
                onChange={e => setDisburseForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Note (optional)</label>
              <input type="text" placeholder="e.g. July salary"
                value={disburseForm.notes}
                onChange={e => setDisburseForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Transaction PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={disbursePin}
                onChange={e => setDisbursePin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 tracking-[0.5em] text-center"
              />
            </div>
            {disburseMsg && (
              <p className={`text-xs px-3 py-2 rounded-xl border ${disburseMsg.includes("success") ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                {disburseMsg}
              </p>
            )}
            <button onClick={submitDisbursement} disabled={disburseSaving || !disburseForm.amount || disbursePin.length !== 4}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
              {disburseSaving ? "Recording…" : "Record Payment"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
