// ProfileEdit — shared self-service profile editor for staff and managers.
// Editable: avatar, phone, address, NOK (name/phone/relationship), email (OTP-verified).
// Read-only: full name, role, branch, permissions list, employment status.
// On save: direct staff.update() + notify_owner_of_staff_change RPC per changed field.
import { useState, useRef, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { uploadAvatar } from "../../screens/staff/StaffShared";
import Field from "./Field";

const GK = "#3DA829";

const base =
  "w-full border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-white " +
  "border-slate-200 dark:border-slate-600 placeholder-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-brand-500/40 transition";

const LockIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 flex-shrink-0">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 px-1">
      {children}
    </p>
  );
}

function ReadOnlyField({ label, value, note }) {
  return (
    <div className="mb-3">
      <label className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide uppercase">
        {label} <LockIcon />
      </label>
      <div className={`${base} text-slate-400 cursor-not-allowed bg-slate-50 dark:bg-slate-800 select-none`}>
        {value || <span className="italic text-slate-300 dark:text-slate-600">Not set</span>}
      </div>
      {note && (
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 italic px-1">{note}</p>
      )}
    </div>
  );
}

// ── Email change sub-flow ────────────────────────────────────────────────────
function EmailChangeFlow({ currentEmail, onSuccess, onCancel }) {
  const [step,    setStep]    = useState("input"); // input | otp | success
  const [newEmail, setNewEmail] = useState("");
  const [otp,     setOtp]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [resendCd, setResendCd] = useState(0);

  const startResendCd = useCallback(() => {
    setResendCd(60);
    const t = setInterval(() => {
      setResendCd(p => { if (p <= 1) { clearInterval(t); return 0; } return p - 1; });
    }, 1000);
  }, []);

  const requestChange = async () => {
    if (!newEmail.includes("@")) { setError("Enter a valid email address"); return; }
    setLoading(true); setError("");
    const { data, error: err } = await supabase.functions.invoke("manage-staff-profile", {
      body: { action: "request_email_change", new_email: newEmail },
    });
    setLoading(false);
    if (err || data?.error) { setError(err?.message || data?.error); return; }
    setStep("otp"); startResendCd();
  };

  const verifyChange = async () => {
    if (otp.length !== 6) { setError("Enter the 6-digit code from your email"); return; }
    setLoading(true); setError("");
    const { data, error: err } = await supabase.functions.invoke("manage-staff-profile", {
      body: { action: "verify_email_change", otp },
    });
    setLoading(false);
    if (err || data?.error) { setError(err?.message || data?.error); return; }
    setStep("success");
    // Refresh auth session so the new email token is picked up
    await supabase.auth.refreshSession();
    setTimeout(() => onSuccess(newEmail), 1200);
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Change Email</p>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">Cancel</button>
      </div>

      {step === "input" && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Current: <span className="font-semibold text-slate-700 dark:text-slate-200">{currentEmail}</span>
          </p>
          <input
            type="email" placeholder="New email address" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className={base}
          />
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <button onClick={requestChange} disabled={loading}
            className="w-full h-10 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition"
            style={{ backgroundColor: GK }}>
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? "Sending…" : "Send Verification Code"}
          </button>
        </>
      )}

      {step === "otp" && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A 6-digit code was sent to <span className="font-semibold text-slate-700 dark:text-slate-200">{newEmail}</span>
          </p>
          <input
            type="text" inputMode="numeric" maxLength={6} placeholder="Enter 6-digit code"
            value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={`${base} tracking-widest text-center text-lg font-bold`}
          />
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <button onClick={verifyChange} disabled={loading || otp.length < 6}
            className="w-full h-10 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition"
            style={{ backgroundColor: GK }}>
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? "Verifying…" : "Confirm Email Change"}
          </button>
          <button onClick={() => { if (resendCd === 0) requestChange(); }} disabled={resendCd > 0}
            className="w-full text-xs text-center text-slate-400 disabled:text-slate-300">
            {resendCd > 0 ? `Resend in ${resendCd}s` : "Resend code"}
          </button>
        </>
      )}

      {step === "success" && (
        <div className="flex items-center gap-2 py-2">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={GK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Email changed successfully</p>
        </div>
      )}
    </div>
  );
}

// ── Main ProfileEdit component ───────────────────────────────────────────────
export default function ProfileEdit({ staff, session, livePerms = [], onBack, onSaved }) {
  const staffId  = staff?.id;
  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const [form, setForm] = useState({
    phone:            staff?.phone            || "",
    address:          staff?.address          || "",
    nok_name:         staff?.nok_name         || "",
    nok_phone:        staff?.nok_phone        || "",
    nok_relationship: staff?.nok_relationship || "",
  });
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState("");
  const [showEmail,    setShowEmail]    = useState(false);
  const [currentEmail, setCurrentEmail] = useState(staff?.email || session?.user?.email || "");
  const fileRef = useRef(null);

  const field = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

  // Notify owner for each changed scalar field
  const notifyChanges = useCallback(async (patches) => {
    const keys = Object.keys(patches);
    for (const key of keys) {
      const oldVal = String(staff?.[key] || "");
      const newVal = String(patches[key] || "");
      if (oldVal !== newVal) {
        await supabase.rpc("notify_owner_of_staff_change", {
          p_field:   key,
          p_old_val: oldVal,
          p_new_val: newVal,
        }).then(null, () => null);
      }
    }
  }, [staff]);

  const save = async () => {
    setSaving(true); setSaveMsg("");
    try {
      const patches = { ...form };
      let avatarUrl = staff?.profile_image_url;
      if (photoFile) {
        avatarUrl = await uploadAvatar(photoFile, staffId);
        patches.profile_image_url = avatarUrl;
      }

      const { error } = await supabase.rpc("update_staff_own_profile", {
        p_phone:             patches.phone             ?? null,
        p_address:           patches.address           ?? null,
        p_nok_name:          patches.nok_name          ?? null,
        p_nok_phone:         patches.nok_phone         ?? null,
        p_nok_relationship:  patches.nok_relationship  ?? null,
        p_profile_image_url: patches.profile_image_url ?? null,
      });
      if (error) throw error;

      // Notify owner of each changed field (fire-and-forget)
      await notifyChanges(patches);

      setPhotoFile(null); setPhotoPreview(null);
      setSaveMsg("Profile saved!");
      onSaved?.({ ...patches, profile_image_url: avatarUrl });
      setTimeout(() => { setSaveMsg(""); onBack?.(); }, 1500);
    } catch (err) {
      setSaveMsg(err?.message || "Save failed. Please try again.");
    }
    setSaving(false);
  };

  // Branch name from staff or store fallback
  const branchLabel = staff?.branch_name || staff?.branch_id ? "Assigned Branch" : null;

  // Permissions summary
  const permsSummary = livePerms.length > 0
    ? livePerms.map(p => `${p.module}${p.can_create ? " (create)" : " (view)"}`).join(", ")
    : "No permissions assigned";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
          <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 text-[17px] font-extrabold text-slate-800 dark:text-slate-100 truncate">Edit Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6 pb-8">

        {/* ── Avatar ── */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg">
              {photoPreview
                ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : staff?.profile_image_url
                  ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>
                      <span className="text-2xl font-black text-white">{initials}</span>
                    </div>
              }
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition"
              style={{ backgroundColor: GK }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-slate-400">Tap camera to change photo · JPG or PNG</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setPhotoFile(f);
              setPhotoPreview(URL.createObjectURL(f));
            }} />
        </div>

        {/* ── Read-only (owner-controlled) ── */}
        <div>
          <SectionLabel>Owner-controlled (read-only)</SectionLabel>
          <ReadOnlyField label="Full Name"    value={staff?.full_name}                           note="Contact your business owner to change this." />
          <ReadOnlyField label="Role"         value={(staff?.role || "").replace(/_/g, " ")}     note="Contact your business owner to change this." />
          <ReadOnlyField label="Status"       value={staff?.status}                              note="Contact your business owner to change this." />
          {branchLabel && (
            <ReadOnlyField label="Branch"     value={staff?.branch_name || staff?.branch_id}    note="Contact your business owner to change this." />
          )}
          <ReadOnlyField label="Permissions"  value={permsSummary}                               note="Contact your business owner to change this." />
        </div>

        {/* ── Editable contact info ── */}
        <div>
          <SectionLabel>Contact Information</SectionLabel>
          <Field label="Phone" type="tel" value={form.phone} onChange={field("phone")} placeholder="+234 800 000 0000" />
          <Field label="Address" value={form.address} onChange={field("address")} placeholder="Home address" />
        </div>

        {/* ── Next of Kin ── */}
        <div>
          <SectionLabel>Next of Kin</SectionLabel>
          <Field label="Name"         value={form.nok_name}         onChange={field("nok_name")}         placeholder="Full name" />
          <Field label="Phone"        type="tel" value={form.nok_phone}  onChange={field("nok_phone")}  placeholder="+234 800 000 0000" />
          <Field label="Relationship" value={form.nok_relationship} onChange={field("nok_relationship")} placeholder="e.g. Spouse, Parent, Sibling" />
        </div>

        {/* ── Email (OTP-verified change) ── */}
        <div>
          <SectionLabel>Email Address</SectionLabel>
          {!showEmail ? (
            <div className="mb-3">
              <div className={`${base} text-slate-400 flex items-center justify-between`}>
                <span className="text-slate-700 dark:text-slate-200 text-sm">{currentEmail}</span>
                <button onClick={() => setShowEmail(true)}
                  className="text-xs font-bold ml-3 flex-shrink-0"
                  style={{ color: GK }}>
                  Change
                </button>
              </div>
            </div>
          ) : (
            <EmailChangeFlow
              currentEmail={currentEmail}
              onSuccess={(email) => { setCurrentEmail(email); setShowEmail(false); }}
              onCancel={() => setShowEmail(false)}
            />
          )}
        </div>

        {/* ── Save / status ── */}
        {saveMsg && (
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl ${saveMsg.includes("saved") ? "" : "bg-red-50 dark:bg-red-900/30 text-red-600"}`}
            style={saveMsg.includes("saved") ? { backgroundColor: "#ecfdf5", color: GK } : {}}>
            {saveMsg.includes("saved")
              ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            }
            <p className="text-sm font-semibold">{saveMsg}</p>
          </div>
        )}

        <button onClick={save} disabled={saving}
          className="w-full h-12 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50"
          style={{ backgroundColor: GK }}>
          {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
