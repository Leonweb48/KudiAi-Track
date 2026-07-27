import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Modal              from "../components/shared/Modal";
import ProfilePreviewModal from "../components/shared/ProfilePreviewModal";
import Field              from "../components/shared/Field";
import StaffManagement    from "./StaffManagement";
import LegalScreen        from "./LegalScreen";
import PinDots            from "../components/PinDots";
import TransactionPinModal from "../components/TransactionPinModal";
import ForgotPinFlow      from "../components/ForgotPinFlow";
import { supabase }       from "../utils/supabase";
import { canDo, planAvailableText, hasHigherPlanAvailable, getPlanInfo } from "../utils/plans";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { LANGUAGES, getLangMeta } from "../utils/i18n";
import { getTtsDiagLog, clearTtsDiagLog } from "../utils/tts";
import { useLanguage, useT } from "../contexts/LanguageContext";
import { maxDobDate, isAtLeast18, AGE_ERROR } from "../utils/ageValidation";
import { useCampaigns } from "../hooks/useCampaigns";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import UpsellInlineSlot from "../components/slots/UpsellInlineSlot";
import NotificationPreferences from "../components/NotificationPreferences";

/* ── Change PIN Modal (3-step: verify current → enter new → confirm new) ── */
const PinBsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

function ChangePinModal({ pinLength = 6, title, onVerifyCurrent, onSetNew, onClose, onForgotPin }) {
  const [step,        setStep]       = useState("current");
  const [verifiedPin, setVerifiedPin] = useState("");
  const [newPin,      setNewPin]      = useState("");
  const [pin,         setPin]         = useState("");
  const [error,       setError]       = useState("");
  const [checking,    setChecking]    = useState(false);

  const maxLen = pinLength;
  const stepTitle = step === "current" ? "Enter current PIN" : step === "new" ? "Enter new PIN" : "Confirm new PIN";
  const stepSub   = step === "current"
    ? `Your ${pinLength}-digit PIN`
    : step === "new"
    ? `Choose a new ${pinLength}-digit PIN`
    : "Re-enter your new PIN to confirm";

  const handleDigit = async (d) => {
    if (pin.length >= maxLen || checking) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length < maxLen) return;

    setTimeout(async () => {
      if (step === "current") {
        setChecking(true);
        const result = await onVerifyCurrent(next);
        setChecking(false);
        if (result.success) { setVerifiedPin(next); setPin(""); setStep("new"); }
        else { setPin(""); setError(result.error || "Incorrect PIN."); }
        return;
      }
      if (step === "new") { setNewPin(next); setPin(""); setStep("confirm"); return; }
      if (step === "confirm") {
        if (next !== newPin) { setPin(""); setError("PINs don't match. Try again."); setStep("new"); setNewPin(""); return; }
        setChecking(true);
        await onSetNew(verifiedPin, next);
        setChecking(false);
        onClose();
      }
    }, 150);
  };

  const handleDelete = () => { setPin(p => p.slice(0, -1)); setError(""); };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col items-center gap-6 py-2">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {["current","new","confirm"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                step === s ? "bg-brand-600 text-white"
                  : ["current","new","confirm"].indexOf(step) > i
                    ? "bg-brand-200 dark:bg-brand-800 text-brand-700 dark:text-brand-300"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-400"
              }`}>{i + 1}</div>
              {i < 2 && <div className="w-8 h-0.5 rounded-full bg-slate-200 dark:bg-slate-700" />}
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{stepTitle}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{stepSub}</p>
        </div>

        <PinDots filled={pin.length} count={maxLen} />

        <div className="h-4 -mt-2">
          {error   && <p className="text-xs text-red-500 font-semibold text-center">{error}</p>}
          {checking && <p className="text-xs text-slate-400 text-center">Checking…</p>}
        </div>

        {/* Shared numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => handleDigit(String(n))} disabled={checking}
              className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100 disabled:opacity-50">
              {n}
            </button>
          ))}
          <div className="h-14" />
          <button onClick={() => handleDigit("0")} disabled={checking}
            className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100 disabled:opacity-50">
            0
          </button>
          <button onClick={handleDelete} disabled={checking}
            className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-600 dark:text-slate-400 flex items-center justify-center cursor-pointer transition-all duration-100 disabled:opacity-50">
            <PinBsIcon />
          </button>
        </div>

        {/* Forgot PIN — only on the verify-current step */}
        {step === "current" && onForgotPin && (
          <button onClick={onForgotPin}
            className="text-xs text-slate-400 dark:text-slate-500 underline underline-offset-2 py-1">
            Forgot PIN?
          </button>
        )}
      </div>
    </Modal>
  );
}


const GENDERS = ["Male", "Female", "Prefer not to say"];


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

const UsersIcon      = ({ white } = {}) => white
  ? <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{["M17 20h5v-2a4 4 0 00-4-4h-1","M9 20H4v-2a4 4 0 014-4h1m4 6v-2m0-4a4 4 0 100-8 4 4 0 000 8z"].map((d,i)=><path key={i} d={d}/>)}</svg>
  : ic("M17 20h5v-2a4 4 0 00-4-4h-1|M9 20H4v-2a4 4 0 014-4h1m4 6v-2m0-4a4 4 0 100-8 4 4 0 000 8z");
const LockIcon       = () => ic("M3 11h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V11z|M7 11V7a5 5 0 0110 0v4");
const ShieldIcon     = () => ic("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
const DocIcon        = () => ic("M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8");
const HelpIcon       = () => ic("M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z|M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01");
const GlobeIcon = () => ic("M12 2a10 10 0 100 20A10 10 0 0012 2z|M2 12h20|M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z");
const GiftIcon   = () => ic("M20 12v10H4V12|M22 7H2v5h20V7z|M12 22V7|M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z|M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z");
const BranchIcon = () => ic("M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10");
const CoopIcon   = () => ic("M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75|M9 7a4 4 0 100 8 4 4 0 000-8z");
const BellSettingsIcon = () => ic("M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 01-3.46 0");
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


/* ── Main component ───────────────────────────────────────────────── */
export default function Settings({ store, session, plan = "starter", onUpgrade, onStaffManagement, lock, onLoyalty, onBranches, onCoops }) {
  const { profile, setProfile } = store;
  const { lang: langCode }      = useLanguage();
  const t                       = useT();
  const navigate                = useNavigate();
  const [staffMgmt,     setStaffMgmt]     = useState(false);
  const [editProfile,   setEditProfile]   = useState(false);
  const [fp,            setFp]            = useState({ ...profile });
  const [photoFile,     setPhotoFile]     = useState(null);
  const [photoPreview,  setPhotoPreview]  = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState("");
  const [signingOut,    setSigningOut]    = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [showTxnGate,   setShowTxnGate]   = useState(false);
  const [changePinType, setChangePinType] = useState("app");  // "app" | "txn"
  const [showAutoLock,  setShowAutoLock]  = useState(false);
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [showLangPick,  setShowLangPick]  = useState(false);
  const [legalScreen,        setLegalScreen]        = useState(null); // "terms" | "privacy"
  const [showNotifPrefs,     setShowNotifPrefs]     = useState(false);
  const [acceptedConsent,    setAcceptedConsent]    = useState(null);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [wcAmountStr, setWcAmountStr] = useState(
    profile.working_capital_amount ? String(Math.round(profile.working_capital_amount / 100)) : ""
  );
  const [wcAsOf,    setWcAsOf]    = useState(profile.working_capital_as_of  || "");
  const [wcSaving,  setWcSaving]  = useState(false);
  const [wcError,   setWcError]   = useState("");
  const [wcSuccess, setWcSuccess] = useState(false);
  const { slotMap: camSlotMap, loading: camLoading, recordEvent } = useCampaigns(["announcement_bar","upsell_inline"]);
  const settingsAnnBars = camSlotMap.announcement_bar || [];
  const settingsUpsells = camSlotMap.upsell_inline   || [];

  useEffect(() => {
    if (!editProfile) setFp({ ...profile });
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWcAmountStr(profile.working_capital_amount ? String(Math.round(profile.working_capital_amount / 100)) : "");
    setWcAsOf(profile.working_capital_as_of || "");
  }, [profile.working_capital_amount, profile.working_capital_as_of]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user's latest accepted consent for display in Settings
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    supabase
      .from("user_consents")
      .select("tnc_version, privacy_version, consented_at")
      .eq("user_id", uid)
      .order("consented_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setAcceptedConsent(data); })
      .catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const lgas  = getLGAs(fp.state  || "");
  const wards = getWards(fp.state || "", fp.lga || "");

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleStateChange = (s) => setFp(p => ({ ...p, state: s, lga: "", ward: "" }));
  const handleLgaChange   = (l) => setFp(p => ({ ...p, lga: l, ward: "" }));

  const handleSaveProfile = async () => {
    if (fp.date_of_birth && !isAtLeast18(fp.date_of_birth)) {
      setSaveError(AGE_ERROR);
      return;
    }
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

  const handleSaveWorkingCapital = async () => {
    setWcError(""); setWcSuccess(false);
    const nairaVal = parseFloat(wcAmountStr);
    if (!wcAmountStr.trim() || isNaN(nairaVal) || nairaVal <= 0) {
      setWcError("Enter a valid amount in ₦");
      return;
    }
    const kobo = Math.round(nairaVal * 100);
    setWcSaving(true);
    const { error } = await setProfile({
      ...profile,
      working_capital_amount: kobo,
      working_capital_as_of:  wcAsOf || null,
    });
    setWcSaving(false);
    if (error) { setWcError(error.message || "Failed to save"); return; }
    setWcSuccess(true);
    setTimeout(() => setWcSuccess(false), 3000);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase?.auth.signOut();
  };

  const toggleDark = () => setProfile(p => ({ ...p, dark_mode: !p.dark_mode }));

  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try { return localStorage.getItem("kt_tts_enabled") !== "0"; } catch { return true; }
  });
  const toggleTts = () => setTtsEnabled(v => {
    const next = !v;
    // Write "0" to explicitly disable; remove the key to restore default (enabled).
    try {
      if (next) localStorage.removeItem("kt_tts_enabled");
      else      localStorage.setItem("kt_tts_enabled", "0");
    } catch {}
    return next;
  });

  const userId = session?.user?.id;
  const [briefEnabled, setBriefEnabled] = useState(() => {
    if (!userId) return true;
    try {
      const v = localStorage.getItem(`kt_brief_enabled_${userId}`);
      return v === null ? true : v !== "0";
    } catch { return true; }
  });
  const toggleBrief = () => setBriefEnabled(v => {
    const next = !v;
    try {
      if (next) localStorage.removeItem(`kt_brief_enabled_${userId}`);
      else      localStorage.setItem(`kt_brief_enabled_${userId}`, "0");
      window.dispatchEvent(new CustomEvent("kt_brief_toggle"));
    } catch {}
    return next;
  });

  const [logCopied, setLogCopied] = useState(false);
  const copyTtsLogs = () => {
    const lines = getTtsDiagLog();
    const text  = lines.length
      ? lines.join("\n")
      : "(no TTS-DIAG lines captured yet — trigger a transaction or AI chat first)";
    navigator.clipboard?.writeText(text).then(() => {
      setLogCopied(true);
      setTimeout(() => setLogCopied(false), 3000);
    }).catch(() => {});
    clearTtsDiagLog();
  };

  const initials  = profile.owner_name?.[0]?.toUpperCase() || "A";
  const avatarSrc = photoPreview || profile.profile_image_url;

  const { name: planName, sortOrder: planTier } = getPlanInfo(plan);
  const planBadgeClass = planTier >= 2
    ? "bg-navy/10 text-navy dark:bg-navy/20 dark:text-blue-300"
    : planTier >= 1
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400";

  // ── Subscription management ────────────────────────────────────
  const [sub,           setSub]           = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling,    setCancelling]    = useState(false);
  const [cancelDone,    setCancelDone]    = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from("subscriptions")
      .select("id, plan, expires_at, billing_cycle, cancel_at_period_end, cancelled_at")
      .eq("user_id", session.user.id)
      .eq("status", "active")
      .maybeSingle()
      .then(({ data }) => {
        setSub(data);
        if (data?.cancel_at_period_end) setCancelDone(true);
      });
  }, [session?.user?.id]);

  const fmt = (iso) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  };

  const handleCancelSubscription = async () => {
    if (!sub?.id) return;
    setCancelling(true);
    const { error } = await supabase.from("subscriptions")
      .update({ cancel_at_period_end: true, cancelled_at: new Date().toISOString() })
      .eq("id", sub.id);
    if (!error) {
      setSub(s => ({ ...s, cancel_at_period_end: true }));
      setCancelDone(true);
    }
    setCancelling(false);
    setShowCancelModal(false);
  };

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
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 pb-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <h1 className="text-[22px] font-bold text-slate-900 dark:text-white tracking-tight">{t("settings.title")}</h1>
      </div>
      <div className="px-4">

      {/* ── PROFILE CARD ───────────────────────────────────────────── */}
      <button
        onClick={() => setShowProfilePreview(true)}
        className="mt-4 mb-5 w-full bg-white dark:bg-slate-800 rounded-3xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center gap-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-slate-100 dark:border-slate-700">
          {avatarSrc
            ? <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xl">{initials}</div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-extrabold text-slate-800 dark:text-white truncate">{profile.business_name || profile.owner_name || "Business"}</p>
          {profile.business_name && profile.owner_name && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{profile.owner_name}</p>
          )}
          <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${planBadgeClass}`}>
            {planName}
          </span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); setShowProfilePreview(true); }}
          className="flex-shrink-0 text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-2.5 min-h-[44px] inline-flex items-center rounded-xl active:scale-95 transition"
        >
          Edit
        </button>
      </button>

      {/* ── Announcement bar slot ─────────────────────────────────── */}
      <AnnouncementBarSlot campaigns={settingsAnnBars} loading={camLoading} recordEvent={recordEvent} />

      {/* ── Upsell inline slot ───────────────────────────────────── */}
      <UpsellInlineSlot campaigns={settingsUpsells} loading={camLoading} recordEvent={recordEvent} />

      {/* ── STAFF MANAGEMENT BANNER ────────────────────────────────── */}
      <button
        onClick={() => canDo(plan, "staffManagement") ? setStaffMgmt(true) : onUpgrade?.()}
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

      {/* ── SUBSCRIPTION MANAGEMENT ────────────────────────────────── */}
      <SectionLabel>Subscription</SectionLabel>
      <div className="mb-5 bg-white dark:bg-slate-800 rounded-3xl shadow-card border border-slate-100 dark:border-slate-700/50 overflow-hidden">
        {/* Plan info row */}
        <div className="px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{planName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {planTier > 0 && sub?.expires_at
                ? cancelDone
                  ? `Cancels on ${fmt(sub.expires_at)} — moves to Free Plan`
                  : `${sub?.billing_cycle === "yearly" ? "Annual" : "Monthly"} · Renews ${fmt(sub.expires_at)}`
                : "Free forever"}
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${planBadgeClass}`}>
            {planTier === 0 ? "Free" : sub?.billing_cycle === "yearly" ? "Yearly" : "Monthly"}
          </span>
        </div>

        {/* Cancelled warning banner */}
        {cancelDone && sub?.expires_at && (
          <div className="mx-4 mb-3 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-3 py-2.5">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Your subscription is cancelled. You keep access to <strong>{planName}</strong> until <strong>{fmt(sub.expires_at)}</strong>, then your account moves to the Free Plan.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 pb-4 flex gap-2">
          {/* Upgrade / Change Plan */}
          <button
            onClick={onUpgrade}
            className={`flex-1 py-2.5 rounded-2xl text-sm font-bold text-white active:scale-95 transition ${planTier >= 2 ? "bg-navy" : planTier >= 1 ? "bg-blue-700" : "bg-brand-600"}`}>
            {planTier === 0 ? "Upgrade Plan" : hasHigherPlanAvailable(plan) ? "Upgrade Plan" : "Change Plan"}
          </button>

          {/* Cancel — only for active paid subscribers who haven't already cancelled */}
          {planTier > 0 && !cancelDone && sub?.expires_at && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-red-500 border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 active:scale-95 transition">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-modal bg-black/50 backdrop-blur-sm flex items-end justify-center px-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-sm px-6 pt-6 shadow-2xl"
               style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}>
            <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-red-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white text-center mb-2">Cancel Subscription?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center leading-relaxed mb-6">
              You'll keep full access to <strong className="text-slate-700 dark:text-slate-200">{planName}</strong> until{" "}
              <strong className="text-slate-700 dark:text-slate-200">{fmt(sub?.expires_at)}</strong>.
              After that, your account moves to the <strong className="text-slate-700 dark:text-slate-200">Free Plan</strong> automatically. You can resubscribe anytime.
            </p>
            <div className="space-y-2.5">
              <button
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="w-full py-3 rounded-2xl font-bold text-sm text-white bg-red-500 active:scale-[0.98] transition disabled:opacity-50">
                {cancelling ? "Cancelling…" : "Yes, Cancel Subscription"}
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="w-full py-3 rounded-2xl font-bold text-sm text-white bg-green-600 active:scale-[0.98] transition">
                Keep My Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS ──────────────────────────────────────────── */}
      <SectionLabel>Notifications</SectionLabel>
      <SettingsCard>
        <Row
          icon={<BellSettingsIcon />}
          label="Notification Preferences"
          sub="Push alerts, in-app bell, category toggles"
          onClick={() => setShowNotifPrefs(true)}
        />
      </SettingsCard>

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
        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          }
          label="Voice Feedback"
          sub="Speak confirmations after transactions and AI replies"
          onClick={toggleTts}
          right={
            <button
              onClick={e => { e.stopPropagation(); toggleTts(); }}
              role="switch"
              aria-checked={ttsEnabled}
              className={`w-12 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none flex-shrink-0 ${
                ttsEnabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"
              }`}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
                style={{ left: ttsEnabled ? "calc(100% - 22px)" : "2px" }}
              />
            </button>
          }
        />
        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
          }
          label="Daily Brief"
          sub="AI-generated morning summary with voice read-aloud on app open"
          onClick={toggleBrief}
          right={
            <button
              onClick={e => { e.stopPropagation(); toggleBrief(); }}
              role="switch"
              aria-checked={briefEnabled}
              className={`w-12 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none flex-shrink-0 ${
                briefEnabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"
              }`}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
                style={{ left: briefEnabled ? "calc(100% - 22px)" : "2px" }}
              />
            </button>
          }
        />
        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 12h6M9 16h6M9 8h6M5 20h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/>
            </svg>
          }
          label="Copy TTS Debug Logs"
          sub="Captures audio diagnostics — paste to share for support"
          onClick={copyTtsLogs}
          right={
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${logCopied ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"}`}>
              {logCopied ? "Copied!" : "Copy"}
            </span>
          }
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
        <Row icon={<PersonIcon />} label={t("settings.profile")}   sub={t("settings.profileSub")}  onClick={() => navigate("/profile")} />
        <Row icon={<UsersIcon />}  label={t("settings.staff")}     sub={canDo(plan, "staffManagement") ? t("settings.staffSub") : planAvailableText("staffManagement")}    onClick={() => canDo(plan, "staffManagement") ? setStaffMgmt(true) : onUpgrade?.()} />
      </SettingsCard>

      {/* ── FEATURES ───────────────────────────────────────────────── */}
      <SectionLabel>Features</SectionLabel>
      <SettingsCard>
        <Row
          icon={<GiftIcon />}
          label="Loyalty Program"
          sub={canDo(plan, "loyalty") ? "Points, cashback & referrals" : planAvailableText("loyalty")}
          onClick={canDo(plan, "loyalty") ? onLoyalty : onUpgrade}
        />
        <Row
          icon={<BranchIcon />}
          label="Branch Management"
          sub={canDo(plan, "branches") ? "Manage branches & staff" : planAvailableText("branches")}
          onClick={canDo(plan, "branches") ? onBranches : onUpgrade}
        />
        <Row
          icon={<CoopIcon />}
          label="My Organisations"
          sub={canDo(plan, "organisation") ? "Cooperatives, associations & groups" : planAvailableText("organisation")}
          onClick={canDo(plan, "organisation") ? onCoops : onUpgrade}
        />
      </SettingsCard>

      {/* ── BUSINESS ───────────────────────────────────────────────── */}
      <SectionLabel>Business</SectionLabel>
      <SettingsCard>
        <div className="px-4 py-4">
          <p className="font-semibold text-[15px] text-slate-800 dark:text-slate-100 mb-0.5">Working Capital</p>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 mb-4">
            Set your declared capital so KudiAI can track how much of it your business has earned or lost.
          </p>
          <label className="block text-[12px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            Declared Capital (₦)
          </label>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="e.g. 500000"
            value={wcAmountStr}
            onChange={e => { setWcAmountStr(e.target.value); setWcError(""); setWcSuccess(false); }}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400 mb-3"
          />
          <label className="block text-[12px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            Count profit from (optional)
          </label>
          <input
            type="date"
            value={wcAsOf}
            onChange={e => { setWcAsOf(e.target.value); setWcError(""); setWcSuccess(false); }}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400 mb-4"
          />
          {wcError && <p className="text-[12px] text-red-500 mb-3">{wcError}</p>}
          {wcSuccess && <p className="text-[12px] text-emerald-600 dark:text-emerald-400 mb-3">Saved</p>}
          <button
            onClick={handleSaveWorkingCapital}
            disabled={wcSaving}
            className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white font-semibold text-sm transition-colors disabled:opacity-60"
          >
            {wcSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </SettingsCard>

      {/* ── SECURITY ───────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.security")}</SectionLabel>
      <SettingsCard>
        {/* App Lock PIN */}
        <Row
          icon={<LockIcon />}
          label="App Lock PIN"
          sub={lock?.status?.appPinSet ? "Change your 6-digit unlock PIN" : "Not set"}
          onClick={() => {
            setChangePinType("app");
            if (lock?.status?.txnPinSet) {
              setShowTxnGate(true);
            } else {
              setShowChangePin(true);
            }
          }}
        />

        {/* Transaction PIN */}
        <Row
          icon={<ShieldIcon />}
          label="Transaction PIN"
          sub={lock?.status?.txnPinSet
            ? lock?.status?.txnPinResetAt
              ? "Recently reset — high-value ops under 24h review"
              : "Change your 4-digit payment PIN"
            : "Not set"}
          onClick={() => { setChangePinType("txn"); setShowChangePin(true); }}
        />

        {/* Biometric toggle */}
        {lock?.biometricAvailable && (
          <Row
            icon={
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12a10 10 0 0020 0" />
                <path d="M5.5 12a6.5 6.5 0 0013 0" />
                <path d="M9 12a3 3 0 016 0" />
                <path d="M12 12v5" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
              </svg>
            }
            label="Biometric Unlock"
            sub={lock?.biometricEnabled ? "Fingerprint / Face ID enabled" : "Use biometrics to unlock faster"}
            onClick={async () => {
              if (lock?.biometricEnabled) {
                await lock.disableBiometric();
              } else {
                await lock.registerBiometric();
              }
            }}
            right={
              <div className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${lock?.biometricEnabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
                <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200" style={{ left: lock?.biometricEnabled ? "calc(100% - 22px)" : "2px" }} />
              </div>
            }
          />
        )}

        {/* Auto-lock timeout */}
        <Row
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          }
          label="Auto-lock"
          sub={(() => {
            const t = lock?.autoLockTimeout ?? 300;
            if (t === 0)   return "Auto-lock is disabled";
            if (t < 60)    return `Locks after ${t} seconds of inactivity`;
            const m = t / 60;
            return `Locks after ${m} minute${m === 1 ? "" : "s"} of inactivity`;
          })()}
          onClick={() => setShowAutoLock(true)}
        />
      </SettingsCard>

      {/* ── LEGAL ──────────────────────────────────────────────────── */}
      <SectionLabel>{t("settings.legal")}</SectionLabel>
      <SettingsCard>
        <Row icon={<DocIcon />}  label={t("settings.terms")}   sub="Last updated 1 July 2026"   onClick={() => setLegalScreen("terms")} />
        <Row icon={<DocIcon />}  label={t("settings.privacy")} sub="NDPA 2023 compliant"         onClick={() => setLegalScreen("privacy")} />
        {acceptedConsent && (
          <Row
            icon={<DocIcon />}
            label="Your accepted version"
            sub={`T&C v${acceptedConsent.tnc_version} · Privacy v${acceptedConsent.privacy_version} · ${new Date(acceptedConsent.consented_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
          />
        )}
        <Row icon={<HelpIcon />} label="Help & Support"        onClick={() => navigate("/help")} />
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

      {/* ── Txn PIN gate (before changing app lock PIN) ────────────── */}
      {showTxnGate && (
        <TransactionPinModal
          title="Confirm Transaction PIN"
          onApprove={() => { setShowTxnGate(false); setShowChangePin(true); }}
          onCancel={() => setShowTxnGate(false)}
        />
      )}

      {/* ── Change PIN modal ───────────────────────────────────────── */}
      {showChangePin && (
        <ChangePinModal
          title={changePinType === "app" ? "Change App Lock PIN" : "Change Transaction PIN"}
          pinLength={changePinType === "app" ? 6 : 4}
          onVerifyCurrent={async (pin) => {
            const action = changePinType === "app" ? "verify_app_pin" : "verify_txn_pin";
            const { data } = await (supabase?.functions.invoke("pin-manager", {
              body: { action, pin },
            }) ?? Promise.resolve({ data: null }));
            return {
              success: !!data?.success,
              error: data?.success ? null : (data?.locked ? "Too many attempts — try later" : "Incorrect PIN"),
            };
          }}
          onSetNew={async (currentPinVerified, newPin) => {
            const action = changePinType === "app" ? "change_app_pin" : "change_txn_pin";
            await (supabase?.functions.invoke("pin-manager", {
              body: { action, currentPin: currentPinVerified, newPin },
            }) ?? Promise.resolve({}));
            await lock?.refetch?.();
          }}
          onClose={() => setShowChangePin(false)}
          onForgotPin={() => { setShowChangePin(false); setShowForgotPin(true); }}
        />
      )}

      {/* ── Auto-lock timeout picker ────────────────────────────────── */}
      {showAutoLock && (
        <Modal title="Auto-lock Timeout" onClose={() => setShowAutoLock(false)}>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            App will lock automatically after this period of inactivity.
          </p>
          <div className="space-y-2">
            {[
              { value: 30,   label: "30 seconds" },
              { value: 60,   label: "1 minute" },
              { value: 300,  label: "5 minutes" },
              { value: 900,  label: "15 minutes" },
              { value: 1800, label: "30 minutes" },
              { value: 0,    label: "Never" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={async () => {
                  try {
                    await lock?.updateSettings?.({ autoLockTimeout: value });
                  } finally {
                    setShowAutoLock(false);
                  }
                }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors active:scale-[0.98] ${
                  (lock?.autoLockTimeout ?? 300) === value
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400"
                    : value === 0
                      ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 text-amber-800 dark:text-amber-300"
                      : "border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-800 dark:text-slate-100"
                }`}
              >
                <span className="font-semibold text-sm">{label}</span>
                {(lock?.autoLockTimeout ?? 300) === value && (
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          {(lock?.autoLockTimeout ?? 300) === 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5 leading-relaxed">
              Your app won&apos;t lock automatically. Anyone with access to your phone may be able to open it.
            </p>
          )}
        </Modal>
      )}

      {/* ── Forgot PIN flow ────────────────────────────────────────── */}
      {showForgotPin && (
        <ForgotPinFlow
          pinLock={lock}
          onCancel={() => setShowForgotPin(false)}
        />
      )}


      {/* ── Edit profile modal ─────────────────────────────────────── */}
      {editProfile && (
        <Modal title="Edit Profile" onClose={() => setEditProfile(false)}>
          <div className="space-y-4 max-h-[72dvh] overflow-y-auto pr-1">

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
              <input type="date" value={fp.date_of_birth || ""} max={maxDobDate()}
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
        <div className="fixed inset-0 z-sheet bg-slate-50 dark:bg-slate-900">
          <StaffManagement session={session} plan={plan} onBack={() => setStaffMgmt(false)} onUpgrade={() => { setStaffMgmt(false); onUpgrade?.(); }} />
        </div>
      )}

      {/* ── Notification Preferences modal ─────────────────────────── */}
      {showNotifPrefs && (
        <NotificationPreferences
          userId={session?.user?.id}
          onClose={() => setShowNotifPrefs(false)}
        />
      )}

      {/* ── Legal full-screen overlay ───────────────────────────────── */}
      {legalScreen && (
        <LegalScreen type={legalScreen} onBack={() => setLegalScreen(null)} />
      )}
      </div>{/* /px-4 */}

      {showProfilePreview && (
        <ProfilePreviewModal
          profile={profile}
          plan={plan}
          onClose={() => setShowProfilePreview(false)}
        />
      )}
    </div>
  );
}
