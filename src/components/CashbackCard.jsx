import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";

function fmt(n) { return "₦" + Number(n || 0).toLocaleString("en-NG"); }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }); }

export default function CashbackCard({ userEmail }) {
  const [balance,  setBalance]  = useState(0);
  const [history,  setHistory]  = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!userEmail) { setLoading(false); return; }
    supabase.from("cashback_transactions")
      .select("id,amount,type,bill_type,description,created_at")
      .eq("user_email", userEmail)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!data) return;
        const earned   = data.filter(r => r.type === "earned").reduce((s, r) => s + Number(r.amount), 0);
        const redeemed = data.filter(r => r.type === "redeemed").reduce((s, r) => s + Number(r.amount), 0);
        setBalance(Math.max(0, Math.floor(earned - redeemed)));
        setHistory(data);
      })
      .finally(() => setLoading(false));
  }, [userEmail]);

  if (!userEmail) return null;

  return (
    <div className="mx-4">
      <div
        className="rounded-2xl overflow-hidden border border-green-100 dark:border-green-900/40 shadow-sm cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-lg flex-shrink-0">🎁</div>
            <div>
              <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest leading-none">Cashback Balance</p>
              {loading
                ? <div className="h-6 w-24 bg-white/20 rounded animate-pulse mt-1" />
                : <p className="text-xl font-black leading-tight mt-0.5">{fmt(balance)}</p>
              }
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-green-200 font-semibold">1% on bills</p>
            <svg className={`w-4 h-4 text-white/70 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* History (expanded) */}
        {expanded && (
          <div className="bg-white dark:bg-slate-800">
            {history.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-slate-400 dark:text-slate-500 font-semibold">No cashback yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Earn 1% on every bill payment</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {history.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm
                      ${r.type === "earned" ? "bg-green-100 dark:bg-green-900/30" : "bg-slate-100 dark:bg-slate-700"}`}>
                      {r.type === "earned" ? "+" : "−"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {r.description || (r.type === "earned" ? "Cashback earned" : "Cashback used")}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate(r.created_at)}</p>
                    </div>
                    <span className={`text-sm font-extrabold flex-shrink-0 tabular-nums
                      ${r.type === "earned" ? "text-green-600 dark:text-green-400" : "text-slate-500 dark:text-slate-400"}`}>
                      {r.type === "earned" ? "+" : "−"}{fmt(r.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/30 border-t border-slate-100 dark:border-slate-700/50">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                Apply cashback at checkout when paying bills
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
