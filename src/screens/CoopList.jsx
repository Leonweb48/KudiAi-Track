import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const coopFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("coop-portal", { body: { action, ...body } });
  if (r.error) {
    let msg = r.error.message;
    try {
      const errBody = r.data?.error
        ? r.data
        : (r.error.context ? await r.error.context.clone().json() : null);
      if (errBody?.error) msg = errBody.error;
    } catch { /* keep original msg */ }
    throw new Error(msg);
  }
  return r.data;
};

const ORG_TYPES = [
  { value: "cooperative",            label: "Cooperative",            icon: "🤝" },
  { value: "market_association",     label: "Market Association",     icon: "🏪" },
  { value: "church",                 label: "Church",                 icon: "⛪" },
  { value: "ngo",                    label: "NGO",                    icon: "🌍" },
  { value: "youth_group",            label: "Youth Group",            icon: "👥" },
  { value: "savings_group",          label: "Savings Group",          icon: "💰" },
  { value: "community_group",        label: "Community Group",        icon: "🏘️" },
  { value: "professional_association", label: "Professional Assoc.",  icon: "💼" },
  { value: "savings_club",           label: "Savings Club",           icon: "🏦" },
];

const TYPE_COLORS = {
  cooperative:        "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  market_association: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  church:             "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ngo:                "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  youth_group:        "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  savings_group:            "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  community_group:          "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  professional_association: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  savings_club:             "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

const fmt = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });

// ── Registration Modal ─────────────────────────────────────
function RegisterModal({ onClose, onCreated, userId }) {
  const [step,    setStep]    = useState(1);
  const [type,    setType]    = useState("");
  const [form,    setForm]    = useState({ name: "", description: "", address: "", state_name: "", lga: "", phone: "", email: "" });
  const [profile, setProfile] = useState({ purpose: "", vision: "", mission: "", website: "", social_instagram: "", social_facebook: "", social_twitter: "", date_established: "" });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const set  = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setP = k => e => setProfile(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async () => {
    setLoading(true); setError("");
    try {
      const { org } = await coopFn("create-org", { owner_id: userId, type, ...form, ...profile });
      onCreated(org);
    } catch (e) { setError(e.message || "Failed to create"); }
    finally { setLoading(false); }
  };

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  const selectedType = ORG_TYPES.find(t => t.value === type);

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white">Register Organisation</h3>
          <div className="flex gap-1">
            {[1, 2, 3].map(s => (
              <div key={s} className={`w-5 h-1.5 rounded-full transition-colors ${s <= step ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-600"}`} />
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-5">
          {step === 1 && "Step 1: Choose organisation type"}
          {step === 2 && "Step 2: Basic information"}
          {step === 3 && "Step 3: Profile details (optional)"}
        </p>

        {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600 dark:text-red-400">{error}</div>}

        {step === 1 && (
          <>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Select Organisation Type</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {ORG_TYPES.map(t => (
                <button key={t.value} onClick={() => setType(t.value)}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 text-left transition ${type === t.value ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20" : "border-slate-200 dark:border-slate-600"}`}>
                  <span className="text-xl flex-shrink-0">{t.icon}</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { if (!type) { setError("Please select a type"); return; } setError(""); setStep(2); }}
              className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm">Continue →</button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">{selectedType?.icon}</span>
              <span className="text-sm font-bold text-violet-600">{selectedType?.label}</span>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Organisation Name *</label>
                <input className={input} value={form.name} onChange={set("name")} placeholder="e.g. Okota Community Cooperative" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Description</label>
                <textarea className={input} rows={2} value={form.description} onChange={set("description")} placeholder="Brief description..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Phone</label>
                  <input className={input} value={form.phone} onChange={set("phone")} placeholder="08012345678" type="tel" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Email</label>
                  <input className={input} value={form.email} onChange={set("email")} placeholder="org@email.com" type="email" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Address</label>
                <input className={input} value={form.address} onChange={set("address")} placeholder="Street address" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">State</label>
                  <input className={input} value={form.state_name} onChange={set("state_name")} placeholder="Lagos" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">LGA</label>
                  <input className={input} value={form.lga} onChange={set("lga")} placeholder="Oshodi-Isolo" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setStep(1)} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">← Back</button>
              <button onClick={() => { if (!form.name.trim()) { setError("Organisation name is required"); return; } setError(""); setStep(3); }}
                className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm">Continue →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{selectedType?.icon}</span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{form.name}</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">All fields are optional — you can fill these in later from Settings.</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
                <textarea className={input} rows={2} value={profile.purpose} onChange={setP("purpose")} placeholder="What does this organisation do?" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vision Statement</label>
                <input className={input} value={profile.vision} onChange={setP("vision")} placeholder="Our vision is…" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Mission Statement</label>
                <input className={input} value={profile.mission} onChange={setP("mission")} placeholder="Our mission is…" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Established</label>
                <input className={input} type="date" value={profile.date_established} onChange={setP("date_established")} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Website</label>
                <input className={input} type="url" value={profile.website} onChange={setP("website")} placeholder="https://…" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["Instagram","social_instagram","@handle"],["Facebook","social_facebook","Page"],["Twitter","social_twitter","@handle"]].map(([label,key,ph]) => (
                  <div key={key}>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                    <input className={input} value={profile[key]} onChange={setP(key)} placeholder={ph} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setStep(2)} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">← Back</button>
              <button onClick={handleCreate} disabled={loading}
                className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {loading ? "Creating…" : "Create Organisation"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main CoopList ──────────────────────────────────────────
export default function CoopList({ userId, onOpen, onClose, embedded }) {
  const [orgs,       setOrgs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    coopFn("get-orgs", { owner_id: userId })
      .then(r => setOrgs(r.orgs || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className={embedded ? "flex flex-col" : "fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex justify-center"}>
      <div className={embedded ? "w-full flex flex-col" : "w-full max-w-md flex flex-col h-full"}>

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          {!embedded && (
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <div className="flex-1">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">My Organisations</p>
            <p className="text-[10px] text-slate-400">{orgs.length} organisation{orgs.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-xl text-xs font-bold">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-7 h-7 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center text-3xl mb-4">🤝</div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-2">No Organisations Yet</h3>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">Register a cooperative, church, market association, NGO, savings group, community group, or any other organisation to get started.</p>
              <button onClick={() => setShowCreate(true)}
                className="px-6 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm">Register Organisation</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {orgs.map(org => {
                const typeInfo = ORG_TYPES.find(t => t.value === org.type);
                return (
                  <button key={org.id} onClick={() => onOpen(org)}
                    className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm text-left w-full hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                        {typeInfo?.icon || "🏢"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org.name}</p>
                          {org.status !== "active" && (
                            <span className="text-[9px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full capitalize">{org.status}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono mb-1.5">{org.reg_number}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${TYPE_COLORS[org.type] || "bg-slate-100 text-slate-600"}`}>
                          {typeInfo?.label || org.type}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-extrabold text-slate-800 dark:text-white">{fmt(org.wallet_balance)}</p>
                        <p className="text-[10px] text-slate-400">wallet</p>
                        <p className="text-[10px] text-slate-500 mt-1">{org.member_count || 0} members</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                      <div className="text-center">
                        <p className="text-xs font-extrabold text-green-600">{fmt(org.total_savings)}</p>
                        <p className="text-[9px] text-slate-400">Total Savings</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-extrabold text-amber-600">{fmt(org.total_loans_out)}</p>
                        <p className="text-[9px] text-slate-400">Loans Out</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-extrabold text-violet-600">{org.member_count || 0}</p>
                        <p className="text-[9px] text-slate-400">Members</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <RegisterModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={org => { setShowCreate(false); setOrgs(p => [org, ...p]); onOpen(org); }}
        />
      )}
    </div>
  );
}
