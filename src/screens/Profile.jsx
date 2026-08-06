import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabase";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { maxDobDate, isAtLeast18, AGE_ERROR } from "../utils/ageValidation";
import { compressImage } from "../utils/compressImage";

// ── Icons ────────────────────────────────────────────────────────────────────
const ArrowLeft  = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const EditIcon   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const CameraIcon = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const CheckIcon  = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>;
const XIcon      = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const ZoomIcon   = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_IMG_BYTES  = 5 * 1024 * 1024; // 5 MB accepted — compressed client-side before upload
const GENDERS        = ["Male", "Female", "Prefer not to say"];
const BUSINESS_CATEGORIES = [
  "Retail & Trading", "Food & Beverage", "Fashion & Beauty",
  "Technology", "Agriculture", "Transportation", "Healthcare",
  "Education", "Construction", "Entertainment", "Finance",
  "Manufacturing", "Wholesale", "Real Estate", "Other",
];

// ── Validation ────────────────────────────────────────────────────────────────
function isValidPhone(p) {
  if (!p) return true;
  const c = p.replace(/[\s\-()]/g, "");
  return /^(0[7-9][0-9]{9}|\+234[7-9][0-9]{9})$/.test(c);
}
function isValidEmail(e) {
  if (!e) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ── Photo Lightbox ────────────────────────────────────────────────────────────
function PhotoLightbox({ src, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[200] bg-black/92 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-5 right-5 text-white/80 hover:text-white bg-white/10 rounded-full w-10 h-10 flex items-center justify-center"
        onClick={onClose}
      >
        <XIcon />
      </button>
      <img
        src={src}
        alt="Full size"
        className="max-w-full max-h-[85dvh] object-contain rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

// ── Upload Progress Bar ───────────────────────────────────────────────────────
function UploadProgressBar({ progress, label }) {
  if (!progress) return null;
  return (
    <div className="mt-2 px-1">
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{label || "Uploading…"} {progress}%</p>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ── Phone Verify Modal ────────────────────────────────────────────────────────
function PhoneVerifyModal({ currentEmail, newPhone, onVerified, onClose }) {
  const [sent,    setSent]    = useState(false);
  const [otp,     setOtp]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    setLoading(true);
    setError("");
    const { error: e } = await supabase.auth.signInWithOtp({
      email: currentEmail,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (e) { setError("Could not send code. Please try again."); return; }
    setSent(true);
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) { setError("Enter the full 6-digit code."); return; }
    setLoading(true);
    setError("");
    const { error: e } = await supabase.auth.verifyOtp({
      email: currentEmail,
      token: otp,
      type: "email",
    });
    setLoading(false);
    if (e) { setError("Invalid or expired code. Try again."); return; }
    onVerified();
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
        <p className="text-3xl text-center mb-3">📱</p>
        <p className="text-base font-bold text-slate-800 dark:text-white mb-2 text-center">Verify Phone Change</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 text-center leading-relaxed">
          {sent
            ? <>Enter the 6-digit code sent to <span className="font-semibold text-slate-700 dark:text-slate-200">{currentEmail}</span>.</>
            : <>To update your phone to <span className="font-semibold text-slate-700 dark:text-slate-200">{newPhone}</span>, confirm your identity.</>}
        </p>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 text-center mb-3">{error}</p>
        )}

        {!sent ? (
          <button
            onClick={sendOtp}
            disabled={loading}
            className="w-full py-3 rounded-2xl bg-brand-600 text-white text-sm font-bold mb-3 active:scale-[0.98] transition disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send Verification Code"}
          </button>
        ) : (
          <>
            <input
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-center text-xl tracking-[0.4em] font-bold mb-3 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={verifyOtp}
              disabled={loading || otp.length !== 6}
              className="w-full py-3 rounded-2xl bg-brand-600 text-white text-sm font-bold mb-3 active:scale-[0.98] transition disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Confirm Change"}
            </button>
          </>
        )}

        <button onClick={onClose} className="w-full text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-1">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────────
function SectionCard({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-card border border-slate-100 dark:border-slate-700/50 overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/40">
        {children}
      </div>
    </div>
  );
}

// ── Profile Row ───────────────────────────────────────────────────────────────
function ProfileRow({ label, value, mono = false, editing, children }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0 pt-0.5">{label}</p>
      {editing ? (
        <div className="flex-1 min-w-0">{children}</div>
      ) : (
        <p className={`flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 break-words ${mono ? "font-mono" : ""}`}>
          {value || <span className="text-slate-300 dark:text-slate-600 font-normal italic">Not set</span>}
        </p>
      )}
    </div>
  );
}

// ── Email Change Banner ───────────────────────────────────────────────────────
function EmailChangeBanner({ newEmail, onClose }) {
  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
        <p className="text-3xl text-center mb-3">📧</p>
        <p className="text-base font-bold text-slate-800 dark:text-white mb-2 text-center">Confirm your new email</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 text-center leading-relaxed">
          A confirmation link was sent to{" "}
          <span className="font-semibold text-slate-700 dark:text-slate-200">{newEmail}</span>.
          Click the link in that email to complete the change.
        </p>
        <button onClick={onClose}
          className="w-full py-3 rounded-2xl bg-brand-600 text-white text-sm font-bold active:scale-95">
          Got it
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Profile({ store, session, plan }) {
  const navigate = useNavigate();
  const profile  = store?.profile || {};
  const userId   = session?.user?.id;
  const email    = session?.user?.email || "";

  const [editing,         setEditing]         = useState(false);
  const [fp,              setFp]              = useState({});
  const [photoFile,       setPhotoFile]       = useState(null);
  const [logoFile,        setLogoFile]        = useState(null);
  const [avatarSrc,       setAvatarSrc]       = useState(profile.profile_image_url || "");
  const [logoSrc,         setLogoSrc]         = useState(profile.store_image_url   || "");
  const [saving,          setSaving]          = useState(false);
  const [saveError,       setSaveError]       = useState("");
  const [saveOk,          setSaveOk]          = useState(false);
  const [emailPending,    setEmailPending]    = useState(null);
  const [lightboxSrc,     setLightboxSrc]     = useState(null);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [uploadLabel,     setUploadLabel]     = useState("");
  const [photoErr,        setPhotoErr]        = useState("");
  const [logoErr,         setLogoErr]         = useState("");
  const [fieldErrors,     setFieldErrors]     = useState({});
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [flagLegalChange, setFlagLegalChange] = useState(false);

  const photoRef = useRef();
  const logoRef  = useRef();

  const lgas     = getLGAs(fp.state || "");
  const wards    = getWards(fp.state || "", fp.lga || "");
  const bizLgas  = getLGAs(fp.business_state || "");
  const bizWards = getWards(fp.business_state || "", fp.business_lga || "");

  const initials = (() => {
    const n = profile.full_name || profile.business_name || "";
    return n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  })();

  const fmtDate = (iso) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  };

  const memberSince = profile.member_since || session?.user?.created_at;

  const isLegalChange = !!(
    (fp.business_name || "") !== (profile.business_name || "") ||
    (fp.business_registration_number || "") !== (profile.business_registration_number || "")
  );

  // ── Validate all edited fields ─────────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (fp.phone && !isValidPhone(fp.phone)) {
      errs.phone = "Enter a valid Nigerian phone number (e.g. 08012345678 or +2348012345678)";
    }
    if (fp.business_phone && !isValidPhone(fp.business_phone)) {
      errs.business_phone = "Enter a valid Nigerian phone number";
    }
    if (fp.business_email && !isValidEmail(fp.business_email)) {
      errs.business_email = "Enter a valid email address";
    }
    if (fp.email && fp.email !== email && !isValidEmail(fp.email)) {
      errs.email = "Enter a valid email address";
    }
    if (fp.date_of_birth && !isAtLeast18(fp.date_of_birth)) {
      errs.date_of_birth = AGE_ERROR;
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Open edit mode ─────────────────────────────────────────────────────────
  const openEdit = () => {
    setFp({ ...profile });
    setPhotoFile(null);
    setLogoFile(null);
    setAvatarSrc(profile.profile_image_url || "");
    setLogoSrc(profile.store_image_url   || "");
    setSaveError("");
    setSaveOk(false);
    setPhotoErr("");
    setLogoErr("");
    setFieldErrors({});
    setFlagLegalChange(false);
    setEditing(true);
  };

  // ── Image file selection with validation ───────────────────────────────────
  const handlePhotoChange = (e, type = "avatar") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const setErr = type === "avatar" ? setPhotoErr : setLogoErr;
    setErr("");
    const isImage = file.type.startsWith("image/");
    if (!isImage) {
      setErr("Please choose an image file (JPG, PNG, WEBP…).");
      return;
    }
    if (file.size > MAX_IMG_BYTES) {
      setErr("Image must be under 5 MB. Please choose a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === "avatar") { setAvatarSrc(reader.result); setPhotoFile(file); }
      else                   { setLogoSrc(reader.result);   setLogoFile(file);  }
    };
    reader.readAsDataURL(file);
  };

  // ── Upload image: compress then upload with progress feedback ─────────────
  const uploadImageWithProgress = async (file, path, label) => {
    setUploadLabel("Compressing…");
    setUploadProgress(10);
    const compressed = await compressImage(file, 900);
    setUploadLabel(label);
    setUploadProgress(25);
    let p = 25;
    const iv = setInterval(() => {
      p = Math.min(p + Math.random() * 12, 85);
      setUploadProgress(Math.round(p));
    }, 200);
    try {
      const name = `${path}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(name, compressed, { upsert: true, contentType: "image/jpeg" });
      clearInterval(iv);
      if (error) throw error;
      setUploadProgress(100);
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(name);
      await new Promise(r => setTimeout(r, 350));
      setUploadProgress(0);
      return `${publicUrl}?v=${Date.now()}`;
    } catch (e) {
      clearInterval(iv);
      setUploadProgress(0);
      throw e;
    }
  };

  // ── Core save (called directly or after phone OTP verified) ───────────────
  const doSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      let imageUrl = profile.profile_image_url;
      let logoUrl  = profile.store_image_url;

      if (photoFile) imageUrl = await uploadImageWithProgress(photoFile, `${userId}/profile`, "Uploading photo");
      if (logoFile)  logoUrl  = await uploadImageWithProgress(logoFile,  `${userId}/store`,   "Uploading logo");

      const { error } = await store.setProfile({
        ...fp,
        profile_image_url: imageUrl,
        store_image_url:   logoUrl,
      });
      if (error) throw new Error(error.message || "Failed to save");

      // Optional: flag legal identity change for admin review
      if (flagLegalChange && isLegalChange) {
        await supabase.from("profile_audit_log").insert({
          profile_id: userId,
          action:     "legal_identity_change_request",
          old_values: { business_name: profile.business_name, business_registration_number: profile.business_registration_number },
          new_values: { business_name: fp.business_name,      business_registration_number: fp.business_registration_number },
        });
      }

      // Email change — Supabase sends confirmation link to the new address
      if (fp.email && fp.email !== email) {
        await supabase.auth.updateUser({ email: fp.email });
        setEmailPending(fp.email);
      }

      setSaveOk(true);
      setTimeout(() => { setSaveOk(false); if (!fp.email || fp.email === email) setEditing(false); }, 1400);
    } catch (err) {
      setSaveError(err.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Save entrypoint — gates on phone OTP if number changed ────────────────
  const handleSave = async () => {
    if (!validate()) return;
    const phoneChanged = !!(fp.phone && fp.phone !== (profile.phone || ""));
    if (phoneChanged) {
      setShowPhoneVerify(true);
      return;
    }
    await doSave();
  };

  const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500";

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW MODE
  // ════════════════════════════════════════════════════════════════════════════
  if (!editing) {
    return (
      <div className="pb-32 screen-enter">
        {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <button onClick={() => navigate("/settings")} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
            <ArrowLeft />
          </button>
          <h1 className="text-[22px] font-bold text-slate-900 dark:text-white flex-1">My Profile</h1>
          <button
            onClick={openEdit}
            className="flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-1.5 rounded-xl active:scale-95 transition"
          >
            <EditIcon /> Edit
          </button>
        </div>

        {/* Profile Photo */}
        <div className="flex flex-col items-center py-8 bg-gradient-to-b from-brand-600/5 to-transparent">
          <div
            className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg mb-3 group"
            onClick={() => avatarSrc && setLightboxSrc(avatarSrc)}
          >
            {avatarSrc ? (
              <>
                <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-active:bg-black/20 transition flex items-center justify-center opacity-0 group-active:opacity-100">
                  <ZoomIcon />
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl">
                {initials}
              </div>
            )}
          </div>
          {avatarSrc && (
            <button
              onClick={() => setLightboxSrc(avatarSrc)}
              className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1 mb-2 active:text-brand-500"
            >
              <ZoomIcon /> <span style={{ width: "3px" }} />{" "}Tap to enlarge
            </button>
          )}
          <p className="text-lg font-extrabold text-slate-800 dark:text-white">
            {profile.business_name || profile.owner_name || "Your Business"}
          </p>
          {profile.business_name && profile.full_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{profile.full_name}</p>
          )}
          {profile.business_category && (
            <span className="mt-2 text-[11px] font-semibold text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-2.5 py-1 rounded-full">
              {profile.business_category}
            </span>
          )}
        </div>

        <div className="px-4">
          {/* Personal Information */}
          <SectionCard title="Personal Information">
            <ProfileRow label="Full Name"     value={profile.full_name} />
            <ProfileRow label="Email"         value={email} />
            <ProfileRow label="Phone"         value={profile.phone} />
            <ProfileRow label="Gender"        value={profile.gender} />
            <ProfileRow label="Date of Birth" value={fmtDate(profile.date_of_birth)} />
            <ProfileRow label="NIN"           value={profile.nin ? `${profile.nin.slice(0, 4)}·····${profile.nin.slice(-2)}` : null} mono />
            <ProfileRow label="Home Address"  value={profile.address} />
            <ProfileRow label="State"         value={profile.state} />
            <ProfileRow label="LGA"           value={profile.lga} />
            <ProfileRow label="Ward"          value={profile.ward} />
          </SectionCard>

          {/* Business Information */}
          <SectionCard title="Business Information">
            <ProfileRow label="Business Name"  value={profile.business_name} />
            <ProfileRow label="Industry"       value={profile.industry || profile.business_category} />
            <ProfileRow label="Business Type"  value={profile.business_type} />
            <ProfileRow label="Reg. Status"    value={profile.reg_status} />
            <ProfileRow label="Reg. Number"    value={profile.business_registration_number} />
            <ProfileRow label="Business Phone" value={profile.business_phone} />
            <ProfileRow label="Business Email" value={profile.business_email} />
            <ProfileRow label="Country"        value={profile.business_country} />
            <ProfileRow label="Business State" value={profile.business_state} />
            <ProfileRow label="Business LGA"   value={profile.business_lga} />
            <ProfileRow label="Business Ward"  value={profile.business_ward} />
            <ProfileRow label="Business Addr"  value={profile.business_address} />
            <ProfileRow label="Business Size"   value={profile.business_size} />
            <ProfileRow label="Target Market"   value={profile.target_market} />
            <ProfileRow label="Operating Model" value={profile.operating_model} />
            <ProfileRow label="Products/Svcs"   value={profile.products_services_type} />
            {profile.reg_doc_url && (
              <div className="px-4 py-3 flex items-center gap-3">
                <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0">Reg. Document</p>
                <a href={profile.reg_doc_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold text-brand-600 dark:text-brand-400 underline underline-offset-2">
                  View Document
                </a>
              </div>
            )}

            {/* Invoice Logo */}
            <div className="px-4 py-3 flex items-center gap-3">
              <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0">Invoice Logo</p>
              {logoSrc || profile.store_image_url ? (
                <img
                  src={logoSrc || profile.store_image_url}
                  alt="Store logo"
                  className="w-14 h-14 rounded-2xl object-cover border border-slate-100 dark:border-slate-700 cursor-pointer active:scale-95 transition shadow-sm"
                  onClick={() => setLightboxSrc(logoSrc || profile.store_image_url)}
                />
              ) : (
                <span className="text-xs text-slate-300 dark:text-slate-600 italic">Not set</span>
              )}
            </div>
          </SectionCard>

          {/* Account (read-only) */}
          <SectionCard title="Account">
            <ProfileRow label="Member Since" value={fmtDate(memberSince)} />
            <ProfileRow label="Plan"         value={plan?.name || "Free Plan"} />
            <ProfileRow label="Currency"     value={profile.currency || "NGN"} />
          </SectionCard>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDIT MODE
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="pb-32 screen-enter">
      {/* Overlays */}
      {emailPending && (
        <EmailChangeBanner
          newEmail={emailPending}
          onClose={() => { setEmailPending(null); setEditing(false); }}
        />
      )}
      {showPhoneVerify && (
        <PhoneVerifyModal
          currentEmail={email}
          newPhone={fp.phone}
          onVerified={() => { setShowPhoneVerify(false); doSave(); }}
          onClose={() => setShowPhoneVerify(false)}
        />
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setEditing(false)} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
          <XIcon />
        </button>
        <h1 className="text-[17px] font-bold text-slate-900 dark:text-white flex-1">Edit Profile</h1>
        <button
          onClick={handleSave}
          disabled={saving || saveOk}
          className="flex items-center gap-1.5 text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-xl active:scale-95 transition disabled:opacity-60"
        >
          {saveOk ? <><CheckIcon /> Saved!</> : saving ? "Saving…" : <><CheckIcon /> Save</>}
        </button>
      </div>

      <div className="px-4 py-5 space-y-5">
        {saveError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {saveError}
          </div>
        )}

        {/* ── Avatar + Logo ──────────────────────────────────────────────── */}
        <div className="flex gap-6 justify-center">
          {/* Profile photo */}
          <div className="flex flex-col items-center gap-1.5">
            <label className="relative cursor-pointer active:scale-95 transition">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-brand-200 dark:border-brand-800">
                {avatarSrc
                  ? <img src={avatarSrc} alt="profile" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
                }
              </div>
              <span className="absolute bottom-0 right-0 bg-brand-600 rounded-full p-1.5 shadow">
                <CameraIcon />
              </span>
              <input ref={photoRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => handlePhotoChange(e, "avatar")} />
            </label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Profile Photo</p>
            {photoErr && <p className="text-[10px] text-red-500 text-center max-w-[100px]">{photoErr}</p>}
            {uploadLabel === "Uploading photo" && <UploadProgressBar progress={uploadProgress} label="Uploading" />}
          </div>

          {/* Store logo */}
          <div className="flex flex-col items-center gap-1.5">
            <label className="relative cursor-pointer active:scale-95 transition">
              <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700">
                {logoSrc
                  ? <img src={logoSrc} alt="store" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-500 text-3xl">🏪</div>
                }
              </div>
              <span className="absolute bottom-0 right-0 bg-brand-600 rounded-full p-1.5 shadow">
                <CameraIcon />
              </span>
              <input ref={logoRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => handlePhotoChange(e, "logo")} />
            </label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Invoice Logo</p>
            {logoErr && <p className="text-[10px] text-red-500 text-center max-w-[100px]">{logoErr}</p>}
            {uploadLabel === "Uploading logo" && <UploadProgressBar progress={uploadProgress} label="Uploading" />}
          </div>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center -mt-2">JPG, PNG or WEBP · up to 5 MB (compressed before upload)</p>

        {/* ── Personal Information ───────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 px-1">Personal Information</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Full Name</label>
              <input value={fp.full_name || ""} onChange={e => setFp(p => ({ ...p, full_name: e.target.value }))} placeholder="Your full name" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Email Address</label>
              <input
                value={fp.email !== undefined ? fp.email : email}
                onChange={e => setFp(p => ({ ...p, email: e.target.value }))}
                type="email"
                placeholder="email@example.com"
                className={inputCls}
              />
              {fieldErrors.email && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.email}</p>}
              {fp.email && fp.email !== email && !fieldErrors.email && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  A verification link will be sent to this email to confirm the change.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Phone Number</label>
              <input
                value={fp.phone || ""}
                onChange={e => setFp(p => ({ ...p, phone: e.target.value }))}
                type="tel"
                placeholder="08012345678"
                className={inputCls}
              />
              {fieldErrors.phone && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.phone}</p>}
              {fp.phone && fp.phone !== (profile.phone || "") && !fieldErrors.phone && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  You'll receive a verification code to confirm this change.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Gender</label>
              <select value={fp.gender || ""} onChange={e => setFp(p => ({ ...p, gender: e.target.value }))} className={inputCls}>
                <option value="">Select gender…</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Date of Birth</label>
              <input type="date" value={fp.date_of_birth || ""} max={maxDobDate()}
                onChange={e => setFp(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
              {fieldErrors?.date_of_birth && <p className="text-xs text-red-500 mt-1">{fieldErrors.date_of_birth}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">NIN</label>
              <input value={fp.nin || ""} inputMode="numeric" placeholder="11-digit NIN"
                onChange={e => setFp(p => ({ ...p, nin: e.target.value.replace(/\D/g, "").slice(0, 11) }))} className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Home Address</label>
              <input value={fp.address || ""} onChange={e => setFp(p => ({ ...p, address: e.target.value }))} placeholder="12 Street Name, Town" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">State</label>
              <select value={fp.state || ""} onChange={e => setFp(p => ({ ...p, state: e.target.value, lga: "", ward: "" }))} className={inputCls}>
                <option value="">Select State…</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">LGA</label>
              <select value={fp.lga || ""} onChange={e => setFp(p => ({ ...p, lga: e.target.value, ward: "" }))} disabled={!fp.state} className={inputCls}>
                <option value="">{fp.state ? "Select LGA…" : "Select state first"}</option>
                {lgas.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Ward</label>
              <select value={fp.ward || ""} onChange={e => setFp(p => ({ ...p, ward: e.target.value }))} disabled={!fp.lga} className={inputCls}>
                <option value="">{fp.lga ? "Select Ward…" : "Select LGA first"}</option>
                {wards.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Business Information ───────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 px-1">Business Information</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Name</label>
              <input value={fp.business_name || ""} onChange={e => setFp(p => ({ ...p, business_name: e.target.value }))} placeholder="Your business name" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Registration Number (BN/RC)</label>
              <input value={fp.business_registration_number || ""} onChange={e => setFp(p => ({ ...p, business_registration_number: e.target.value }))} placeholder="BN123456789" className={inputCls} />
            </div>

            {/* Admin review flag — shown only when legal identity fields change */}
            {isLegalChange && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="flag-legal"
                  checked={flagLegalChange}
                  onChange={e => setFlagLegalChange(e.target.checked)}
                  className="mt-0.5 accent-amber-600 w-4 h-4 flex-shrink-0"
                />
                <label htmlFor="flag-legal" className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed cursor-pointer">
                  Flag for admin review — business name and registration number appear on your invoices as legal identity. Check this so an admin is notified of the change.
                </label>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Industry / Category</label>
              <select value={fp.industry || fp.business_category || ""} onChange={e => setFp(p => ({ ...p, industry: e.target.value, business_category: e.target.value }))} className={inputCls}>
                <option value="">Select category…</option>
                {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Type</label>
              <select value={fp.business_type || ""} onChange={e => setFp(p => ({ ...p, business_type: e.target.value }))} className={inputCls}>
                <option value="">Select type…</option>
                {["Sole Proprietorship","Partnership","Limited Liability Company (LLC)","Non-Governmental Organization (NGO)","Cooperative","Startup","Other"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Registration Status</label>
              <select value={fp.reg_status || ""} onChange={e => setFp(p => ({ ...p, reg_status: e.target.value }))} className={inputCls}>
                <option value="">Select status…</option>
                {["Registered","Unregistered","In Process"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Phone</label>
              <input value={fp.business_phone || ""} type="tel" onChange={e => setFp(p => ({ ...p, business_phone: e.target.value }))} placeholder="Business phone number" className={inputCls} />
              {fieldErrors.business_phone && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.business_phone}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Email</label>
              <input value={fp.business_email || ""} type="email" onChange={e => setFp(p => ({ ...p, business_email: e.target.value }))} placeholder="business@example.com" className={inputCls} />
              {fieldErrors.business_email && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.business_email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Address</label>
              <input value={fp.business_address || ""} onChange={e => setFp(p => ({ ...p, business_address: e.target.value }))} placeholder="12 Market Road, Onitsha" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business State</label>
              <select value={fp.business_state || ""} onChange={e => setFp(p => ({ ...p, business_state: e.target.value, business_lga: "", business_ward: "" }))} className={inputCls}>
                <option value="">Select State…</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business LGA</label>
              <select value={fp.business_lga || ""} onChange={e => setFp(p => ({ ...p, business_lga: e.target.value, business_ward: "" }))} disabled={!fp.business_state} className={inputCls}>
                <option value="">{fp.business_state ? "Select LGA…" : "Select state first"}</option>
                {bizLgas.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Ward</label>
              <select value={fp.business_ward || ""} onChange={e => setFp(p => ({ ...p, business_ward: e.target.value }))} disabled={!fp.business_lga} className={inputCls}>
                <option value="">{fp.business_lga ? "Select Ward…" : "Select LGA first"}</option>
                {bizWards.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Size</label>
              <input value={fp.business_size || ""} onChange={e => setFp(p => ({ ...p, business_size: e.target.value }))} placeholder="e.g. Small, Medium, Large" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Target Market</label>
              <input value={fp.target_market || ""} onChange={e => setFp(p => ({ ...p, target_market: e.target.value }))} placeholder="e.g. Retail customers, Wholesale, B2B" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Operating Model</label>
              <input value={fp.operating_model || ""} onChange={e => setFp(p => ({ ...p, operating_model: e.target.value }))} placeholder="e.g. Physical store, Online, Both" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Products / Services</label>
              <input value={fp.products_services_type || ""} onChange={e => setFp(p => ({ ...p, products_services_type: e.target.value }))} placeholder="e.g. Food items, Electronics, Services" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || saveOk}
          className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-bold text-sm active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saveOk ? "✓ Saved!" : saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
