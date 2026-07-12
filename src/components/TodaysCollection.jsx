import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../utils/supabase";
import TransactionPinModal from "./TransactionPinModal";

const AMBER_DAYS = 3;
const RED_DAYS   = 7;

const fmtCur = (n) => "₦" + Number(n || 0).toLocaleString();
const todayISO = () => new Date().toISOString().split("T")[0];

function OverduePill({ days }) {
  if (days === 0) return <span className="text-[10px] font-bold text-green-600 dark:text-green-400">Due today</span>;
  const red = days >= RED_DAYS;
  return (
    <span className={`text-[10px] font-bold ${red ? "text-red-500 dark:text-red-400" : "text-amber-500 dark:text-amber-400"}`}>
      {days} day{days !== 1 ? "s" : ""} overdue
    </span>
  );
}

export default function TodaysCollection({ clients, groups, onRecord, staffCanRecord }) {
  const [todayContribs, setTodayContribs] = useState([]);
  const [selected,      setSelected]       = useState(new Set());
  const [batchMode,     setBatchMode]       = useState(false);
  const [customAmounts, setCustomAmounts]   = useState({});
  const [adjustFor,     setAdjustFor]       = useState(null); // {client, defaultAmount}
  const [adjustAmt,     setAdjustAmt]       = useState("");
  const [pinFor,        setPinFor]          = useState(null); // {mode:'single'|'batch', client?, items?}
  const [recording,     setRecording]       = useState(new Set());
  const [batchResults,  setBatchResults]    = useState(null);
  const [singleErr,     setSingleErr]       = useState({}); // {clientId: errMsg}

  const loadToday = useCallback(async () => {
    const start = `${todayISO()}T00:00:00`;
    const { data } = await supabase
      .from("ajo_contributions")
      .select("aso_client_id, amount, status, type")
      .gte("created_at", start)
      .eq("type", "contribution");
    setTodayContribs(data || []);
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  const today = todayISO();

  // All active clients with a due/overdue date
  const dueClients = useMemo(() =>
    clients
      .filter(c => c.status === "active" && c.next_contribution_date && c.next_contribution_date <= today)
      .map(c => {
        const days = Math.max(0, Math.floor((new Date(today) - new Date(c.next_contribution_date)) / 86400000));
        return { ...c, daysOverdue: days };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
  , [clients, today]);

  // Map: clientId → {hasCompleted, hasPending, total}
  const collectedMap = useMemo(() => {
    const m = {};
    for (const ct of todayContribs) {
      if (!m[ct.aso_client_id]) m[ct.aso_client_id] = { hasCompleted: false, hasPending: false, total: 0 };
      m[ct.aso_client_id].total += ct.amount || 0;
      if (ct.status === "completed") m[ct.aso_client_id].hasCompleted = true;
      if (ct.status === "pending")   m[ct.aso_client_id].hasPending   = true;
    }
    return m;
  }, [todayContribs]);

  // Running total from today's completed contributions
  const runningTotal = useMemo(() =>
    todayContribs.filter(ct => ct.status === "completed").reduce((s, ct) => s + (ct.amount || 0), 0)
  , [todayContribs]);

  // Group due clients by ajo_group_id
  const grouped = useMemo(() => {
    const m = {};
    for (const c of dueClients) {
      const key = c.ajo_group_id || "__personal__";
      if (!m[key]) m[key] = [];
      m[key].push(c);
    }
    return m;
  }, [dueClients]);

  const groupLabel = (groupId) => {
    if (groupId === "__personal__") return "Personal Savings";
    const g = groups?.find(x => x.id === groupId);
    return g?.name || "Group";
  };

  const getContext = (client) => {
    if (!client.ajo_group_id) return "personal_savings";
    const g = groups?.find(x => x.id === client.ajo_group_id);
    return g?.group_mode === "esusu" ? "esusu_rotation" : "group_savings";
  };

  const effectiveAmount = (client) => customAmounts[client.id] || client.contribution_amount || 0;

  // Batch total
  const batchTotal = useMemo(() =>
    [...selected].reduce((sum, id) => {
      const c = dueClients.find(x => x.id === id);
      return sum + (c ? (customAmounts[id] || c.contribution_amount || 0) : 0);
    }, 0)
  , [selected, dueClients, customAmounts]);

  // Toggle individual in batch
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () =>
    setSelected(selected.size === dueClients.length ? new Set() : new Set(dueClients.map(c => c.id)));

  // Trigger single record
  const handleRecord = (client) => {
    const amt = effectiveAmount(client);
    if (!amt) return;
    setSingleErr(p => { const n = { ...p }; delete n[client.id]; return n; });
    setPinFor({ mode: "single", client, amount: amt });
  };

  // Trigger batch record
  const handleBatchRecord = () => {
    const items = dueClients
      .filter(c => selected.has(c.id))
      .map(c => ({ client: c, amount: effectiveAmount(c), context: getContext(c) }));
    if (!items.length) return;
    setPinFor({ mode: "batch", items });
  };

  // PIN confirmed
  const handlePin = async (pin) => {
    if (!pinFor) return;

    if (pinFor.mode === "single") {
      const { client, amount } = pinFor;
      setPinFor(null);
      setRecording(prev => new Set(prev).add(client.id));
      const result = await onRecord(client.id, amount, getContext(client), pin);
      setRecording(prev => { const s = new Set(prev); s.delete(client.id); return s; });
      if (result?.error) {
        setSingleErr(p => ({ ...p, [client.id]: result.error }));
      } else {
        await loadToday();
      }
      return;
    }

    if (pinFor.mode === "batch") {
      const { items } = pinFor;
      setPinFor(null);
      setBatchResults([]);
      const results = [];
      for (const item of items) {
        setRecording(prev => new Set(prev).add(item.client.id));
        const result = await onRecord(item.client.id, item.amount, item.context, pin);
        setRecording(prev => { const s = new Set(prev); s.delete(item.client.id); return s; });
        results.push({ client: item.client, amount: item.amount, ok: !result?.error, error: result?.error, recovered: result?.data?.recovered === true });
      }
      setBatchResults(results);
      setSelected(new Set());
      setBatchMode(false);
      await loadToday();
    }
  };

  if (dueClients.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <p className="text-slate-700 dark:text-slate-200 font-bold">All caught up!</p>
        <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">No collections due today</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">

      {/* Summary bar */}
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 rounded-2xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-violet-500 dark:text-violet-400 uppercase tracking-widest mb-0.5">
            Today's Running Total
          </p>
          <p className="text-2xl font-black text-violet-700 dark:text-violet-300 tabular">{fmtCur(runningTotal)}</p>
          <p className="text-[10px] text-violet-400/80 dark:text-violet-400/60 mt-0.5">
            {dueClients.length} client{dueClients.length !== 1 ? "s" : ""} due
            {dueClients.filter(c => c.daysOverdue >= RED_DAYS).length > 0 &&
              <span className="ml-1.5 text-red-400">· {dueClients.filter(c => c.daysOverdue >= RED_DAYS).length} critical</span>
            }
          </p>
        </div>
        <button
          onClick={() => { setBatchMode(v => !v); if (batchMode) { setSelected(new Set()); } }}
          className={`px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 ${
            batchMode
              ? "bg-violet-600 text-white shadow-sm"
              : "bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700"
          }`}>
          {batchMode ? "Cancel" : "Batch"}
        </button>
      </div>

      {/* Batch controls */}
      {batchMode && (
        <div className="flex items-center justify-between">
          <button onClick={toggleAll}
            className="text-xs font-bold text-violet-600 dark:text-violet-400 active:opacity-70">
            {selected.size === dueClients.length ? "Deselect All" : "Select All"}
            {selected.size > 0 && <span className="ml-1 text-slate-400 font-normal">({selected.size})</span>}
          </button>
          {selected.size > 0 && (
            <button
              onClick={handleBatchRecord}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Record {selected.size} — {fmtCur(batchTotal)}
            </button>
          )}
        </div>
      )}

      {/* Batch results */}
      {batchResults && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Batch Results</p>
            <button onClick={() => setBatchResults(null)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2">
              Dismiss
            </button>
          </div>
          {batchResults.map((r, i) => (
            <div key={i}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${
                r.ok ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"
              }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                r.ok ? "bg-green-500" : "bg-red-500"
              }`}>
                {r.ok
                  ? <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                  : <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                }
              </span>
              <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                {r.client.full_name}
              </span>
              {r.ok ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[11px] font-bold text-green-700 dark:text-green-400">{fmtCur(r.amount)}</span>
                  {r.recovered && (
                    <span className="text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                      recovered
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[11px] font-bold text-red-600 dark:text-red-400 text-right max-w-[140px]">{r.error}</span>
              )}
            </div>
          ))}
          <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700 flex items-center gap-3">
            <span className="text-[11px] font-bold text-green-600 dark:text-green-400">
              {batchResults.filter(r => r.ok).length} succeeded
            </span>
            {batchResults.some(r => !r.ok) && (
              <span className="text-[11px] font-bold text-red-500 dark:text-red-400">
                {batchResults.filter(r => !r.ok).length} failed
              </span>
            )}
            <span className="ml-auto text-[11px] text-slate-400">
              Total collected: {fmtCur(batchResults.filter(r => r.ok).reduce((s, r) => s + r.amount, 0))}
            </span>
          </div>
        </div>
      )}

      {/* Groups */}
      {Object.entries(grouped).map(([groupId, groupClients]) => (
        <div key={groupId} className="space-y-2">
          {/* Group header */}
          <div className="flex items-center gap-2 px-1">
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {groupLabel(groupId)}
            </p>
            <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600">
              {groupClients.length}
            </span>
          </div>

          {groupClients.map(client => {
            const amt       = effectiveAmount(client);
            const inFlight  = recording.has(client.id);
            const isSelected = selected.has(client.id);
            const collected  = collectedMap[client.id];
            const days       = client.daysOverdue;
            const critical   = days >= RED_DAYS;
            const warn       = days >= AMBER_DAYS;
            const errMsg     = singleErr[client.id];

            return (
              <div key={client.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border transition-all ${
                  isSelected
                    ? "border-violet-400 dark:border-violet-600 ring-1 ring-violet-400/30"
                    : critical
                    ? "border-red-200 dark:border-red-800/50"
                    : warn
                    ? "border-amber-200 dark:border-amber-800/40"
                    : "border-slate-100 dark:border-slate-700/60"
                }`}>

                <div className="flex items-center gap-3">
                  {/* Batch checkbox */}
                  {batchMode && (
                    <button
                      onClick={() => toggleSelect(client.id)}
                      className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                        isSelected
                          ? "bg-violet-600 border-violet-600"
                          : "border-slate-300 dark:border-slate-600"
                      }`}>
                      {isSelected && (
                        <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </button>
                  )}

                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
                    {client.profile_image_url
                      ? <img src={client.profile_image_url} alt={client.full_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white font-black text-sm">
                          {(client.full_name || "?")[0].toUpperCase()}
                        </div>
                    }
                  </div>

                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{client.full_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <OverduePill days={days} />
                      {collected?.hasCompleted && (
                        <span className="text-[9px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                          ✓ Collected
                        </span>
                      )}
                      {collected?.hasPending && !collected?.hasCompleted && (
                        <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                          Pending
                        </span>
                      )}
                    </div>
                    {errMsg && (
                      <p className="text-[10px] font-semibold text-red-500 dark:text-red-400 mt-0.5">{errMsg}</p>
                    )}
                  </div>

                  {/* Amount + edit + record */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100 tabular">{fmtCur(amt)}</p>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 capitalize">{client.contribution_frequency}</p>
                    </div>
                    {/* Edit amount */}
                    <button
                      onClick={() => { setAdjustFor({ client, defaultAmount: amt }); setAdjustAmt(String(amt)); }}
                      className="w-7 h-7 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center active:scale-95 transition-transform">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {/* Record button (hidden in batch mode) */}
                    {!batchMode && (
                      <button
                        onClick={() => handleRecord(client)}
                        disabled={inFlight || !staffCanRecord}
                        className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${
                          inFlight || !staffCanRecord
                            ? "bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
                            : "bg-violet-600 text-white shadow-sm"
                        }`}>
                        {inFlight ? "…" : "Record"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Adjust amount sheet */}
      {adjustFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setAdjustFor(null); }}>
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl w-full max-w-lg px-6 pt-6 pb-10 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                Adjust Amount — {adjustFor.client.full_name}
              </p>
              <button onClick={() => setAdjustFor(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Default: {fmtCur(adjustFor.defaultAmount)} / {adjustFor.client.contribution_frequency}
            </p>
            <input
              type="number"
              inputMode="numeric"
              value={adjustAmt}
              autoFocus
              onChange={e => setAdjustAmt(e.target.value)}
              placeholder="Enter amount"
              className="w-full text-2xl font-black text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-400/60"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setAdjustFor(null)}
                className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  const v = parseFloat(adjustAmt);
                  if (v > 0) setCustomAmounts(p => ({ ...p, [adjustFor.client.id]: v }));
                  setAdjustFor(null);
                }}
                className="flex-1 py-3 bg-violet-600 text-white font-bold rounded-xl text-sm shadow-sm active:scale-95 transition-transform">
                Set Amount
              </button>
            </div>
          </div>
        </div>
      )}

      <TransactionPinModal
        isOpen={!!pinFor}
        onApprove={handlePin}
        onClose={() => setPinFor(null)}
        title={
          pinFor?.mode === "batch"
            ? `Record ${pinFor?.items?.length} contribution${pinFor?.items?.length !== 1 ? "s" : ""}`
            : "Record contribution"
        }
      />
    </div>
  );
}
