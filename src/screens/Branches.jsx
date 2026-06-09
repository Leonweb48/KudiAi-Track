import { useState, useEffect, useMemo } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import { useBranches } from "../hooks/useBranches";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";

const MEDALS = ["🥇", "🥈", "🥉"];

function StatPill({ label, value, color = "text-slate-700 dark:text-slate-200" }) {
  return (
    <div className="text-center">
      <p className={`text-base font-bold leading-tight ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-400 font-medium mt-0.5">{label}</p>
    </div>
  );
}

function FieldRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 items-start">
      <span className="text-xs text-slate-400 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-700 dark:text-slate-200 font-medium flex-1">{value}</span>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30"
      />
    </div>
  );
}

function BranchModal({ branch, staffList, onClose, onSave }) {
  const isEdit = !!branch;
  const [f, setF] = useState({
    name:       branch?.name       || "",
    address:    branch?.address    || "",
    phone:      branch?.phone      || "",
    manager_id: branch?.manager_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!f.name.trim()) { setErr("Branch name is required"); return; }
    setSaving(true); setErr("");
    const ok = await onSave(f);
    setSaving(false);
    if (ok) onClose();
    else setErr("Could not save branch. Try again.");
  };

  return (
    <Modal title={isEdit ? "Edit Branch" : "New Branch"} onClose={onClose}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</p>}
        <LabeledInput label="Branch Name *" value={f.name} onChange={v => set("name", v)} placeholder="e.g. Lekki Branch" />
        <LabeledInput label="Address"       value={f.address} onChange={v => set("address", v)} placeholder="Street, city, state" />
        <LabeledInput label="Phone"         value={f.phone}   onChange={v => set("phone", v)}   placeholder="08012345678" type="tel" />
        {staffList.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Branch Manager</label>
            <select value={f.manager_id} onChange={e => set("manager_id", e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30">
              <option value="">— No manager assigned —</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Branch"}
        </button>
      </div>
    </Modal>
  );
}

function BranchDetail({ branch, transactions, credits, managerName, onClose, onEdit, onDelete, userId }) {
  const [branchStaff, setBranchStaff] = useState([]);

  useEffect(() => {
    if (!branch?.id || !userId) return;
    supabase.from("staff")
      .select("id, full_name, role, status")
      .eq("owner_id", userId)
      .eq("branch_id", branch.id)
      .then(({ data }) => { if (data) setBranchStaff(data); });
  }, [branch?.id, userId]);

  const now      = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const salesMonth   = transactions.filter(t => t.type === "in" && (t.transaction_date || "").startsWith(monthStr)).reduce((s, t) => s + t.amount, 0);
  const expensMonth  = transactions.filter(t => t.type === "out" && (t.transaction_date || "").startsWith(monthStr)).reduce((s, t) => s + t.amount, 0);
  const totalSales   = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const openCredits  = credits.filter(c => c.status !== "paid");
  const outstanding  = openCredits.reduce((s, c) => s + c.outstanding, 0);

  const recent = transactions.slice(0, 8);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 dark:bg-slate-900 flex flex-col max-w-md mx-auto left-1/2 -translate-x-1/2">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Icon name="arrow" size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-800 dark:text-white truncate">{branch.name}</h2>
          {!branch.is_active && <span className="text-[10px] text-red-500 font-semibold">Inactive</span>}
        </div>
        <button onClick={onEdit} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Icon name="edit" size={18} />
        </button>
        <button onClick={onDelete} className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">
        {/* Branch info */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 space-y-2">
          <FieldRow label="Address" value={branch.address} />
          <FieldRow label="Phone"   value={branch.phone} />
          <FieldRow label="Manager" value={managerName || "Not assigned"} />
        </div>

        {/* Stats */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Performance</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <StatPill label="Sales (Month)" value={fmt(salesMonth)}  color="text-green-600 dark:text-green-400" />
            <StatPill label="Expenses"      value={fmt(expensMonth)} color="text-red-500 dark:text-red-400"    />
            <StatPill label="All-time Sales" value={fmt(totalSales)} color="text-violet-600 dark:text-violet-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatPill label="Open Credits"  value={openCredits.length}  color="text-amber-600 dark:text-amber-400" />
            <StatPill label="Outstanding"   value={fmt(outstanding)}    color="text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        {/* Staff */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Staff ({branchStaff.length})
          </p>
          {branchStaff.length === 0 ? (
            <p className="text-sm text-slate-400">No staff assigned to this branch yet.</p>
          ) : (
            <div className="space-y-2">
              {branchStaff.map(s => (
                <div key={s.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-violet-600 dark:text-violet-400">{s.full_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{s.full_name}</p>
                    <p className="text-xs text-slate-400 capitalize">{s.role || "staff"}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.status === "active" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-red-100 text-red-500"}`}>
                    {s.status || "active"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        {recent.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Recent Transactions</p>
            <div className="space-y-2">
              {recent.map(t => (
                <div key={t.id} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.type === "in" ? "bg-green-500" : "bg-red-400"}`} />
                  <p className="flex-1 text-sm text-slate-600 dark:text-slate-300 truncate">{t.item_name || t.category}</p>
                  <span className={`text-sm font-bold flex-shrink-0 ${t.type === "in" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Branches({ store, onClose, userId }) {
  const { branches, loading: branchLoading, addBranch, updateBranch, deleteBranch } = useBranches(userId);
  const { transactions, credits, staffMap = {} } = store;

  const [view,       setView]       = useState("list");
  const [selected,   setSelected]   = useState(null);
  const [showAdd,    setShowAdd]     = useState(false);
  const [showEdit,   setShowEdit]    = useState(false);

  const staffList = useMemo(() =>
    Object.entries(staffMap).map(([id, full_name]) => ({ id, full_name })),
    [staffMap]
  );

  const now      = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const branchStats = useMemo(() => {
    const map = {};
    branches.forEach(b => {
      const bTx = transactions.filter(t => t.branch_id === b.id);
      const bCr = credits.filter(c => c.branch_id === b.id);
      map[b.id] = {
        salesMonth:  bTx.filter(t => t.type === "in"  && (t.transaction_date || "").startsWith(monthStr)).reduce((s, t) => s + t.amount, 0),
        salesTotal:  bTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0),
        openCredits: bCr.filter(c => c.status !== "paid").length,
        txCount:     bTx.length,
      };
    });
    return map;
  }, [branches, transactions, credits, monthStr]);

  const hqTx = useMemo(() => transactions.filter(t => !t.branch_id), [transactions]);
  const hqCr = useMemo(() => credits.filter(c => !c.branch_id), [credits]);

  const totalSalesMonth = useMemo(() =>
    transactions.filter(t => t.type === "in" && (t.transaction_date || "").startsWith(monthStr)).reduce((s, t) => s + t.amount, 0),
    [transactions, monthStr]
  );

  const ranked = useMemo(() =>
    [...branches].sort((a, b) => (branchStats[b.id]?.salesMonth || 0) - (branchStats[a.id]?.salesMonth || 0)),
    [branches, branchStats]
  );

  const openDetail = (branch) => { setSelected(branch); setView("detail"); };
  const closeDetail = () => { setView("list"); setSelected(null); };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"? All data tagged to this branch will become untagged (not deleted).`)) return;
    await deleteBranch(selected.id);
    closeDetail();
  };

  const handleEditSave = async (data) => {
    if (!selected) return false;
    return updateBranch(selected.id, data);
  };

  const getManagerName = (branch) => {
    if (!branch?.manager_id) return null;
    return staffMap[branch.manager_id] || null;
  };

  if (view === "detail" && selected) {
    const branchTx = transactions.filter(t => t.branch_id === selected.id);
    const branchCr = credits.filter(c => c.branch_id === selected.id);
    return (
      <>
        <BranchDetail
          branch={selected}
          transactions={branchTx}
          credits={branchCr}
          managerName={getManagerName(selected)}
          onClose={closeDetail}
          onEdit={() => setShowEdit(true)}
          onDelete={handleDelete}
          userId={userId}
        />
        {showEdit && (
          <BranchModal
            branch={selected}
            staffList={staffList}
            onClose={() => setShowEdit(false)}
            onSave={async (data) => {
              const ok = await handleEditSave(data);
              if (ok) setSelected(prev => ({ ...prev, ...data }));
              return ok;
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col max-w-md mx-auto left-1/2 -translate-x-1/2">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4 flex items-center gap-3">
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Icon name="x" size={20} />
        </button>
        <h1 className="flex-1 text-lg font-bold text-slate-800 dark:text-white">Branch Management</h1>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-xl text-sm font-bold shadow-sm">
          <Icon name="plus" size={15} />
          Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">
        {/* Head office summary */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Head Office — This Month</p>
          <div className="grid grid-cols-3 gap-3">
            <StatPill label="Total Sales"   value={fmt(totalSalesMonth)}        color="text-green-600 dark:text-green-400"  />
            <StatPill label="Active Branches" value={branches.filter(b => b.is_active).length} color="text-violet-600 dark:text-violet-400" />
            <StatPill label="Open Credits"  value={credits.filter(c => c.status !== "paid").length} color="text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        {/* Performance ranking */}
        {ranked.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Branch Performance (This Month)</p>
            <div className="space-y-2">
              {ranked.map((b, i) => {
                const stats = branchStats[b.id] || {};
                const pct   = totalSalesMonth > 0 ? Math.round((stats.salesMonth || 0) / totalSalesMonth * 100) : 0;
                return (
                  <button key={b.id} onClick={() => openDetail(b)}
                    className="w-full flex items-center gap-3 py-2 text-left">
                    <span className="text-lg w-7 flex-shrink-0">{MEDALS[i] || `${i + 1}.`}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{b.name}</span>
                        <span className="text-sm font-bold text-green-600 dark:text-green-400 flex-shrink-0 ml-2">{fmt(stats.salesMonth || 0)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0 w-8 text-right">{pct}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Branch list */}
        {branchLoading ? (
          <div className="text-center py-8 text-slate-400 text-sm">Loading…</div>
        ) : branches.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Icon name="home" size={28} className="text-violet-500 dark:text-violet-400" />
            </div>
            <p className="font-semibold text-slate-600 dark:text-slate-300 text-sm">No branches yet</p>
            <p className="text-xs text-slate-400 mt-1">Tap Add to create your first branch</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">All Branches</p>
            <div className="space-y-2">
              {branches.map(b => {
                const stats = branchStats[b.id] || {};
                const mgr   = getManagerName(b);
                return (
                  <button key={b.id} onClick={() => openDetail(b)}
                    className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3.5 flex items-center gap-3 text-left hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon name="home" size={18} className="text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 dark:text-white text-sm truncate">{b.name}</span>
                        {!b.is_active && <span className="text-[9px] bg-red-100 text-red-500 font-bold px-1.5 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {b.address && <span className="text-xs text-slate-400 truncate max-w-[120px]">{b.address}</span>}
                        {mgr && <span className="text-xs text-violet-500 font-semibold">{mgr}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-green-600 dark:text-green-400">{fmt(stats.salesMonth || 0)}</p>
                      <p className="text-[10px] text-slate-400">{stats.txCount || 0} txns</p>
                    </div>
                    <Icon name="arrow" size={14} className="text-slate-300 dark:text-slate-600 transform rotate-180 flex-shrink-0" />
                  </button>
                );
              })}
            </div>

            {/* Head office (untagged) */}
            {hqTx.length > 0 && (
              <div className="bg-slate-100 dark:bg-slate-800/60 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Head Office (unassigned)</p>
                  <p className="text-xs text-slate-400 mt-0.5">{hqTx.length} transactions · {hqCr.length} credits</p>
                </div>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                  {fmt(hqTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0))}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {showAdd && (
        <BranchModal
          branch={null}
          staffList={staffList}
          onClose={() => setShowAdd(false)}
          onSave={addBranch}
        />
      )}
    </div>
  );
}
