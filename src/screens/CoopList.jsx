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
  { value: "cooperative",              label: "Cooperative",           icon: "🤝" },
  { value: "market_association",       label: "Market Association",    icon: "🏪" },
  { value: "church",                   label: "Church",                icon: "⛪" },
  { value: "ngo",                      label: "NGO",                   icon: "🌍" },
  { value: "youth_group",              label: "Youth Group",           icon: "👥" },
  { value: "savings_group",            label: "Savings Group",         icon: "💰" },
  { value: "community_group",          label: "Community Group",       icon: "🏘️" },
  { value: "professional_association", label: "Professional Assoc.",   icon: "💼" },
  { value: "savings_club",             label: "Savings Club",          icon: "🏦" },
];

const fmt = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });

// ── Registration Modal ─────────────────────────────────────────────────────────
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

  const inp = "w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition placeholder:text-slate-300 dark:placeholder:text-slate-600";

  const selectedType = ORG_TYPES.find(t => t.value === type);

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-950 rounded-t-3xl overflow-y-auto"
        style={{ maxHeight: "92dvh" }} onClick={e => e.stopPropagation()}>
        {/* Handle + header */}
        <div className="px-5 pt-4 pb-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-950 z-10">
          <div className="w-8 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-500 dark:text-slate-400">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h3 className="font-black text-slate-900 dark:text-white text-base">Register Organisation</h3>
            {/* Step dots */}
            <div className="flex gap-1.5">
              {[1, 2, 3].map(s => (
                <div key={s} className={`w-5 h-1 rounded-full transition-colors ${s <= step ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-2">
            {step === 1 && "Choose organisation type"}
            {step === 2 && "Basic information"}
            {step === 3 && "Profile details (optional)"}
          </p>
        </div>

        <div className="px-5 py-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl px-4 py-3 mb-4 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {ORG_TYPES.map(t => (
                  <button key={t.value} onClick={() => setType(t.value)}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border-2 text-left transition ${type === t.value ? "border-brand-500 bg-brand-500/5 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"}`}>
                    <span className="text-xl flex-shrink-0">{t.icon}</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { if (!type) { setError("Please select a type"); return; } setError(""); setStep(2); }}
                className="w-full py-3.5 rounded-full font-extrabold text-sm text-white transition bg-brand-500">
                Continue →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 mb-5">
                <span className="text-2xl">{selectedType?.icon}</span>
                <span className="text-sm font-bold text-brand-500">{selectedType?.label}</span>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Organisation Name *</label>
                  <input className={inp} value={form.name} onChange={set("name")} placeholder="e.g. Okota Community Cooperative" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Description</label>
                  <textarea className={inp} rows={2} value={form.description} onChange={set("description")} placeholder="Brief description…" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Phone</label>
                    <input className={inp} value={form.phone} onChange={set("phone")} placeholder="08012345678" type="tel" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Email</label>
                    <input className={inp} value={form.email} onChange={set("email")} placeholder="org@email.com" type="email" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Address</label>
                  <input className={inp} value={form.address} onChange={set("address")} placeholder="Street address" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">State</label>
                    <input className={inp} value={form.state_name} onChange={set("state_name")} placeholder="Lagos" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">LGA</label>
                    <input className={inp} value={form.lga} onChange={set("lga")} placeholder="Oshodi-Isolo" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(1)}
                  className="flex-1 py-3.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-full font-bold text-sm">
                  ← Back
                </button>
                <button onClick={() => { if (!form.name.trim()) { setError("Organisation name is required"); return; } setError(""); setStep(3); }}
                  className="flex-1 py-3.5 text-white rounded-full font-extrabold text-sm bg-brand-500">
                  Continue →
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{selectedType?.icon}</span>
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{form.name}</span>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">All fields are optional — you can fill these in later from Settings.</p>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Purpose</label>
                  <textarea className={inp} rows={2} value={profile.purpose} onChange={setP("purpose")} placeholder="What does this organisation do?" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Vision Statement</label>
                  <input className={inp} value={profile.vision} onChange={setP("vision")} placeholder="Our vision is…" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Mission Statement</label>
                  <input className={inp} value={profile.mission} onChange={setP("mission")} placeholder="Our mission is…" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Date Established</label>
                  <input className={inp} type="date" value={profile.date_established} onChange={setP("date_established")} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Website</label>
                  <input className={inp} type="url" value={profile.website} onChange={setP("website")} placeholder="https://…" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[["Instagram","social_instagram","@handle"],["Facebook","social_facebook","Page"],["Twitter","social_twitter","@handle"]].map(([label,key,ph]) => (
                    <div key={key}>
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{label}</label>
                      <input className={inp} value={profile[key]} onChange={setP(key)} placeholder={ph} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(2)}
                  className="flex-1 py-3.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-full font-bold text-sm">
                  ← Back
                </button>
                <button onClick={handleCreate} disabled={loading}
                  className="flex-1 py-3.5 text-white rounded-full font-extrabold text-sm disabled:opacity-50 transition bg-brand-500">
                  {loading ? "Creating…" : "Create"}
                </button>
              </div>
            </>
          )}
          <div style={{ height: "env(safe-area-inset-bottom, 12px)" }} />
        </div>
      </div>
    </div>
  );
}

// ── Main CoopList ──────────────────────────────────────────────────────────────
export default function CoopList({ userId, onOpen, onClose, embedded }) {
  const [orgs,              setOrgs]              = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [showCreate,        setShowCreate]        = useState(false);
  const [showArchived,      setShowArchived]      = useState(false);
  const [reactivatingOrg,   setReactivatingOrg]   = useState(null); // org being reactivated
  const [reactivationReason, setReactivationReason] = useState("");
  const [reactivationBusy,  setReactivationBusy]  = useState(false);
  const [reactivationDone,  setReactivationDone]  = useState(null); // org_id
  const [reactivationError, setReactivationError] = useState("");

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    coopFn("get-orgs", { owner_id: userId })
      .then(r => setOrgs(r.orgs || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleRequestReactivation = async () => {
    if (!reactivatingOrg || !reactivationReason.trim()) {
      setReactivationError("Please provide a reason for reactivation.");
      return;
    }
    setReactivationBusy(true); setReactivationError("");
    try {
      const { data } = await supabase.functions.invoke("coop-portal", {
        body: { action: "request-org-reactivation", org_id: reactivatingOrg.id, reason: reactivationReason.trim() },
      });
      if (data?.ok) {
        setReactivationDone(reactivatingOrg.id);
        setReactivatingOrg(null);
        setReactivationReason("");
      } else {
        setReactivationError(data?.error || "Failed to submit request.");
      }
    } catch (e) { setReactivationError(e.message || "Failed"); }
    finally { setReactivationBusy(false); }
  };

  return (
    <div className={embedded ? "flex flex-col" : "fixed inset-0 z-[60] bg-white dark:bg-slate-950 flex justify-center"}>
      <div className={embedded ? "w-full flex flex-col" : "w-full max-w-md flex flex-col h-full"}>

        {/* ── Twitter-style sticky header ── */}
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 px-4 pb-3 flex items-center gap-3 min-h-[56px] flex-shrink-0" style={{ paddingTop: "max(14px, env(safe-area-inset-top, 14px))" }}>
          {!embedded && (
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-800 dark:text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-base font-black text-slate-900 dark:text-white leading-tight">Organisations</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-none">
              {orgs.length} organisation{orgs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full font-extrabold text-xs text-white transition active:scale-95 bg-brand-500">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-7 h-7 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-5 bg-gradient-to-br from-brand-500 to-emerald-900">
                🤝
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">No organisations yet</h3>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 leading-relaxed max-w-xs">
                Register a cooperative, church, market association, NGO, savings group or any organisation to get started.
              </p>
              <button onClick={() => setShowCreate(true)}
                className="px-8 py-3.5 rounded-full font-extrabold text-sm text-white active:scale-95 transition bg-brand-500">
                Register Organisation
              </button>
            </div>
          ) : (
            <div>
              {(showArchived ? orgs : orgs.filter(o => o.status !== "archived")).map((org, idx) => {
                const displayOrgs = showArchived ? orgs : orgs.filter(o => o.status !== "archived");
                const typeInfo = ORG_TYPES.find(t => t.value === org.type);
                return (
                  <button key={org.id} onClick={() => onOpen(org)}
                    className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors ${idx < displayOrgs.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""}`}>

                    {/* Avatar */}
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-2xl flex-shrink-0 shadow-sm bg-gradient-to-br from-brand-500 to-emerald-900">
                      {typeInfo?.icon || "🏢"}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate leading-tight">{org.name}</p>
                        {org.pending_archive && (
                          <span className="text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                            Archive pending
                          </span>
                        )}
                        {!org.pending_archive && org.status !== "active" && (
                          <span className="text-[9px] bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-bold px-1.5 py-0.5 rounded-full capitalize flex-shrink-0">
                            {org.status}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">{org.reg_number}</p>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border text-brand-500 border-brand-500 bg-brand-500/10">
                        {typeInfo?.label || org.type}
                      </span>
                    </div>

                    {/* Stats + chevron */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                      <p className="text-sm font-black text-slate-800 dark:text-white tabular">{fmt(org.wallet_balance)}</p>
                      <p className="text-[10px] text-slate-400">{org.member_count || 0} members</p>
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-300 dark:text-slate-600 mt-1" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </button>
                );
              })}
              {/* Per-org reactivation CTA for archived orgs */}
              {showArchived && orgs.filter(o => o.status === "archived").map(org => (
                <div key={`rct-${org.id}`} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-red-50/50 dark:bg-red-950/10">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{org.name}</span> is archived.
                    {reactivationDone === org.id
                      ? " Reactivation request submitted — the admin will review it."
                      : " Submit a request to the platform admin to restore it."}
                  </p>
                  {reactivationDone !== org.id && (
                    <button onClick={() => { setReactivatingOrg(org); setReactivationReason(""); setReactivationError(""); }}
                      className="text-[11px] font-bold text-white bg-green-600 px-3 py-1.5 rounded-lg">
                      Request Reactivation
                    </button>
                  )}
                </div>
              ))}
              {/* Archived toggle */}
              {orgs.some(o => o.status === "archived") && (
                <button onClick={() => setShowArchived(v => !v)}
                  className="w-full py-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
                  {showArchived
                    ? "Hide archived organisations"
                    : `Show ${orgs.filter(o => o.status === "archived").length} archived organisation${orgs.filter(o => o.status === "archived").length !== 1 ? "s" : ""}`}
                </button>
              )}
              {/* Bottom padding */}
              <div className="pb-24" />
            </div>
          )}
        </div>

        {/* ── Floating compose-style FAB ── */}
        {orgs.length > 0 && (
          <button
            onClick={() => setShowCreate(true)}
            className="fixed right-5 bottom-24 w-14 h-14 rounded-full shadow-xl flex items-center justify-center active:scale-95 transition z-20 bg-brand-500">
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="white" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {showCreate && (
        <RegisterModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={org => { setShowCreate(false); setOrgs(p => [org, ...p]); onOpen(org); }}
        />
      )}

      {/* ── Org reactivation request modal ── */}
      {reactivatingOrg && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center" onClick={() => setReactivatingOrg(null)}>
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Request Reactivation</p>
            <p className="text-xs text-slate-400 mb-4">Submit a request to the platform admin to restore <strong>{reactivatingOrg.name}</strong>.</p>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Reason</label>
            <textarea value={reactivationReason} onChange={e => setReactivationReason(e.target.value)} rows={3}
              placeholder="Explain why this organisation should be restored…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 mb-3 resize-none" />
            {reactivationError && <p className="text-red-500 text-xs mb-3">{reactivationError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setReactivatingOrg(null)}
                className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleRequestReactivation} disabled={reactivationBusy}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {reactivationBusy ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
