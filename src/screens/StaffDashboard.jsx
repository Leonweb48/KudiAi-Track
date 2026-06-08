import { useState, useEffect } from "react";
import { useStore }       from "../hooks/useStore";
import { supabase }       from "../utils/supabase";
import Transactions       from "./Transactions";
import Credit             from "./Credit";
import Aso                from "./Aso";
import Insights           from "./Insights";
import BillPayments       from "./BillPayments";
import VoiceModal         from "../components/VoiceModal";
import SyncBar            from "../components/SyncBar";
import Icon               from "../components/Icon";

const NAV_ICON = {
  overview:     "home",
  transactions: "txn",
  bills:        "bills",
  credit:       "credit",
  aso:          "aso",
  insights:     "insights",
  profile:      "user",
};

const NAV_LABEL = {
  overview:     "Home",
  transactions: "Sales",
  bills:        "Bills",
  credit:       "Credit",
  aso:          "Aso",
  insights:     "Reports",
  profile:      "Profile",
};

function Avatar({ url, name, size = "md" }) {
  const sz = size === "lg" ? "w-14 h-14 text-xl" : "w-9 h-9 text-sm";
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} className={`${sz} rounded-full object-cover`} />;
  return (
    <div className={`${sz} rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center`}>
      {initials}
    </div>
  );
}

function StaffProfile({ staff, ownerName, onSignOut }) {
  const roleLabel = (staff.role || "").replace(/_/g, " ");
  const initials  = (staff.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const fields = [
    { label: "Full Name",  value: staff.full_name },
    { label: "Email",      value: staff.email },
    { label: "Phone",      value: staff.phone },
    { label: "Role",       value: roleLabel, cap: true },
    { label: "Business",   value: ownerName },
    { label: "Status",     value: staff.status, cap: true },
    { label: "Member Since", value: staff.created_at ? new Date(staff.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : null },
  ].filter(f => f.value);

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      <div className="flex flex-col items-center py-6">
        <div className="w-20 h-20 rounded-full overflow-hidden mb-3 border-4 border-green-200 dark:border-green-800">
          {staff.profile_image_url
            ? <img src={staff.profile_image_url} alt={staff.full_name} className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-700 dark:text-green-300 font-black text-2xl">{initials}</div>
          }
        </div>
        <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">{staff.full_name}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 capitalize mt-0.5">{roleLabel}{ownerName ? ` · ${ownerName}` : ""}</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700">
        {fields.map(f => (
          <div key={f.label} className="flex items-start justify-between px-4 py-3 gap-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold shrink-0">{f.label}</p>
            <p className={`text-sm font-semibold text-slate-700 dark:text-slate-200 text-right ${f.cap ? "capitalize" : ""}`}>{f.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Module Access</p>
        <div className="flex flex-wrap gap-2">
          {(staff.staff_permissions || []).filter(p => p.can_view).map(p => (
            <span key={p.module} className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-3 py-1 rounded-full font-semibold capitalize">
              {p.module.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      <button onClick={onSignOut}
        className="w-full py-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-500 font-bold rounded-xl text-sm">
        Sign Out
      </button>
    </div>
  );
}

const MODULE_ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  bills: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 13h6M9 17h4" />
    </svg>
  ),
  transactions: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  credit: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  aso: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4"  />
      <line x1="6"  y1="20" x2="6"  y2="14" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

const MODULE_LABELS = {
  overview:     "Overview",
  transactions: "Transactions",
  bills:        "Bills",
  credit:       "Credit Sales",
  aso:          "Aso Savings",
  insights:     "Insights",
  profile:      "My Profile",
};

export default function StaffDashboard({ session, staff }) {
  const ownerId  = staff.owner_id;
  const staffId  = staff.id;
  const staffName = staff.full_name;

  // Staff uses owner's data scope
  const store = useStore(ownerId, staffId, staffName);

  // Compute allowed modules from staff_permissions
  const allowed = (staff.staff_permissions || []).filter(p => p.can_view).map(p => p.module);

  const [tab,       setTab]       = useState("overview");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [autoAdd,   setAutoAdd]   = useState(null);
  const [ownerName, setOwnerName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const isDark = store.profile?.dark_mode;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!isDark);
  }, [isDark]);

  useEffect(() => {
    supabase.from("profiles").select("business_name, full_name").eq("id", ownerId).maybeSingle()
      .then(({ data }) => { if (data) setOwnerName(data.business_name || data.full_name || ""); });
  }, [ownerId]);

  const handleSignOut = () => supabase.auth.signOut();

  const canCreate = (module) => (staff.staff_permissions || []).some(p => p.module === module && p.can_create);
  const mustChangePassword = Boolean(session?.user?.user_metadata?.must_change_password);

  const changePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setChangingPassword(true);
    const metadata = { ...(session.user.user_metadata || {}), must_change_password: false };
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: metadata,
    });
    if (error) setPasswordError(error.message);
    else window.location.reload();
    setChangingPassword(false);
  };

  if (staff.status !== "active") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-red-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Account Suspended</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Your manager has suspended this staff account. Contact them to restore access.
        </p>
        <button onClick={handleSignOut} className="bg-red-50 border border-red-200 text-red-500 font-semibold text-sm px-6 py-3 rounded-xl">
          Sign Out
        </button>
      </div>
    );
  }

  if (allowed.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-amber-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">No Modules Assigned</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Your account has no module access yet. Contact your manager to get permissions assigned.</p>
        <button onClick={handleSignOut} className="bg-red-50 border border-red-200 text-red-500 font-semibold text-sm px-6 py-3 rounded-xl">
          Sign Out
        </button>
      </div>
    );
  }

  const renderTab = () => {
    const noCreate = !canCreate(tab);
    if (tab === "overview") {
      const todayKey = new Date().toISOString().slice(0, 10);
      const todayTransactions = store.transactions.filter(t => t.transaction_date === todayKey);
      const moneyIn = todayTransactions
        .filter(t => t.type === "in")
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const moneyOut = todayTransactions
        .filter(t => t.type === "out")
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      return (
        <div className="p-4 pb-28 space-y-4">
          <div className="rounded-3xl bg-gradient-to-br from-green-600 to-emerald-700 text-white p-5 shadow-lg">
            <p className="text-xs text-green-100 font-semibold">Welcome back</p>
            <h2 className="text-xl font-extrabold mt-1">{staffName}</h2>
            <p className="text-xs text-green-100 mt-1 capitalize">
              {staff.role?.replace(/_/g, " ")}{ownerName ? ` at ${ownerName}` : ""}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Today", value: todayTransactions.length, color: "text-blue-600 bg-blue-50" },
              { label: "Money In", value: `N${moneyIn.toLocaleString()}`, color: "text-green-600 bg-green-50" },
              { label: "Money Out", value: `N${moneyOut.toLocaleString()}`, color: "text-red-600 bg-red-50" },
            ].map(item => (
              <div key={item.label} className={`${item.color} rounded-2xl p-3 min-w-0`}>
                <p className="text-[10px] font-bold opacity-70">{item.label}</p>
                <p className="text-sm font-extrabold mt-1 truncate">{item.value}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">Your Workspace</h3>
              <span className="text-[10px] font-semibold text-slate-400">{allowed.length} module{allowed.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {allowed.map(module => (
                <button key={module} onClick={() => setTab(module)}
                  className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-left shadow-sm">
                  <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-950/30 text-green-600 flex items-center justify-center mb-3">
                    {MODULE_ICONS[module]}
                  </div>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{MODULE_LABELS[module]}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {canCreate(module) ? "View and create" : "View only"}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    switch (tab) {
      case "transactions":
        return <Transactions store={store} plan="premium" autoOpen={autoAdd?.tab === "transactions"} autoType={autoAdd?.type} onAutoOpened={() => setAutoAdd(null)} onVoiceOpen={() => setVoiceOpen(true)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "bills":
        return <BillPayments store={store} staffName={staffName} businessName={store.profile?.business_name || ""} readOnly={noCreate} />;
      case "credit":
        return <Credit store={store} plan="premium" autoOpen={autoAdd?.tab === "credit"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "aso":
        return <Aso store={store} plan="premium" autoOpen={autoAdd?.tab === "aso"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "insights":
        return <Insights store={store} plan="premium" onUpgrade={() => {}} staffName={staffName} />;
      case "profile":
        return <StaffProfile staff={staff} ownerName={ownerName} onSignOut={handleSignOut} />;
      default:
        return null;
    }
  };

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center">
        <div className="w-full max-w-md relative flex flex-col h-screen">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} />

          {/* Staff Header */}
          <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pt-12 pb-3 flex items-center gap-3">
            <Avatar url={staff.profile_image_url} name={staffName} />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{staffName}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{ownerName && `${ownerName} · `}{staff.role?.replace(/_/g, " ")}</p>
            </div>
            <button onClick={handleSignOut}
              className="text-xs text-red-500 font-semibold px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40">
              Sign Out
            </button>
          </div>

          <main className="flex-1 overflow-y-auto">
            {renderTab()}
          </main>

          {/* Bottom Navigation */}
          <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
            <div className="flex items-stretch h-[60px]">
              {["overview", ...allowed, "profile"].map(m => {
                const isActive = tab === m;
                return (
                  <button key={m} onClick={() => setTab(m)}
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150 focus-visible:outline-none">
                    {isActive && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-green-600 dark:bg-green-400" />
                    )}
                    <div className={`transition-all duration-200 ${isActive ? "scale-110" : "scale-100"}`}>
                      <Icon name={NAV_ICON[m]} size={21}
                        className={isActive ? "text-green-600 dark:text-green-400" : "text-slate-400 dark:text-slate-500"} />
                    </div>
                    <span className={`text-[8px] font-bold uppercase tracking-wide leading-none transition-colors duration-150 ${
                      isActive ? "text-green-600 dark:text-green-400" : "text-slate-400 dark:text-slate-500"
                    }`}>
                      {NAV_LABEL[m]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
          </nav>

          {voiceOpen && canCreate("transactions") && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { store.addTransaction(txn); setVoiceOpen(false); }}
            />
          )}

          {store.dbError && (
            <div className="fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3 fade-in" role="alert">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Save failed</p>
                <p className="text-xs opacity-80 mt-0.5 break-words">{store.dbError}</p>
              </div>
              <button onClick={store.clearDbError} className="text-white/70 hover:text-white">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {mustChangePassword && (
            <div className="fixed inset-0 z-[80] bg-slate-950/70 flex items-center justify-center px-5">
              <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl">
                <div className="w-12 h-12 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Create Your Password</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">
                  Replace the temporary password your manager gave you before using the dashboard.
                </p>
                <div className="space-y-3">
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {passwordError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{passwordError}</p>
                  )}
                  <button onClick={changePassword} disabled={changingPassword}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3 text-sm">
                    {changingPassword ? "Updating..." : "Set Password & Continue"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
