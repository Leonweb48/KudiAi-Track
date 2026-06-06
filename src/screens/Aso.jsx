import { useState, useEffect } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import Field from "../components/shared/Field";
import Badge from "../components/shared/Badge";
import { fmt, today } from "../utils/helpers";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { canDo } from "../utils/plans";
import { exportAsoStatement } from "../utils/pdfExport";

export default function Aso({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [selected, setSelected] = useState(null);
  const [action,   setAction]   = useState(null);
  const [amt,      setAmt]      = useState("");
  const { asoClients, addAsoClient, asoContribute, asoWithdraw, profile } = store;

  const [f, setF] = useState({
    full_name: "", phone: "", address: "", state: "Lagos", lga: "",
    contribution_frequency: "daily", contribution_amount: "",
    registration_charge: "", withdrawal_fee_percent: 5, notes: "",
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (autoOpen && canDo(plan, "aso")) {
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, onAutoOpened, plan]);

  const lgas       = getLGAs(f.state);
  const totalBal   = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const totalSaved = asoClients.reduce((s, c) => s + c.total_saved, 0);

  if (!canDo(plan, "aso")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-5">
          <span className="text-5xl">🔒</span>
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
    <div className="px-4 pt-4 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">Aso Savings</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-violet-600 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Summary card */}
      <div className="rounded-2xl p-4 mb-5 shadow text-white"
        style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}>
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs text-purple-200 font-semibold uppercase tracking-wider">Total Balance</p>
            <p className="text-2xl font-extrabold mt-0.5">{fmt(totalBal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-purple-200">{asoClients.length} clients</p>
            <p className="text-sm font-bold text-purple-200 mt-1">Saved: {fmt(totalSaved)}</p>
          </div>
        </div>
      </div>

      {asoClients.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-20 h-20 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">🫙</span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">No savings clients yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to enroll your first client</p>
        </div>
      ) : (
        <div className="space-y-3">
          {asoClients.map((c) => (
            <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-sm border border-slate-100 dark:border-slate-700">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-100">{c.full_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {c.phone} · {c.contribution_frequency} · {fmt(c.contribution_amount)}
                  </p>
                </div>
                <Badge status={c.status} />
              </div>

              <div className="flex gap-2 mb-3">
                {[
                  { label: "Balance",   value: c.current_balance, color: "text-violet-700 dark:text-violet-400",  bg: "bg-violet-50 dark:bg-violet-900/20" },
                  { label: "Saved",     value: c.total_saved,     color: "text-green-700 dark:text-green-400",   bg: "bg-green-50 dark:bg-green-900/20"  },
                  { label: "Withdrawn", value: c.total_withdrawn, color: "text-red-600 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-900/20"      },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`flex-1 ${bg} rounded-xl p-2`}>
                    <p className="text-[10px] text-slate-400 font-semibold">{label}</p>
                    <p className={`text-sm font-extrabold ${color}`}>{fmt(value)}</p>
                  </div>
                ))}
              </div>

              {c.notes && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-2">"{c.notes}"</p>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setSelected(c); setAction("contribute"); }}
                  className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 active:scale-95 transition">
                  + Contribute
                </button>
                <button onClick={() => { setSelected(c); setAction("withdraw"); }}
                  className="flex-1 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-xs border border-red-200 dark:border-red-800 active:scale-95 transition">
                  Withdraw
                </button>
                <button onClick={() => exportAsoStatement(c, profile)}
                  className="py-2 px-3 bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 active:scale-95 transition flex items-center gap-1">
                  <Icon name="download" size={12} /> PDF
                </button>
                {/* Aso is already gated on business+, so PDF is always allowed here */}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add client modal */}
      {showAdd && (
        <Modal title="Add Aso Client" onClose={() => setShowAdd(false)}>
          <Field label="Full Name / Group Name" value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)} placeholder="e.g. Mama Ngozi Cooperative" />
          <Field label="Phone" type="tel" value={f.phone}
            onChange={(e) => set("phone", e.target.value)} placeholder="0801 234 5678" />
          <Field label="Address" value={f.address}
            onChange={(e) => set("address", e.target.value)} placeholder="Optional" />

          <div className="grid grid-cols-2 gap-2">
            <Field label="State" as="select" value={f.state}
              onChange={(e) => { set("state", e.target.value); set("lga", ""); }}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Field>
            <Field label="LGA" as="select" value={f.lga}
              onChange={(e) => set("lga", e.target.value)}>
              <option value="">— Select LGA —</option>
              {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
            </Field>
          </div>

          <Field label="Contribution Frequency" as="select" value={f.contribution_frequency}
            onChange={(e) => set("contribution_frequency", e.target.value)}>
            {["daily", "weekly", "monthly"].map((o) => <option key={o} value={o}>{o}</option>)}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Contribution (₦)" type="number" value={f.contribution_amount}
              onChange={(e) => set("contribution_amount", e.target.value)} placeholder="0.00" />
            <Field label="Reg. Fee (₦)" type="number" value={f.registration_charge}
              onChange={(e) => set("registration_charge", e.target.value)} placeholder="0.00" />
          </div>

          <Field label="Withdrawal Fee %" type="number" value={f.withdrawal_fee_percent}
            onChange={(e) => set("withdrawal_fee_percent", parseFloat(e.target.value))} />
          <Field label="Notes" as="textarea" value={f.notes}
            onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes…" />

          <button
            onClick={() => {
              if (!f.full_name) return;
              addAsoClient({
                ...f,
                contribution_amount: parseFloat(f.contribution_amount || 0),
                registration_charge: parseFloat(f.registration_charge || 0),
                status: "active",
                next_contribution_date: today(),
              });
              setShowAdd(false);
            }}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition">
            Add Client
          </button>
        </Modal>
      )}

      {/* Contribute / Withdraw modal */}
      {selected && action && (
        <Modal
          title={`${action === "contribute" ? "Record Contribution" : "Process Withdrawal"} — ${selected.full_name}`}
          onClose={() => { setSelected(null); setAction(null); setAmt(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Current balance: <strong className="text-violet-600 dark:text-violet-400">{fmt(selected.current_balance)}</strong>
          </p>
          {action === "withdraw" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
              Fee: {selected.withdrawal_fee_percent}% will be deducted
            </p>
          )}
          <Field label="Amount (₦)" type="number" value={amt}
            onChange={(e) => setAmt(e.target.value)} placeholder="Enter amount" />
          <button
            onClick={() => {
              if (!amt) return;
              const a = parseFloat(amt);
              if (action === "contribute") asoContribute(selected.id, a);
              else asoWithdraw(selected.id, a);
              setSelected(null); setAction(null); setAmt("");
            }}
            className={`w-full py-3 text-white rounded-xl font-bold text-sm transition ${
              action === "contribute" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            }`}>
            Confirm {action === "contribute" ? "Contribution" : "Withdrawal"}
          </button>
        </Modal>
      )}
    </div>
  );
}
