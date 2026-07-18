import { useState, useEffect } from "react";

export default function AssignRecordModal({ type, record, branchList = [], staffList = [], onSave, onClose }) {
  const [branchId, setBranchId] = useState(record?.branch_id || "");
  const [staffId,  setStaffId]  = useState(record?.staff_id  || "");
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    setBranchId(record?.branch_id || "");
    setStaffId(record?.staff_id   || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]); // only reset when the record identity changes, not on every field update

  const filteredStaff = staffList.filter(s =>
    !branchId || !s.branch_id || s.branch_id === branchId
  );

  async function handleSave() {
    setSaving(true);
    await onSave(branchId || null, type !== "product" ? (staffId || null) : undefined);
    setSaving(false);
    onClose();
  }

  const label = record?.customer_name || record?.full_name || record?.product_name || "";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl px-5 pt-5 pb-8 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 dark:text-brand-400">Assign</p>
            <h2 className="text-base font-black text-slate-900 dark:text-white mt-0.5 leading-tight">{label}</h2>
          </div>
          <button onClick={onClose} className="mt-0.5 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Branch */}
        <div>
          <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Branch</label>
          <select
            value={branchId}
            onChange={e => { setBranchId(e.target.value); setStaffId(""); }}
            className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-400 min-h-[44px]">
            <option value="">— Main stock / Unassigned —</option>
            {branchList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {/* Staff — not shown for products */}
        {type !== "product" && (
          <div>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Staff member</label>
            <select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-400 min-h-[44px]">
              <option value="">— Any staff / Unassigned —</option>
              {filteredStaff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition min-h-[44px]">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 rounded-xl bg-brand-500 text-white text-sm font-bold hover:bg-brand-600 transition disabled:opacity-60 min-h-[44px]">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
