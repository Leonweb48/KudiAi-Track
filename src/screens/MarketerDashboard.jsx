import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { useTheme } from "../hooks/useTheme";

/* ── KudiAI Track logo mark (inline SVG) ────────────── */
function KudiLogoIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mdlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#mdlg)" />
      <line x1="10" y1="8.5" x2="10" y2="23.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="10.5" y1="15.5" x2="20.5" y2="8.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="10.5" y1="15.5" x2="20.5" y2="23.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="23" cy="9" r="2" fill="rgba(255,255,255,0.75)" />
    </svg>
  );
}

/* ── Sun icon ────────────────────────────────────────── */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

/* ── Moon icon ───────────────────────────────────────── */
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function StatCard({ label, value, color = "text-slate-800 dark:text-white", sub }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700">
      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-black tabular-nums truncate ${color}`} style={{ minWidth: 0 }}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MarketerDashboard({ marketer }) {
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState("clients");
  const { isDark, toggle }      = useTheme();

  useEffect(() => {
    if (!marketer?.id) return;
    supabase
      .from("brm_assignments")
      .select("id, client_id, assigned_at, is_current, brm_clients(id, full_name, email, phone, status, value_tier)")
      .eq("marketer_id", marketer.id)
      .eq("is_current", true)
      .order("assigned_at", { ascending: false })
      .then(({ data }) => { setClients(data || []); setLoading(false); });
  }, [marketer?.id]);

  const totalClients     = clients.length;
  const commissionEarned = marketer?.total_commission_earned || 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Brand top bar */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-12 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <KudiLogoIcon size={30} />
          <div>
            <p className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
              KudiAI <span className="font-light text-indigo-500">Track</span>
            </p>
            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium tracking-wide">Marketer Portal</p>
          </div>
        </div>
        <button
          onClick={toggle}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 transition-colors"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      {/* Profile header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {marketer.profile_image_url
              ? <img src={marketer.profile_image_url} className="w-10 h-10 rounded-xl object-cover" alt="" />
              : <KudiLogoIcon size={40} />}
            <div>
              <p className="font-bold text-slate-900 dark:text-white text-sm">{marketer.full_name}</p>
              <p className="text-[10px] text-slate-400">Marketer · {marketer.territory || "No territory"}</p>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="text-xs font-semibold text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 px-3 py-1.5 rounded-xl">
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <StatCard label="My Clients"      value={totalClients}                          color="text-indigo-600 dark:text-indigo-400" />
          <StatCard label="Commission Rate" value={`${marketer.commission_rate || 10}%`}  color="text-emerald-600 dark:text-emerald-400" />
          <StatCard label="Total Earned"    value={fmt(commissionEarned)}                 color="text-amber-600 dark:text-amber-400" />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5">
        <div className="flex gap-1">
          {[["clients","My Clients"],["profile","Profile"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === key ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-5 space-y-3">
        {tab === "clients" && (
          <>
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-7 h-7 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : clients.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400 dark:text-slate-500 text-sm">No clients assigned yet</p>
              </div>
            ) : clients.map(a => {
              const c = a.brm_clients;
              if (!c) return null;
              return (
                <div key={a.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white text-sm">{c.full_name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{c.email || c.phone || "—"}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.status === "active" ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" : "bg-slate-100 dark:bg-slate-700 text-slate-500"}`}>
                        {c.status || "active"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "profile" && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
            {[
              ["Full Name",  marketer.full_name],
              ["Email",      marketer.email],
              ["Phone",      marketer.phone],
              ["Territory",  marketer.territory],
              ["Commission", `${marketer.commission_rate || 10}%`],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-slate-400 dark:text-slate-500">{k}</span>
                <span className="text-xs font-semibold text-slate-900 dark:text-white text-right">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
