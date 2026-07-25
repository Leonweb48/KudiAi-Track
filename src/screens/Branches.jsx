import { useState, useEffect, useMemo } from "react";
import Modal from "../components/shared/Modal";
import { useBranches } from "../hooks/useBranches";
import { canDo, featureLimit, upgradeLabel, planAvailableText } from "../utils/plans";
import { supabase } from "../utils/supabase";
import { fmt, isBillPayment } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { useT } from "../contexts/LanguageContext";

const MEDALS = ["🥇", "🥈", "🥉"];

function monthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

// ── Shared helpers ────────────────────────────────────────────────────────
function SectionHead({ title }) {
  return (
    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 mt-1">
      {title}
    </p>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 w-24">{label}</span>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right flex-1 break-words">{value}</span>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30" />
    </div>
  );
}

// ── Branch create / edit modal ────────────────────────────────────────────
function BranchModal({ branch, staffList, onClose, onSave }) {
  const t = useT();
  const isEdit = !!branch;
  const [f,      setF]    = useState({
    name:       branch?.name       || "",
    address:    branch?.address    || "",
    phone:      branch?.phone      || "",
    manager_id: branch?.manager_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");
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
    <Modal title={isEdit ? t("branch.editBranch") : t("branch.newBranch")} onClose={onClose}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</p>}
        <LabeledInput label={t("branch.branchName")} value={f.name}    onChange={v => set("name", v)}    placeholder="e.g. Lekki Branch" />
        <LabeledInput label={t("branch.address")}    value={f.address} onChange={v => set("address", v)} placeholder="Street, city, state" />
        <LabeledInput label={t("branch.phone")}      value={f.phone}   onChange={v => set("phone", v)}   placeholder="08012345678" type="tel" />
        {staffList.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{t("branch.manager")}</label>
            <select value={f.manager_id} onChange={e => set("manager_id", e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30">
              <option value="">{t("branch.noManager")}</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{t("branch.status")}</label>
          <select value={f.is_active === false ? "inactive" : "active"} onChange={e => set("is_active", e.target.value === "active")}
            className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30">
            <option value="active">{t("branch.active")}</option>
            <option value="inactive">{t("branch.inactive")}</option>
          </select>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors active:scale-[0.99]">
          {saving ? t("branch.saving") : isEdit ? t("branch.saveChanges") : t("branch.create")}
        </button>
      </div>
    </Modal>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ transactions, credits }) {
  const t = useT();
  const MS = monthStr();
  const today = new Date().toISOString().slice(0, 10);

  const todayTx  = transactions.filter(t => (t.transaction_date || "").startsWith(today));
  const cashIn   = todayTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut  = todayTx.filter(t => t.type === "out" && !isBillPayment(t)).reduce((s, t) => s + t.amount, 0);
  const profit   = cashIn - cashOut;

  const monthIn  = transactions.filter(t => t.type === "in"  && (t.transaction_date || "").startsWith(MS)).reduce((s, t) => s + t.amount, 0);
  const monthOut = transactions.filter(t => t.type === "out" && !isBillPayment(t) && (t.transaction_date || "").startsWith(MS)).reduce((s, t) => s + t.amount, 0);

  const openCr   = credits.filter(c => c.status !== "paid");
  const outstanding = openCr.reduce((s, c) => s + (c.outstanding || 0), 0);

  const recent = [...transactions].sort((a, b) => (b.transaction_date || "").localeCompare(a.transaction_date || "")).slice(0, 10);

  return (
    <div className="px-4 pt-4 pb-6 space-y-4">
      {/* Today hero */}
      <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg bg-[linear-gradient(145deg,#7c3aed_0%,#6d28d9_55%,#4c1d95_100%)]">
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">{t("branch.todayProfit")}</p>
          <AmountDisplay amount={Math.abs(profit)} size="hero" align="left" className="mb-3" style={{ color: profit < 0 ? '#fca5a5' : '#fff' }} />
          <div className="grid grid-cols-2 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">{t("branch.cashIn")}</p>
              <AmountDisplay amount={cashIn} size="small" align="left" className="text-green-200" />
            </div>
            <div className="pl-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">{t("branch.cashOut")}</p>
              <AmountDisplay amount={cashOut} size="small" align="left" className="text-red-200" />
            </div>
          </div>
        </div>
      </div>

      {/* Month stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t("branch.monthSales"),    amount: monthIn,    color: '#16a34a' },
          { label: t("branch.monthExpenses"), amount: monthOut,   color: '#ef4444' },
          { label: t("branch.openCredits"),   count:  openCr.length,   color: "text-amber-600 dark:text-amber-400" },
          { label: t("branch.outstanding"),   amount: outstanding, color: '#d97706' },
        ].map(({ label, amount, count, color }) => (
          <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
            {amount !== undefined
              ? <AmountDisplay amount={amount} size="row" align="left" style={{ color }} />
              : <p className={`text-base font-extrabold tabular ${color}`}>{count}</p>
            }
          </div>
        ))}
      </div>

      {/* Recent credits */}
      {openCr.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <SectionHead title="Open Credits" />
          <div className="space-y-2">
            {openCr.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{(c.customer_name || "?")[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{c.customer_name}</p>
                  <p className="text-[10px] text-slate-400 capitalize">{c.status}</p>
                </div>
                <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 tabular flex-shrink-0">{fmt(c.outstanding || 0)}</span>
              </div>
            ))}
            {openCr.length > 5 && <p className="text-xs text-slate-400 text-center mt-1">+{openCr.length - 5} more</p>}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {recent.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <SectionHead title="Recent Transactions" />
          <div className="space-y-2">
            {recent.map(t => (
              <div key={t.id} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.type === "in" ? "bg-green-500" : "bg-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{t.item_name || t.category || "Transaction"}</p>
                  <p className="text-[10px] text-slate-400">{t.transaction_date}</p>
                </div>
                <span className={`text-sm font-extrabold tabular flex-shrink-0 ${t.type === "in" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {transactions.length === 0 && (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-400 text-sm font-semibold">No transactions yet</p>
        </div>
      )}
    </div>
  );
}

// ── Stock tab ─────────────────────────────────────────────────────────────
function StockTab({ products, movements }) {
  const totalItems  = products.reduce((s, p) => s + (p.quantity || 0), 0);
  const totalValue  = products.reduce((s, p) => s + (p.selling_price || 0) * (p.quantity || 0), 0);
  const lowStock    = products.filter(p => (p.quantity || 0) <= (p.low_stock_threshold || 0));
  const recent      = [...movements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);

  return (
    <div className="px-4 pt-4 pb-6 space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Products",   value: products.length, color: "text-violet-600 dark:text-violet-400" },
          { label: "Total Units", value: totalItems,     color: "text-blue-600 dark:text-blue-400"    },
          { label: "Low Stock",  value: lowStock.length, color: lowStock.length > 0 ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center shadow-sm">
            <p className={`text-lg font-extrabold tabular ${color}`}>{value}</p>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <p className="text-xs text-slate-400">Total Stock Value</p>
        <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400 tabular">{fmt(totalValue)}</p>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-2xl px-4 py-3">
          <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-1">{lowStock.length} item{lowStock.length !== 1 ? "s" : ""} running low</p>
          <div className="flex flex-wrap gap-1.5">
            {lowStock.map(p => (
              <span key={p.id} className="text-[10px] bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-semibold px-2 py-0.5 rounded-full">
                {p.product_name} ({p.quantity})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Product list */}
      {products.length > 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 pt-4 pb-2"><SectionHead title="Products" /></div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {products.map(p => {
              const pct = p.low_stock_threshold > 0 ? Math.min(100, Math.round((p.quantity / Math.max(p.low_stock_threshold * 3, p.quantity)) * 100)) : 100;
              const isLow = (p.quantity || 0) <= (p.low_stock_threshold || 0);
              return (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-white truncate">{p.product_name}</p>
                      {p.category && <p className="text-[10px] text-slate-400 capitalize">{p.category}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-extrabold tabular ${isLow ? "text-red-500" : "text-slate-700 dark:text-slate-200"}`}>
                        {p.quantity || 0} units
                      </p>
                      <p className="text-[10px] text-slate-400">{fmt(p.selling_price || 0)} each</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${isLow ? "bg-red-400" : "bg-violet-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-400 text-sm font-semibold">No stock items for this branch</p>
        </div>
      )}

      {/* Recent movements */}
      {recent.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <SectionHead title="Recent Stock Movements" />
          <div className="space-y-2">
            {recent.map(m => {
              const prod = products.find(p => p.id === m.product_id);
              const isIn = m.type === "restock" || (m.type === "adjustment" && m.quantity > 0);
              return (
                <div key={m.id} className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isIn ? "bg-green-500" : "bg-red-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{prod?.product_name || "Unknown product"}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{m.type} · {new Date(m.created_at).toLocaleDateString("en-NG")}</p>
                  </div>
                  <span className={`text-xs font-extrabold flex-shrink-0 ${isIn ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {isIn ? "+" : "−"}{Math.abs(m.quantity)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ajo tab ───────────────────────────────────────────────────────────────
function AjoTab({ asoClients }) {
  const total      = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const totalSaved = asoClients.reduce((s, c) => s + (c.total_saved     || 0), 0);
  const active     = asoClients.filter(c => c.status === "active").length;
  const now        = new Date(); now.setHours(0, 0, 0, 0);
  const overdue    = asoClients.filter(c => c.next_contribution_date && c.status === "active" && now > new Date(c.next_contribution_date));

  return (
    <div className="px-4 pt-4 pb-6 space-y-4">
      {/* Summary */}
      <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg bg-[linear-gradient(145deg,#7c3aed_0%,#6d28d9_55%,#4c1d95_100%)]">
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Total Balance</p>
          <AmountDisplay amount={total} size="hero" align="left" className="text-white mb-3" />
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Total Saved</p>
              <AmountDisplay amount={totalSaved} size="small" align="left" className="text-green-200" />
            </div>
            <div className="px-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Clients</p>
              <p className="text-sm font-extrabold">{asoClients.length}</p>
            </div>
            <div className="pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Active</p>
              <p className="text-sm font-extrabold">{active}</p>
            </div>
          </div>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-2xl px-4 py-3">
          <p className="text-xs font-bold text-red-600 dark:text-red-400">{overdue.length} contribution{overdue.length !== 1 ? "s" : ""} overdue</p>
        </div>
      )}

      {asoClients.length > 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 pt-4 pb-2"><SectionHead title="Clients" /></div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {asoClients.map(c => {
              const initials = (c.full_name || "?")[0].toUpperCase();
              const isOverdue = c.status === "active" && c.next_contribution_date && now > new Date(c.next_contribution_date);
              return (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
                    {c.profile_image_url
                      ? <img src={c.profile_image_url} alt={c.full_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 font-black text-sm">{initials}</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 dark:text-white truncate">{c.full_name}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{c.contribution_frequency} · {fmt(c.contribution_amount || 0)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400 tabular">{fmt(c.current_balance || 0)}</p>
                    {isOverdue && <p className="text-[9px] text-red-500 font-bold">Overdue</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-400 text-sm font-semibold">No Ajo clients for this branch</p>
        </div>
      )}
    </div>
  );
}

// ── People tab ────────────────────────────────────────────────────────────
function PeopleTab({ staff, managerId, loading }) {
  const manager  = staff.find(s => s.id === managerId);
  const others   = staff.filter(s => s.id !== managerId);

  const StaffCard = ({ s, isManager }) => {
    const initials = (s.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return (
      <div className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm overflow-hidden ${isManager ? "border-violet-200 dark:border-violet-700" : "border-slate-100 dark:border-slate-700"}`}>
        {isManager && (
          <div className="px-4 py-2 bg-violet-600">
            <p className="text-[10px] font-bold text-white uppercase tracking-widest">Branch Manager</p>
          </div>
        )}
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-slate-100 dark:border-slate-600">
              {s.profile_image_url
                ? <img src={s.profile_image_url} alt={s.full_name} className="w-full h-full object-cover" />
                : <div className={`w-full h-full flex items-center justify-center font-black text-lg ${isManager ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
                    {initials}
                  </div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-slate-800 dark:text-white truncate">{s.full_name}</p>
              <p className="text-xs text-slate-400 capitalize mt-0.5">{(s.role || "staff").replace(/_/g, " ")}</p>
              <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full mt-1 ${s.status === "active" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-red-100 text-red-500"}`}>
                {s.status || "active"}
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            <InfoRow label="Phone" value={s.phone} />
            <InfoRow label="Email" value={s.email} />
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="px-4 pt-4 pb-6">
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-400 text-sm font-semibold">No staff assigned to this branch</p>
          <p className="text-slate-400 text-xs mt-1">Assign staff from the Staff Management section</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-6 space-y-3">
      {manager && <StaffCard s={manager} isManager />}
      {others.map(s => <StaffCard key={s.id} s={s} isManager={false} />)}
    </div>
  );
}

// ── Branch detail page ────────────────────────────────────────────────────
function BranchDetail({ branch, transactions, credits, asoClients, allProducts, allMovements, staffMap, onClose, onEdit, onDelete, onReport, userId }) {
  const [tab,          setTab]          = useState("overview");
  const [branchStaff,  setBranchStaff]  = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const products  = useMemo(() => (allProducts  || []).filter(p => p.branch_id === branch.id), [allProducts, branch.id]);
  const movements = useMemo(() => (allMovements || []).filter(m => m.branch_id === branch.id), [allMovements, branch.id]);

  useEffect(() => {
    if (!branch?.id || !userId) return;
    setLoadingStaff(true);
    supabase.from("staff")
      .select("id, full_name, role, status, phone, email, profile_image_url, branch_id")
      .eq("owner_id", userId)
      .eq("branch_id", branch.id)
      .then(({ data }) => {
        if (data) setBranchStaff(data);
        setLoadingStaff(false);
      });
  }, [branch?.id, userId]);

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "stock",    label: "Stock"    },
    { id: "ajo",      label: "Ajo"      },
    { id: "people",   label: "People"   },
  ];

  const managerName = branch.manager_id ? (staffMap[branch.manager_id] || null) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-extrabold text-slate-800 dark:text-white truncate text-sm">{branch.name}</h2>
          <p className="text-[10px] text-slate-400">
            {managerName ? `Manager: ${managerName}` : "No manager assigned"}
            {!branch.is_active && " · Inactive"}
          </p>
        </div>
        <button onClick={() => setShowEditModal(true)}
          className="p-2 rounded-xl text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button onClick={() => onReport({ transactions, credits, asoClients })}
          className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition">
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          Report
        </button>
      </div>

      {/* Tab bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 flex-shrink-0">
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-3 text-xs font-bold border-b-2 transition-colors ${tab === t.id ? "border-violet-600 text-violet-600 dark:text-violet-400 dark:border-violet-400" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && <OverviewTab transactions={transactions} credits={credits} />}
        {tab === "stock"    && <StockTab products={products} movements={movements} />}
        {tab === "ajo"      && <AjoTab asoClients={asoClients} />}
        {tab === "people"   && <PeopleTab staff={branchStaff} managerId={branch.manager_id} loading={loadingStaff} />}
      </div>

      {/* Edit modal */}
      {showEditModal && (
        <BranchModal
          branch={branch}
          staffList={Object.entries(staffMap).map(([id, full_name]) => ({ id, full_name }))}
          onClose={() => setShowEditModal(false)}
          onSave={async (data) => {
            const ok = await onEdit(data);
            return ok;
          }}
        />
      )}
    </div>
  );
}

// ── Main Branches screen ──────────────────────────────────────────────────
export default function Branches({ store, onClose, userId, inventory = {}, onReport, plan = "kobo", onUpgrade }) {
  const t = useT();
  const { branches, loading: branchLoading, addBranch, updateBranch, deleteBranch } = useBranches(userId);
  const { transactions = [], credits = [], asoClients = [], staffMap = {} } = store;
  const { products: allProducts = [], movements: allMovements = [] } = inventory;

  const [view,     setView]     = useState("list");
  const [selected, setSelected] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);

  const staffList = useMemo(() =>
    Object.entries(staffMap).map(([id, full_name]) => ({ id, full_name })),
    [staffMap]
  );

  const MS = monthStr();

  const branchStats = useMemo(() => {
    const map = {};
    branches.forEach(b => {
      const bTx  = transactions.filter(t => t.branch_id === b.id);
      const bCr  = credits.filter(c => c.branch_id === b.id);
      const bAso = asoClients.filter(c => c.branch_id === b.id);
      const bPrd = allProducts.filter(p => p.branch_id === b.id);
      map[b.id] = {
        salesMonth:  bTx.filter(t => t.type === "in"  && (t.transaction_date || "").startsWith(MS)).reduce((s, t) => s + t.amount, 0),
        expensMonth: bTx.filter(t => t.type === "out" && !isBillPayment(t) && (t.transaction_date || "").startsWith(MS)).reduce((s, t) => s + t.amount, 0),
        openCredits: bCr.filter(c => c.status !== "paid").length,
        ajoBalance:  bAso.reduce((s, c) => s + (c.current_balance || 0), 0),
        ajoClients:  bAso.length,
        stockItems:  bPrd.length,
        txCount:     bTx.length,
      };
    });
    return map;
  }, [branches, transactions, credits, asoClients, allProducts, MS]);

  const totalSalesMonth = useMemo(() =>
    transactions.filter(t => t.type === "in" && (t.transaction_date || "").startsWith(MS)).reduce((s, t) => s + t.amount, 0),
    [transactions, MS]
  );

  const ranked = useMemo(() =>
    [...branches].sort((a, b) => (branchStats[b.id]?.salesMonth || 0) - (branchStats[a.id]?.salesMonth || 0)),
    [branches, branchStats]
  );

  const hqTx  = useMemo(() => transactions.filter(t => !t.branch_id), [transactions]);
  const hqCr  = useMemo(() => credits.filter(c => !c.branch_id), [credits]);

  if (!canDo(plan, "branches")) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
          <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-slate-800 dark:text-white">Branch Management</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-24 h-24 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-5">
            <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-violet-600">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Branch Management</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs leading-relaxed">
            Run multiple business locations from one dashboard. Compare performance, assign staff, and track sales per branch. {planAvailableText("branches")}
          </p>
          <button onClick={onUpgrade} className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition shadow-md">
            {upgradeLabel("branches")}
          </button>
        </div>
      </div>
    );
  }

  const openDetail = (branch) => { setSelected(branch); setView("detail"); };
  const closeDetail = () => { setView("list"); setSelected(null); };

  const getManagerName = (branch) => branch?.manager_id ? (staffMap[branch.manager_id] || null) : null;

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Remove "${selected.name}"? Transactions tagged to this branch will be untagged, not deleted.`)) return;
    await deleteBranch(selected.id);
    closeDetail();
  };

  if (view === "detail" && selected) {
    const branchTx  = transactions.filter(t => t.branch_id === selected.id);
    const branchCr  = credits.filter(c => c.branch_id === selected.id);
    const branchAso = asoClients.filter(c => c.branch_id === selected.id);
    return (
      <BranchDetail
        branch={selected}
        transactions={branchTx}
        credits={branchCr}
        asoClients={branchAso}
        allProducts={allProducts}
        allMovements={allMovements}
        staffMap={staffMap}
        onClose={closeDetail}
        onEdit={async (data) => {
          const ok = await updateBranch(selected.id, data);
          if (ok) setSelected(prev => ({ ...prev, ...data }));
          return ok;
        }}
        onDelete={handleDelete}
        onReport={(filteredData) => onReport?.({ ...filteredData, profile: store.profile })}
        userId={userId}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h1 className="flex-1 text-lg font-extrabold text-slate-800 dark:text-white">{t("branch.title")}</h1>
        <button onClick={() => {
            const branchLimit = featureLimit(plan, "branches");
            if (branchLimit !== Infinity && branches.length >= branchLimit) { onUpgrade?.(); return; }
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">
        {/* Summary hero */}
        <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg bg-[linear-gradient(145deg,#7c3aed_0%,#6d28d9_55%,#4c1d95_100%)]">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative">
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">All Branches · This Month</p>
            <AmountDisplay amount={totalSalesMonth} size="hero" align="left" className="text-white mb-3" />
            <div className="grid grid-cols-3 divide-x divide-white/20">
              <div className="pr-3 min-w-0">
                <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Active</p>
                <p className="text-sm font-extrabold">{branches.filter(b => b.is_active !== false).length}</p>
              </div>
              <div className="px-3 min-w-0">
                <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Open Credits</p>
                <p className="text-sm font-extrabold text-amber-200">{credits.filter(c => c.status !== "paid").length}</p>
              </div>
              <div className="pl-3 min-w-0">
                <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">Ajo Balance</p>
                <AmountDisplay amount={asoClients.reduce((s, c) => s + (c.current_balance || 0), 0)} size="small" align="left" className="text-green-200" />
              </div>
            </div>
          </div>
        </div>

        {/* Performance ranking */}
        {ranked.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 border border-slate-100 dark:border-slate-700">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Branch Ranking — This Month</p>
            <div className="space-y-2.5">
              {ranked.map((b, i) => {
                const stats = branchStats[b.id] || {};
                const pct   = totalSalesMonth > 0 ? Math.round(((stats.salesMonth || 0) / totalSalesMonth) * 100) : 0;
                return (
                  <button key={b.id} onClick={() => openDetail(b)}
                    className="w-full flex items-center gap-3 text-left active:scale-[0.99] transition">
                    <span className="text-lg w-7 flex-shrink-0 text-center">{MEDALS[i] || `${i + 1}.`}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{b.name}</span>
                        <span className="text-xs font-extrabold text-green-600 dark:text-green-400 flex-shrink-0 ml-2 tabular">{fmt(stats.salesMonth || 0)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 w-8 text-right">{pct}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Branch cards */}
        {branchLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : branches.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
            <div className="w-14 h-14 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-violet-500" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <p className="font-bold text-slate-600 dark:text-slate-300 text-sm">No branches yet</p>
            <p className="text-xs text-slate-400 mt-1">Tap New to create your first branch</p>
          </div>
        ) : (
          <div className="space-y-3">
            {branches.map(b => {
              const stats = branchStats[b.id] || {};
              const mgr   = getManagerName(b);
              const profit = (stats.salesMonth || 0) - (stats.expensMonth || 0);
              return (
                <button key={b.id} onClick={() => openDetail(b)}
                  className="w-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden text-left active:scale-[0.99] transition hover:shadow-md">
                  {/* Card top strip */}
                  <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-50 dark:border-slate-700/60">
                    <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-violet-600 dark:text-violet-400" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-800 dark:text-white text-sm truncate">{b.name}</span>
                        {b.is_active === false && <span className="text-[9px] bg-red-100 text-red-500 font-bold px-1.5 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {b.address && <span className="text-[10px] text-slate-400 truncate max-w-[100px]">{b.address}</span>}
                        {mgr && (
                          <>
                            {b.address && <span className="text-slate-300 dark:text-slate-600">·</span>}
                            <span className="text-[10px] text-violet-500 font-semibold">{mgr}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0 rotate-180" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </div>
                  {/* Stats row */}
                  <div className="grid grid-cols-4 divide-x divide-slate-50 dark:divide-slate-700/60 px-1 py-2.5">
                    {[
                      { label: "Sales",   value: fmt(stats.salesMonth || 0),    color: "text-green-600 dark:text-green-400" },
                      { label: "Profit",  value: fmt(profit),                    color: profit >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-500" },
                      { label: "Credits", value: stats.openCredits || 0,          color: "text-amber-600 dark:text-amber-400" },
                      { label: "Ajo",     value: fmt(stats.ajoBalance || 0),      color: "text-violet-600 dark:text-violet-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center px-1">
                        <p className={`text-xs font-extrabold tabular leading-tight ${color}`}>{value}</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                  {/* Bottom meta */}
                  <div className="px-4 py-2 bg-slate-50/60 dark:bg-slate-700/20 flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
                    <span>{stats.txCount || 0} transactions</span>
                    <span className="text-slate-200 dark:text-slate-600">·</span>
                    <span>{stats.stockItems || 0} stock items</span>
                    <span className="text-slate-200 dark:text-slate-600">·</span>
                    <span>{stats.ajoClients || 0} Ajo clients</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Head office (untagged) */}
        {hqTx.length > 0 && (
          <div className="bg-slate-100 dark:bg-slate-800/60 rounded-2xl px-4 py-3.5 flex items-center gap-3 border border-slate-200 dark:border-slate-700">
            <div className="w-9 h-9 bg-slate-300 dark:bg-slate-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Head Office</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{hqTx.length} transactions · {hqCr.length} credits (unassigned)</p>
            </div>
            <p className="text-sm font-extrabold text-slate-600 dark:text-slate-300 tabular">
              {fmt(hqTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0))}
            </p>
          </div>
        )}
      </div>

      {showAdd && (
        <BranchModal branch={null} staffList={staffList} onClose={() => setShowAdd(false)} onSave={addBranch} />
      )}
    </div>
  );
}
