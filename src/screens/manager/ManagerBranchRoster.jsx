import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { fmt, today } from "../../utils/helpers";
import { Svg, P } from "./ManagerShared";

function Skeleton({ className }) {
  return <div className={`bg-slate-100 dark:bg-slate-700/60 animate-pulse rounded-xl ${className}`} />;
}

// Loads branch staff + today's activity counts, ranked by sales volume.
export default function ManagerBranchRoster({ staff, store, onBack }) {
  const ownerId   = staff?.owner_id;
  const branchId  = staff?.branch_id;
  const todayStr  = today();

  const [members,   setMembers]   = useState([]);
  const [activity,  setActivity]  = useState({});
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState("roster"); // "roster" | "leaderboard" | "collections"

  const load = useCallback(async () => {
    if (!ownerId || !branchId) { setLoading(false); return; }
    setLoading(true);

    const [staffRes, txRes] = await Promise.all([
      // Scope: only staff on this branch under the same owner
      supabase.from("staff")
        .select("id, full_name, email, role, profile_image_url, status")
        .eq("owner_id", ownerId)
        .eq("branch_id", branchId)
        .order("full_name"),
      // Today's branch transactions — branch_id filter is the scope gate
      supabase.from("transactions")
        .select("staff_id, type, amount")
        .eq("user_id", ownerId)
        .eq("branch_id", branchId)
        .eq("transaction_date", todayStr),
    ]);

    const memberList = staffRes.data || [];
    setMembers(memberList);

    // Build per-staff activity map
    const map = {};
    for (const tx of txRes.data || []) {
      if (!tx.staff_id) continue;
      if (!map[tx.staff_id]) map[tx.staff_id] = { in: 0, out: 0, count: 0 };
      map[tx.staff_id].count++;
      if (tx.type === "in")  map[tx.staff_id].in  += tx.amount;
      if (tx.type === "out") map[tx.staff_id].out += tx.amount;
    }
    setActivity(map);
    setLoading(false);
  }, [ownerId, branchId, todayStr]);

  useEffect(() => { load(); }, [load]);

  // Collection oversight — aso_clients with outstanding balance on this branch
  const collections = (store.asoClients || [])
    .filter(c => (c.current_balance || 0) > 0 || (c.outstanding || 0) > 0)
    .sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0));

  // Leaderboard — members sorted by today's cash-in
  const ranked = [...members].sort((a, b) => (activity[b.id]?.in || 0) - (activity[a.id]?.in || 0));

  const avatarFor = (m) => (
    <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {m.profile_image_url
        ? <img src={m.profile_image_url} alt="" className="w-10 h-10 object-cover" />
        : <span className="text-sm font-black text-white">{(m.full_name || "?")[0].toUpperCase()}</span>}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900"
        style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
          <Svg d={P.back} size={18} color="#64748b" />
        </button>
        <div className="flex-1">
          <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">My Branch</p>
          <p className="text-[11px] text-slate-400">{members.length} staff · today {todayStr}</p>
        </div>
        <button onClick={load} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
          <Svg d="M1 4v6h6|M23 20v-6h-6|M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" size={16} color="#64748b" />
        </button>
      </div>

      {/* View switcher */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 px-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 flex gap-1">
          {[["roster","Roster"],["leaderboard","Leaderboard"],["collections","Collections"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                view === v ? "bg-white dark:bg-slate-700 shadow-sm text-brand-600 dark:text-white" : "text-slate-500 dark:text-slate-400"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-6 space-y-3">
        {/* ── Roster view ── */}
        {view === "roster" && (
          loading
            ? [1,2,3].map(i => <Skeleton key={i} className="h-20" />)
            : members.length === 0
              ? <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Svg d={P.person} size={28} color="#cbd5e1" />
                  <p className="text-sm font-semibold text-slate-400">No staff on this branch</p>
                </div>
              : members.map(m => {
                  const act = activity[m.id] || { in: 0, out: 0, count: 0 };
                  const isActive = act.count > 0;
                  return (
                    <div key={m.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-card p-4">
                      <div className="flex items-center gap-3">
                        {avatarFor(m)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{m.full_name}</p>
                            <span className={`flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full ${isActive ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" : "bg-slate-100 dark:bg-slate-700 text-slate-400"}`}>
                              {isActive ? "ACTIVE" : "IDLE"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 capitalize">{m.role}</p>
                        </div>
                      </div>
                      {isActive && (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {[["Txns", act.count, "text-slate-700 dark:text-slate-200"],["Cash In", fmt(act.in), "text-green-600"],["Cash Out", fmt(act.out), "text-red-500"]].map(([l, v, c]) => (
                            <div key={l} className="bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2 text-center">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{l}</p>
                              <p className={`text-xs font-extrabold tabular mt-0.5 ${c}`}>{v}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
        )}

        {/* ── Leaderboard view ── */}
        {view === "leaderboard" && (
          loading
            ? [1,2,3].map(i => <Skeleton key={i} className="h-16" />)
            : ranked.length === 0
              ? <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <p className="text-sm font-semibold text-slate-400">No activity today yet</p>
                </div>
              : ranked.map((m, idx) => {
                  const act = activity[m.id] || { in: 0, count: 0 };
                  return (
                    <div key={m.id} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-card px-4 py-3 flex items-center gap-3 ${idx === 0 ? "border-amber-200 dark:border-amber-700/40" : "border-slate-100 dark:border-slate-700/50"}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${idx === 0 ? "bg-amber-400 text-white" : idx === 1 ? "bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200" : idx === 2 ? "bg-orange-300 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-400"}`}>
                        {idx + 1}
                      </div>
                      {avatarFor(m)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{m.full_name}</p>
                        <p className="text-[11px] text-slate-400">{act.count} txn{act.count !== 1 ? "s" : ""}</p>
                      </div>
                      <p className="text-sm font-extrabold text-green-600 tabular flex-shrink-0">{fmt(act.in)}</p>
                    </div>
                  );
                })
        )}

        {/* ── Collections oversight ── */}
        {view === "collections" && (
          collections.length === 0
            ? <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Svg d={P.check} size={28} color="#10b981" />
                <p className="text-sm font-semibold text-slate-400">All collections up to date</p>
              </div>
            : collections.map(c => (
                <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{c.full_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{c.group_name || "Individual"}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-extrabold text-blue-600 tabular">{fmt(c.current_balance || 0)}</p>
                      {(c.outstanding || 0) > 0 && (
                        <p className="text-[10px] font-bold text-amber-500 tabular">₦{fmt(c.outstanding)} credit</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
        )}
      </div>
    </div>
  );
}
