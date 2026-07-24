import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { Svg, P, GK, SectionLabel } from "./ManagerShared";

const MODULE_LABELS = {
  transactions: "Transactions", credits:  "Credits / Debts",
  inventory:    "Stock",        invoices: "Invoices",
  insights:     "Reports",      settings: "Settings",
};
const PERM_FIELDS = ["can_view", "can_add", "can_edit", "can_delete"];
const PERM_LABELS = { can_view: "View", can_add: "Add", can_edit: "Edit", can_delete: "Delete" };

const OWNER_ONLY_MSG = "Only the business owner can perform this action.";

function Avatar({ name, url, size = 10 }) {
  const initials = (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className={`w-${size} h-${size} rounded-full overflow-hidden flex-shrink-0 border-2 border-slate-100 dark:border-slate-700`}>
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : <div className="w-full h-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
            <span className={`text-${size <= 10 ? "sm" : "xl"} font-black text-white`}>{initials}</span>
          </div>
      }
    </div>
  );
}

function Toggle({ on, onToggle, disabled }) {
  return (
    <button onClick={e => { e.stopPropagation(); if (!disabled) onToggle(); }} disabled={disabled}
      className={`relative w-11 h-5.5 h-[22px] rounded-full flex-shrink-0 transition-colors duration-200 ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      } ${on ? "bg-emerald-600" : "bg-slate-200 dark:bg-slate-600"}`}>
      <span className="absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow transition-all duration-200"
        style={{ left: on ? "calc(100% - 20px)" : "2px" }} />
    </button>
  );
}

function StaffCard({ member, managerPerms, managerId }) {
  const [expanded,    setExpanded]    = useState(false);
  const [perms,       setPerms]       = useState(member.perms || []);
  const [todayLogs,   setTodayLogs]   = useState([]);
  const [logsLoaded,  setLogsLoaded]  = useState(false);
  const [shiftEdit,   setShiftEdit]   = useState(false);
  const [shiftVal,    setShiftVal]    = useState(member.shift_assignment || "");
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftMsg,    setShiftMsg]    = useState("");
  const [permMsgs,    setPermMsgs]    = useState({});
  const [permLoading, setPermLoading] = useState({});

  const toggleExpand = useCallback(() => {
    setExpanded(e => {
      if (!e && !logsLoaded) {
        const today = new Date().toISOString().slice(0, 10);
        supabase.from("audit_logs").select("action, module, created_at")
          .eq("staff_id", member.id)
          .gte("created_at", today + "T00:00:00Z")
          .order("created_at", { ascending: false })
          .limit(50)
          .then(({ data }) => { setTodayLogs(data || []); setLogsLoaded(true); });
      }
      return !e;
    });
  }, [logsLoaded, member.id]);

  const saveShift = async () => {
    setShiftSaving(true); setShiftMsg("");
    const { error } = await supabase.rpc("manager_update_staff_shift", {
      p_target_staff_id: member.id,
      p_shift: shiftVal.trim() || null,
    });
    if (error) {
      setShiftMsg(error.message || "Failed to save");
    } else {
      setShiftMsg("Saved");
      setShiftEdit(false);
      setTimeout(() => setShiftMsg(""), 2000);
    }
    setShiftSaving(false);
  };

  const togglePerm = async (module, field, currentValue) => {
    const key = `${module}_${field}`;
    setPermLoading(p => ({ ...p, [key]: true }));
    setPermMsgs(m => ({ ...m, [key]: "" }));
    const { data, error } = await supabase.rpc("manager_update_staff_permission", {
      p_target_staff_id: member.id,
      p_module: module,
      p_field: field,
      p_value: !currentValue,
    });
    if (error) {
      setPermMsgs(m => ({ ...m, [key]: error.message || "Failed" }));
    } else if (data?.error) {
      setPermMsgs(m => ({ ...m, [key]: data.error }));
    } else {
      // Update local perm state
      setPerms(prev => prev.map(p =>
        p.module === module ? { ...p, [field]: !currentValue } : p
      ));
    }
    setPermLoading(p => ({ ...p, [key]: false }));
  };

  // Build a map of manager's own permissions for ceiling check
  const managerCan = {};
  (managerPerms || []).forEach(mp => {
    PERM_FIELDS.forEach(f => { managerCan[`${mp.module}_${f}`] = !!mp[f]; });
  });

  // Modules where the manager holds at least view
  const accessibleModules = (managerPerms || [])
    .filter(mp => mp.can_view)
    .map(mp => mp.module);

  const statusColor = member.status === "active" ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400"
    : member.status === "suspended" ? "text-red-500 bg-red-50 dark:bg-red-900/20"
    : "text-slate-400 bg-slate-100 dark:bg-slate-700";

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border transition-all duration-200 overflow-hidden ${
      expanded ? "border-emerald-300 dark:border-emerald-700" : "border-slate-100 dark:border-slate-700"
    }`}>
      {/* Card header — always visible */}
      <button onClick={toggleExpand}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-700/50 transition">
        <Avatar name={member.full_name} url={member.profile_image_url} size={10} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{member.full_name}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 capitalize mt-0.5">
            {(member.role || "").replace(/_/g, " ")}
            {member.shift_assignment ? ` · ${member.shift_assignment}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${statusColor}`}>
            {member.status}
          </span>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700">

          {/* Today's activity */}
          <div className="px-4 py-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Today's Activity</p>
            {!logsLoaded
              ? <p className="text-xs text-slate-400 italic">Loading…</p>
              : todayLogs.length === 0
                ? <p className="text-xs text-slate-400 italic">No activity recorded today</p>
                : <div className="space-y-1 max-h-28 overflow-y-auto">
                    {todayLogs.map((l, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {l.module && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 capitalize flex-shrink-0">
                            {l.module}
                          </span>
                        )}
                        <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 truncate">{l.action}</p>
                        <p className="text-[10px] text-slate-400 flex-shrink-0">
                          {new Date(l.created_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    ))}
                  </div>
            }
          </div>

          {/* Shift assignment */}
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Shift</p>
              {!shiftEdit && (
                <button onClick={() => setShiftEdit(true)}
                  className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                  Edit
                </button>
              )}
            </div>
            {shiftEdit
              ? (
                <div className="flex gap-2">
                  <input value={shiftVal} onChange={e => setShiftVal(e.target.value)}
                    placeholder="e.g. Morning, Night, Weekends…"
                    className="flex-1 h-9 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  <button onClick={saveShift} disabled={shiftSaving}
                    className="px-4 h-9 rounded-xl text-white text-sm font-bold flex-shrink-0 disabled:opacity-50 active:scale-95 transition"
                    style={{ backgroundColor: GK }}>
                    {shiftSaving ? "…" : "Save"}
                  </button>
                  <button onClick={() => { setShiftEdit(false); setShiftVal(member.shift_assignment || ""); }}
                    className="px-3 h-9 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-500 text-sm font-semibold flex-shrink-0 active:scale-95 transition">
                    Cancel
                  </button>
                </div>
              )
              : <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">
                  {member.shift_assignment || <span className="text-slate-300 dark:text-slate-600 italic">Not assigned</span>}
                </p>
            }
            {shiftMsg && (
              <p className={`text-xs mt-1.5 font-semibold ${shiftMsg === "Saved" ? "text-emerald-600" : "text-red-500"}`}>{shiftMsg}</p>
            )}
          </div>

          {/* Permissions */}
          {accessibleModules.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Permissions</p>
              <div className="space-y-3">
                {accessibleModules.map(mod => {
                  const staffPerm = perms.find(p => p.module === mod) || {};
                  return (
                    <div key={mod}>
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                        {MODULE_LABELS[mod] || mod}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {PERM_FIELDS.map(field => {
                          const key         = `${mod}_${field}`;
                          const currentVal  = !!staffPerm[field];
                          const managerHas  = !!managerCan[key];
                          const isLoading   = !!permLoading[key];
                          const errMsg      = permMsgs[key];
                          return (
                            <div key={field} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
                              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{PERM_LABELS[field]}</span>
                              {isLoading
                                ? <div className="w-4 h-4 rounded-full animate-spin border-2"
                                    style={{ borderColor: GK, borderTopColor: "transparent" }} />
                                : <Toggle on={currentVal} onToggle={() => togglePerm(mod, field, currentVal)} disabled={!managerHas} />
                              }
                              {errMsg && (
                                <div className="col-span-2 mt-1">
                                  <p className="text-[10px] text-red-500 font-semibold">{errMsg}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-3 italic">
                Greyed-out toggles are above your permission level. Every change is logged and the business owner is notified.
              </p>
            </div>
          )}

          {/* Owner-only operations — shown disabled with explanation */}
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 pb-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Owner-Only Actions</p>
            {["Create staff", "Suspend / reactivate", "Delete staff", "Reassign branch"].map(label => (
              <div key={label} className="flex items-center justify-between py-2 opacity-50">
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{label}</p>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">Owner only</span>
              </div>
            ))}
            <p className="text-[10px] text-slate-400 italic mt-1">{OWNER_ONLY_MSG}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManagerStaffManagement({ staff, onBack }) {
  const branchId    = staff?.branch_id;
  const managerId   = staff?.id;

  const [members,     setMembers]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [managerPerms, setManagerPerms] = useState([]);

  useEffect(() => {
    if (!branchId) { setError("Branch not found on your account."); setLoading(false); return; }

    // Load branch staff + manager's own permissions in parallel
    Promise.all([
      supabase.rpc("get_branch_staff", { p_branch_id: branchId }),
      supabase.from("staff_permissions").select("*").eq("staff_id", managerId),
    ]).then(async ([{ data: staffData, error: staffErr }, { data: permsData }]) => {
      if (staffErr) { setError(staffErr.message); setLoading(false); return; }
      setManagerPerms(permsData || []);

      // Load permissions for each staff member
      const ids = (staffData || []).filter(m => m.id !== managerId).map(m => m.id);
      if (ids.length === 0) { setMembers([]); setLoading(false); return; }

      const { data: allPerms } = await supabase.from("staff_permissions").select("*").in("staff_id", ids);
      const permsByStaff = {};
      (allPerms || []).forEach(p => {
        if (!permsByStaff[p.staff_id]) permsByStaff[p.staff_id] = [];
        permsByStaff[p.staff_id].push(p);
      });

      const enriched = (staffData || [])
        .filter(m => m.id !== managerId)
        .map(m => ({ ...m, perms: permsByStaff[m.id] || [] }));

      setMembers(enriched);
      setLoading(false);
    });
  }, [branchId, managerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
          <Svg d={P.back} size={18} color="#64748b" />
        </button>
        <div className="flex-1">
          <h1 className="text-[17px] font-extrabold text-slate-800 dark:text-slate-100">Staff Management</h1>
          <p className="text-xs text-slate-400 mt-0.5">Your branch team</p>
        </div>
        <span className="flex-shrink-0 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: GK, borderTopColor: "transparent" }} />
          </div>
        )}
        {!loading && error && (
          <div className="mx-4 mt-6 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 rounded-2xl px-4 py-4">
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        {!loading && !error && members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <Svg d={P.person} size={28} color="#94a3b8" />
            </div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">No other staff on this branch</p>
            <p className="text-xs text-slate-400 mt-1">Only the business owner can add staff members.</p>
          </div>
        )}
        {!loading && !error && members.length > 0 && (
          <div className="px-4 py-4 space-y-3 pb-8">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-2xl px-4 py-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                All permission changes are logged and the business owner is notified immediately.
              </p>
            </div>
            {members.map(m => (
              <StaffCard
                key={m.id}
                member={m}
                managerPerms={managerPerms}
                managerId={managerId}
              />
            ))}

            {/* Owner-only: create staff */}
            <div className="mt-2">
              <SectionLabel>Owner-Only Operations</SectionLabel>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {["Create New Staff", "Delete Staff", "Suspend Staff", "Reassign to Another Branch"].map(label => (
                  <div key={label} className="flex items-center justify-between px-4 py-3.5 opacity-50">
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">Owner only</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2 px-1">{OWNER_ONLY_MSG}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
