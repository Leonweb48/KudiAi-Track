import { useState, useEffect } from "react";
import Modal           from "../components/shared/Modal";
import Field           from "../components/shared/Field";
import StaffManagement from "./StaffManagement";
import { supabase }    from "../utils/supabase";
import { canDo }       from "../utils/plans";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { LANGUAGES, getLangMeta } from "../utils/i18n";
import { useLanguage, useT } from "../contexts/LanguageContext";

/* ── PIN Setup Modal ──────────────────────────────────────────────── */
function PinSetupModal({ onDone, onClose }) {
  const [step, setStep]   = useState(1);
  const [pin1, setPin1]   = useState("");
  const [pin2, setPin2]   = useState("");
  const [error, setError] = useState("");

  const active    = step === 1 ? pin1 : pin2;
  const setActive = step === 1 ? setPin1 : setPin2;

  const handleDigit = (d) => {
    if (active.length >= 4) return;
    const next = active + d;
    setActive(next);
    setError("");
    if (next.length === 4) {
      if (step === 1) {
        setTimeout(() => setStep(2), 250);
      } else {
        if (pin1 === next) {
          onDone(pin1);
        } else {
          setError("PINs don't match. Try again.");
          setPin2("");
          setPin1("");
          setTimeout(() => setStep(1), 800);
        }
      }
    }
  };

  const handleDelete = () => {
    setActive(v => v.slice(0, -1));
    setError("");
  };

  return (
    <Modal title={step === 1 ? "Set App PIN" : "Confirm PIN"} onClose={onClose}>
      <div className="flex flex-col items-center gap-6 py-2">
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
          {step === 1
            ? "Choose a 4-digit PIN to protect your app"
            : "Enter your PIN again to confirm"}
        </p>

        {/* dots */}
        <div className="flex gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${
              active.length > i
                ? "bg-brand-500 border-brand-500 scale-110"
                : "border-slate-300 dark:border-slate-600"
            }`} />
          ))}
        </div>

        {error && <p className="text-xs text-red-500 font-semibold -mt-2">{error}</p>}

        {/* numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
              {n}
            </button>
          ))}
          <div />
          <button onClick={() => handleDigit("0")}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
            0
          </button>
          <button onClick={handleDelete}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
              <line x1="18" y1="9" x2="13" y2="14" />
              <line x1="13" y1="9" x2="18" y2="14" />
            </svg>
          </button>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-4">
          Your PIN is stored securely on this device only
        </p>
      </div>
    </Modal>
  );
}

const GENDERS = ["Male", "Female", "Prefer not to say"];

const INFO = {
  privacy: {
    title: "Privacy Policy",
    body:  "KudiAI Track collects only the data you enter. Your business data is stored securely in Supabase and is never shared with third parties. You can request data deletion at any time by contacting support.",
  },
  terms: {
    title: "Terms & Conditions",
    body:  "By using KudiAI Track you agree to use the app for lawful business purposes only. We are not liable for financial decisions made based on app data. Subscription fees are non-refundable after the billing period starts.",
  },
};

async function uploadProfileImg(file, userId) {
  const path = `${userId}/profile`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  const base = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return `${base}?v=${Date.now()}`;
}

/* ── Sub-components ───────────────────────────────────────────────── */

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">
      {children}
    </p>
  );
}

function SettingsCard({ children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card divide-y divide-slate-100 dark:divide-slate-700/80 mb-5">
      {children}
    </div>
  );
}

function Row({ icon, label, sub, onClick, right }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-[14px] text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors focus-visible:outline-none"
      aria-label={label}
    >
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] leading-snug text-slate-800 dark:text-slate-100">{label}</p>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right !== undefined ? right : (
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

/* ── Inline icon helpers ──────────────────────────────────────────── */
const ic = (d, extra = "") => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 text-slate-600 dark:text-slate-300 ${extra}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {d.split("|").map((seg, i) => <path key={i} d={seg} />)}
  </svg>
);

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1"     x2="12" y2="3"     />
    <line x1="12" y1="21"    x2="12" y2="23"    />
    <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64"  />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1"  y1="12"    x2="3"  y2="12"    />
    <line x1="21" y1="12"    x2="23" y2="12"    />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
  </svg>
);

const PersonIcon     = () => ic("M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8");
const CrownIcon      = () => ic("M2 4l3 12h14l3-12-6 5-4-7-4 7-6-5z|M5 16h14");
const UsersIcon      = ({ white } = {}) => white
  ? <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{["M17 20h5v-2a4 4 0 00-4-4h-1","M9 20H4v-2a4 4 0 014-4h1m4 6v-2m0-4a4 4 0 100-8 4 4 0 000 8z"].map((d,i)=><path key={i} d={d}/>)}</svg>
  : ic("M17 20h5v-2a4 4 0 00-4-4h-1|M9 20H4v-2a4 4 0 014-4h1m4 6v-2m0-4a4 4 0 100-8 4 4 0 000 8z");
const BellIcon       = () => ic("M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 01-3.46 0");
const LockIcon       = () => ic("M3 11h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V11z|M7 11V7a5 5 0 0110 0v4");
const ShieldIcon     = () => ic("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
const DocIcon        = () => ic("M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8");
const HelpIcon       = () => ic("M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z|M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01");
const GlobeIcon = () => ic("M12 2a10 10 0 100 20A10 10 0 0012 2z|M2 12h20|M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z");
const GiftIcon   = () => ic("M20 12v10H4V12|M22 7H2v5h20V7z|M12 22V7|M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z|M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z");
const BranchIcon = () => ic("M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10");
const CoopIcon   = () => ic("M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75|M9 7a4 4 0 100 8 4 4 0 000-8z");
const LogoutIconSvg  = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-red-500 dark:text-red-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

/* ── Language picker modal ────────────────────────────────────────── */
function LanguageModal({ current, onClose }) {
  const { changeLang } = useLanguage();
  return (
    <Modal title="Choose Language" onClose={onClose}>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        The AI Assistant will reply in the language you type — this sets the default.
      </p>
      <div className="space-y-2">
        {LANGUAGES.map(lang => (
          <button
            key={lang.code}
            onClick={() => { changeLang(lang.code); onClose(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors active:scale-[0.98] ${
              current === lang.code
                ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                : "border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            }`}
          >
            <span className="text-2xl leading-none flex-shrink-0">{lang.flag}</span>
            <div className="flex-1 text-left">
              <p className={`font-semibold text-sm ${current === lang.code ? "text-brand-700 dark:text-brand-400" : "text-slate-800 dark:text-slate-100"}`}>
                {lang.name}
              </p>
              {lang.native !== lang.name && (
                <p className="text-xs text-slate-400 dark:text-slate-500">{lang.native}</p>
              )}
            </div>
            {current === lang.code && (
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ── Support Ticket Modal ─────────────────────────────────────────── */
const SUPPORT_ADMIN_URL = "https://admin.kudiai.app";
const TICKET_TYPES = [
  { value: "account",      label: "Account / Login" },
  { value: "payment",      label: "Payment / Billing" },
  { value: "transaction",  label: "Transaction Issue" },
  { value: "subscription", label: "Subscription / Plans" },
  { value: "technical",    label: "Technical Problem" },
  { value: "ajo",          label: "Ajo / Savings Group" },
  { value: "general",      label: "General Enquiry" },
];

function SupportModal({ onClose, session, userType = "business" }) {
  const [form, setForm] = useState({
    subject: "", description: "", type: "general", priority: "medium",
    user_name: session?.business_name || session?.owner_name || session?.full_name || "",
    user_email: session?.email || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(null);
  const [error, setError]           = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.user_email.trim()) { setError("Subject and email are required."); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch(`${SUPPORT_ADMIN_URL}/api/public/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "business", submitter_type: userType }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Failed to submit ticket"); return; }
      setDone(d.ticket_no);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="Help & Support" onClose={onClose}>
      {done ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <div>
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">Ticket Submitted!</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your ticket number is <span className="font-bold text-indigo-600 dark:text-indigo-400">#{done}</span></p>
            <p className="text-xs text-slate-400 mt-2">A confirmation has been sent to {form.user_email}. Our team will respond shortly.</p>
          </div>
          <button onClick={onClose} className="mt-2 w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Your Name</label>
              <input className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" value={form.user_name} onChange={e => setForm(f => ({...f, user_name: e.target.value}))} placeholder="Your name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Email *</label>
              <input type="email" className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" value={form.user_email} onChange={e => setForm(f => ({...f, user_email: e.target.value}))} placeholder="your@email.com" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
              <select className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Priority</label>
              <select className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none" value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Subject *</label>
            <input className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Brief summary of your issue" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Description</label>
            <textarea className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none h-24" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Describe the problem in detail…" />
          </div>
          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 rounded-xl">⚠ {error}</p>}
          <button type="submit" disabled={submitting} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            {submitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </form>
      )}
    </Modal>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export default function Settings({ store, session, plan = "starter", onUpgrade, onStaffManagement, lock, onNotifications, onLoyalty, onBranches, onCoops }) {
  const { profile, setProfile } = store;
  const { lang: langCode }      = useLanguage();
  const t                       = useT();
  const [staffMgmt,     setStaffMgmt]     = useState(false);
  const [editProfile,   setEditProfile]   = useState(false);
  const [fp,            setFp]            = useState({ ...profile });
  const [photoFile,     setPhotoFile]     = useState(null);
  const [photoPreview,  setPhotoPreview]  = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState("");
  const [signingOut,    setSigningOut]    = useState(false);
  const [infoModal,     setInfoModal]     = useState(null);
  const [showPinSetup,  setShowPinSetup]  = useState(false);
  const [showSupport,   setShowSupport]   = useState(false);
  const [lockBusy,      setLockBusy]      = useState(false);
  const [showLangPick,  setShowLangPick]  = useState(false);

  const lockEnabled    = lock?.enabled    ?? false;
  const lockHasPIN     = lock?.hasPIN     ?? false;
  const lockHasBio     = lock?.hasBiometric ?? false;
  const lockBioAvail   = lock?.bioAvailable ?? false;

  useEffect(() => {
    if (!editProfile) setFp({ ...profile });
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const lgas  = getLGAs(fp.state  || "");
  const wards = getWards(fp.state || "", fp.lga || "");

  const openEdit = () => {
    setFp({ ...profile });
    setPhotoFile(null);
    setPhotoPreview(null);
    setSaveError("");
    setEditProfile(true);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleStateChange = (s) => setFp(p => ({ ...p, state: s, lga: "", ward: "" }));
  const handleLgaChange   = (l) => setFp(p => ({ ...p, lga: l, ward: "" }));

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveError("");
    let imageUrl = fp.profile_image_url;
    if (photoFile && session?.user?.id) {
      try {
        imageUrl = await uploadProfileImg(photoFile, session.user.id);
      } catch (err) {
        setSaveError(`Photo upload failed: ${err.message}`);
        setSaving(false);
        return;
      }
    }
    const { error } = await setProfile({ ...fp, profile_image_url: imageUrl });
    setSaving(false);
    if (error) { setSaveError(error.message || "Failed to save."); return; }
    setEditProfile(false);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase?.auth.signOut();
  };

  const toggleDark = () => setProfile(p => ({ ...p, dark_mode: !p.dark_mode }));

  const initials  = profile.owner_name?.[0]?.toUpperCase() || "A";
  const avatarSrc = photoPreview || profile.profile_image_url;

  const Toggle = (
    <button
      onClick={e => { e.stopPropagation(); toggleDark(); }}
      role="switch"
      aria-checked={!!profile.dark_mode}
      className={`w-12 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none flex-shrink-0 ${
        profile.dark_mode ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"
      }`}
    >
      <span
        className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: profile.dark_mode ? "calc(100% - 22px)" : "2px" }}
      />
    </button>
  );

  const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-slate-700 dark:text-slate-100 disabled:opacity-50";

  return (
    <div className="pb-32 screen-enter">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 mb-6">
        <h1 className="text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">{t("settings.title")}</h1>
      </div>
      <div className="px-4">

      {/* ── STAFF MANAGEMENT BANNER ────────────────────────────────── */}
      <button
        onClick={() => setStaffMgmt(true)}
        className="w-full mb-5 bg-green-600 hover:bg-green-700 text-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-md transition-colors"
      >
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <UsersIcon white />
        </div>
        <div className="flex-1 text-left">
          <p className="font-bold text-sm">{t("settings.staffMgmtBanner")}</p>
          <p className="text-xs text-green-100 mt-0.5">{t("settings.staffMgmtSub")}</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white/70 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* ── APPEARANCE ─────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.appearance")}</SectionLabel>
      <SettingsCard>
        <Row
          icon={<SunIcon />}
          label={t("settings.darkMode")}
          sub={t("settings.darkModeSub")}
          onClick={toggleDark}
          right={Toggle}
        />
      </SettingsCard>

      {/* ── LANGUAGE ───────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.language")}</SectionLabel>
      <SettingsCard>
        <Row
          icon={<GlobeIcon />}
          label={t("settings.appLang")}
          sub={(() => { const m = getLangMeta(langCode); return `${m.flag} ${m.name}${m.native !== m.name ? ` · ${m.native}` : ""}`; })()}
          onClick={() => setShowLangPick(true)}
        />
      </SettingsCard>

      {/* ── ACCOUNT ────────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.account")}</SectionLabel>
      <SettingsCard>
        <Row icon={<PersonIcon />} label={t("settings.profile")}   sub={t("settings.profileSub")}  onClick={openEdit} />
        <Row icon={<CrownIcon />}  label={t("settings.premium")}   sub={t("settings.premiumSub")}  onClick={plan !== "premium" ? onUpgrade : undefined} />
        <Row icon={<UsersIcon />}  label={t("settings.staff")}     sub={t("settings.staffSub")}    onClick={() => setStaffMgmt(true)} />
        <Row icon={<BellIcon />}   label={t("settings.notif")}     sub={t("settings.notifSub")}    onClick={() => onNotifications?.()} />
      </SettingsCard>

      {/* ── FEATURES ───────────────────────────────────────────────── */}
      <SectionLabel>Features</SectionLabel>
      <SettingsCard>
        <Row
          icon={<GiftIcon />}
          label="Loyalty Program"
          sub={canDo(plan, "loyalty") ? "Points, cashback & referrals" : "Business & Premium plans"}
          onClick={canDo(plan, "loyalty") ? onLoyalty : onUpgrade}
        />
        <Row
          icon={<BranchIcon />}
          label="Branch Management"
          sub={canDo(plan, "branches") ? "Manage branches & staff" : "Premium plan only"}
          onClick={canDo(plan, "branches") ? onBranches : onUpgrade}
        />
        <Row
          icon={<CoopIcon />}
          label="My Organisations"
          sub="Cooperatives, associations & groups"
          onClick={onCoops}
        />
      </SettingsCard>

      {/* ── SECURITY ───────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.security")}</SectionLabel>
      <SettingsCard>
        {/* App Lock toggle */}
        <Row
          icon={<LockIcon />}
          label={t("settings.appLock")}
          sub={
            lockEnabled
              ? lockHasBio
                ? "Locked · Fingerprint / Face + PIN"
                : "Locked · PIN only"
              : lockHasPIN
                ? "PIN set but lock is off"
                : "Protect app when you leave"
          }
          onClick={async () => {
            if (!lock) return;
            if (lockEnabled) {
              lock.disableLock();
            } else if (lockHasPIN) {
              setLockBusy(true);
              await lock.enableLock();
              setLockBusy(false);
            } else {
              setShowPinSetup(true);
            }
          }}
          right={
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!lock) return;
                if (lockEnabled) {
                  lock.disableLock();
                } else if (lockHasPIN) {
                  setLockBusy(true);
                  await lock.enableLock();
                  setLockBusy(false);
                } else {
                  setShowPinSetup(true);
                }
              }}
              className={`w-12 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none flex-shrink-0 ${
                lockEnabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"
              }`}
            >
              {lockBusy
                ? <span className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </span>
                : <span
                    className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
                    style={{ left: lockEnabled ? "calc(100% - 22px)" : "2px" }}
                  />
              }
            </button>
          }
        />

        {/* Change / Set PIN */}
        <Row
          icon={<ShieldIcon />}
          label={lockHasPIN ? t("settings.changePin") : t("settings.setPin")}
          sub={
            lockHasPIN
              ? lockBioAvail && lockHasBio
                ? "Biometric registered · tap to change PIN"
                : "Change your 4-digit unlock PIN"
              : "Set a 4-digit PIN to enable App Lock"
          }
          onClick={() => setShowPinSetup(true)}
        />
      </SettingsCard>

      {/* ── LEGAL ──────────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.legal")}</SectionLabel>
      <SettingsCard>
        <Row icon={<DocIcon />}  label={t("settings.terms")}   onClick={() => setInfoModal(INFO.terms)} />
        <Row icon={<DocIcon />}  label={t("settings.privacy")} onClick={() => setInfoModal(INFO.privacy)} />
        <Row icon={<HelpIcon />} label="Help & Support"    onClick={() => setShowSupport(true)} />
      </SettingsCard>

      {/* ── LOG OUT ────────────────────────────────────────────────── */}
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="w-full py-[15px] bg-red-50 dark:bg-red-950/30 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-60 transition-colors flex items-center justify-center gap-2.5 text-red-500 dark:text-red-400 active:scale-[0.99]"
      >
        <LogoutIconSvg />
        {signingOut ? t("settings.signingOut") : t("settings.logOut")}
      </button>

      <p className="text-center text-[11px] text-slate-300 dark:text-slate-600 mt-6 font-medium">
        {t("settings.version")}
      </p>

      {/* ── Language picker modal ──────────────────────────────────── */}
      {showLangPick && (
        <LanguageModal
          current={langCode}
          onClose={() => setShowLangPick(false)}
        />
      )}

      {/* ── PIN setup modal ────────────────────────────────────────── */}
      {showPinSetup && (
        <PinSetupModal
          onClose={() => setShowPinSetup(false)}
          onDone={async (pin) => {
            setShowPinSetup(false);
            if (!lock) return;
            await lock.setupPIN(pin);
            setLockBusy(true);
            await lock.enableLock();
            setLockBusy(false);
          }}
        />
      )}

      {/* ── Support ticket modal ───────────────────────────────────── */}
      {showSupport && (
        <SupportModal
          onClose={() => setShowSupport(false)}
          session={{ ...profile, email: session?.user?.email }}
          userType="business"
        />
      )}

      {/* ── Info modal ─────────────────────────────────────────────── */}
      {infoModal && (
        <Modal title={infoModal.title} onClose={() => setInfoModal(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{infoModal.body}</p>
          <button onClick={() => setInfoModal(null)}
            className="w-full mt-5 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-colors">
            Got it
          </button>
        </Modal>
      )}

      {/* ── Edit profile modal ─────────────────────────────────────── */}
      {editProfile && (
        <Modal title="Edit Profile" onClose={() => setEditProfile(false)}>
          <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">

            {/* Photo */}
            <div className="flex flex-col items-center pt-1 pb-2">
              <label className="relative cursor-pointer">
                <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center border-2 border-brand-200 dark:border-brand-800">
                  {avatarSrc
                    ? <img src={avatarSrc} alt="profile" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
                  }
                </div>
                <span className="absolute bottom-0 right-0 bg-brand-600 rounded-full p-1.5 shadow-md">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Tap to change photo</p>
            </div>

            <Field label="Full Name" value={fp.owner_name || ""} placeholder="Your full name"
              onChange={e => setFp(p => ({ ...p, owner_name: e.target.value }))} />

            <Field label="Business Name" value={fp.business_name || ""} placeholder="Your business name"
              onChange={e => setFp(p => ({ ...p, business_name: e.target.value }))} />

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Gender</label>
              <select value={fp.gender || ""} onChange={e => setFp(p => ({ ...p, gender: e.target.value }))} className={inputCls}>
                <option value="">Select gender…</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Date of Birth</label>
              <input type="date" value={fp.date_of_birth || ""} max={new Date().toISOString().split("T")[0]}
                onChange={e => setFp(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
            </div>

            <Field label="NIN" type="text" inputMode="numeric" placeholder="11-digit NIN" value={fp.nin || ""}
              onChange={e => setFp(p => ({ ...p, nin: e.target.value.replace(/\D/g, "").slice(0, 11) }))} />

            <Field label="Phone Number" type="tel" value={fp.phone || ""}
              onChange={e => setFp(p => ({ ...p, phone: e.target.value }))} placeholder="08012345678" />

            <Field label="Business Address" value={fp.address || ""}
              onChange={e => setFp(p => ({ ...p, address: e.target.value }))} placeholder="12 Market Road, Onitsha" />

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">State</label>
              <select value={fp.state || ""} onChange={e => handleStateChange(e.target.value)} className={inputCls}>
                <option value="">Select State…</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">LGA</label>
              <select value={fp.lga || ""} onChange={e => handleLgaChange(e.target.value)} disabled={!fp.state} className={inputCls}>
                <option value="">{fp.state ? "Select LGA…" : "Select state first"}</option>
                {lgas.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Ward</label>
              <select value={fp.ward || ""} onChange={e => setFp(p => ({ ...p, ward: e.target.value }))} disabled={!fp.lga} className={inputCls}>
                <option value="">{fp.lga ? "Select Ward…" : "Select LGA first"}</option>
                {wards.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>

            {saveError && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">
                {saveError}
              </div>
            )}

            <button onClick={handleSaveProfile} disabled={saving}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 transition-colors active:scale-[0.99]">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Staff Management full-screen overlay ───────────────────── */}
      {staffMgmt && (
        <div className="fixed inset-0 z-40 bg-slate-50 dark:bg-slate-900">
          <StaffManagement session={session} plan={plan} onBack={() => setStaffMgmt(false)} />
        </div>
      )}
      </div>{/* /px-4 */}
    </div>
  );
}
