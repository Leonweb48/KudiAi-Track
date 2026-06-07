import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import { AsoReceipt }    from "../components/shared/Receipt";
import { ClientProfile } from "../components/shared/ClientProfile";
import { fmt, today } from "../utils/helpers";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { canDo } from "../utils/plans";

export default function Aso({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const [showAdd,    setShowAdd]    = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [action,     setAction]     = useState(null);
  const [amt,        setAmt]        = useState("");
  const [receipt,    setReceipt]    = useState(null);
  const [clientProf, setClientProf] = useState(null);
  const { asoClients, addAsoClient, asoContribute, asoWithdraw, updateAsoClient, profile } = store;

  const [f, setF] = useState({
    full_name: "", phone: "", address: "", state: "Lagos", lga: "",
    contribution_frequency: "daily", contribution_amount: "",
    registration_charge: "", withdrawal_fee_percent: 5, notes: "",
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (autoOpen && canDo(plan, "aso")) {
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, onAutoOpened, plan]);

  const lgas     = getLGAs(f.state);
  const totalBal = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const totalSaved = asoClients.reduce((s, c) => s + c.total_saved, 0);

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
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">Aso Savings</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-violet-600 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Summary hero */}
      <div className="rounded-3xl px-6 py-5 mb-5 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(135deg,#7c3aed 0%,#5b21b6 55%,#4c1d95 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Total Balance</p>
          <p className="text-3xl font-black tabular mb-4">{fmt(totalBal)}</p>
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Clients</p>
              <p className="text-base font-bold">{asoClients.length}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Total Saved</p>
              <p className="text-base font-bold tabular">{fmt(totalSaved)}</p>
            </div>
          </div>
        </div>
      </div>

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
      ) : (
        <div className="space-y-3">
          {asoClients.map(c => (
            <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/60">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="font-bold text-slate-800 dark:text-slate-100">{c.full_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {c.phone} · {c.contribution_frequency} · {fmt(c.contribution_amount)}
                  </p>
                </div>
                <Badge status={c.status} />
              </div>

              <div className="flex gap-2 mb-3">
                {[
                  { label: "Balance",   value: c.current_balance, color: "text-violet-700 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
                  { label: "Saved",     value: c.total_saved,     color: "text-green-700 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20"  },
                  { label: "Withdrawn", value: c.total_withdrawn,  color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-900/20"      },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`flex-1 ${bg} rounded-xl p-2.5`}>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                    <p className={`text-sm font-extrabold tabular ${color}`}>{fmt(value)}</p>
                  </div>
                ))}
              </div>

              {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

              <div className="flex gap-1.5 pt-2.5 border-t border-slate-50 dark:border-slate-700/60 flex-wrap">
                <button onClick={() => { setSelected(c); setAction("contribute"); }}
                  className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 active:scale-95 transition min-w-[80px]">
                  + Contribute
                </button>
                <button onClick={() => { setSelected(c); setAction("withdraw"); }}
                  className="flex-1 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-xs border border-red-200 dark:border-red-800 active:scale-95 transition min-w-[70px]">
                  Withdraw
                </button>
                <button onClick={() => setClientProf(c)}
                  className="py-2 px-2.5 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 active:scale-95 transition flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                  </svg>
                  Profile
                </button>
                <button
                  onClick={() => setReceipt(c)}
                  className="py-2 px-2.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-xl font-bold text-xs border border-violet-200 dark:border-violet-800 active:scale-95 transition flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8" />
                  </svg>
                  Statement
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add client modal */}
      {showAdd && (
        <Modal title="Add Aso Client" onClose={() => setShowAdd(false)}>
          <Field label="Full Name / Group Name" value={f.full_name}
            onChange={e => set("full_name", e.target.value)} placeholder="e.g. Mama Ngozi Cooperative" />
          <Field label="Phone" type="tel" value={f.phone}
            onChange={e => set("phone", e.target.value)} placeholder="0801 234 5678" />
          <Field label="Address (optional)" value={f.address}
            onChange={e => set("address", e.target.value)} placeholder="Optional" />

          <div className="grid grid-cols-2 gap-2">
            <Field label="State" as="select" value={f.state}
              onChange={e => { set("state", e.target.value); set("lga", ""); }}>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Field>
            <Field label="LGA" as="select" value={f.lga}
              onChange={e => set("lga", e.target.value)}>
              <option value="">— Select LGA —</option>
              {lgas.map(l => <option key={l} value={l}>{l}</option>)}
            </Field>
          </div>

          <Field label="Contribution Frequency" as="select" value={f.contribution_frequency}
            onChange={e => set("contribution_frequency", e.target.value)}>
            {["daily","weekly","monthly"].map(o => <option key={o} value={o}>{o}</option>)}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Contribution (₦)" type="number" value={f.contribution_amount}
              onChange={e => set("contribution_amount", e.target.value)} placeholder="0.00" />
            <Field label="Reg. Fee (₦)" type="number" value={f.registration_charge}
              onChange={e => set("registration_charge", e.target.value)} placeholder="0.00" />
          </div>

          <Field label="Withdrawal Fee %" type="number" value={f.withdrawal_fee_percent}
            onChange={e => set("withdrawal_fee_percent", parseFloat(e.target.value))} />
          <Field label="Notes (optional)" as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes…" />

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
            className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm">
            Add Client
          </button>
        </Modal>
      )}

      {/* Contribute / Withdraw modal */}
      {selected && action && (
        <Modal
          title={`${action === "contribute" ? "Record Contribution" : "Process Withdrawal"} — ${selected.full_name}`}
          onClose={() => { setSelected(null); setAction(null); setAmt(""); }}>
          <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl px-4 py-3 mb-4 border border-violet-100 dark:border-violet-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Current balance</p>
            <p className="text-xl font-black text-violet-700 dark:text-violet-400 tabular">{fmt(selected.current_balance)}</p>
          </div>
          {action === "withdraw" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2">
              ⚠ Withdrawal fee: {selected.withdrawal_fee_percent}% will be deducted
            </p>
          )}
          <Field label="Amount (₦)" type="number" inputMode="decimal" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder="Enter amount" />
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

      {receipt && (
        <AsoReceipt
          client={receipt}
          profile={profile}
          onClose={() => setReceipt(null)}
        />
      )}

      {clientProf && (
        <ClientProfile
          record={clientProf}
          type="aso"
          onSave={updateAsoClient}
          onClose={() => setClientProf(null)}
        />
      )}
    </div>
  );
}
