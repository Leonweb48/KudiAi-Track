import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabase";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";

// ── Icons ────────────────────────────────────────────────────────────────────
const ArrowLeft = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const EditIcon  = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const CameraIcon = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const CheckIcon = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>;
const XIcon     = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;

const GENDERS = ["Male", "Female", "Prefer not to say"];

const BUSINESS_CATEGORIES = [
  "Retail & Trading", "Food & Beverage", "Fashion & Beauty",
  "Technology", "Agriculture", "Transportation", "Healthcare",
  "Education", "Construction", "Entertainment", "Finance",
  "Manufacturing", "Wholesale", "Real Estate", "Other",
];

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

function ProfileRow({ label, value, editing, children }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0 pt-0.5">{label}</p>
      {editing ? (
        <div className="flex-1 min-w-0">{children}</div>
      ) : (
        <p className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 break-words">
          {value || <span className="text-slate-300 dark:text-slate-600 font-normal">Not set</span>}
        </p>
      )}
    </div>
  );
}

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

export default function Profile({ store, session, plan, lock }) {
  const navigate = useNavigate();
  const profile  = store?.profile || {};
  const userId   = session?.user?.id;
  const email    = session?.user?.email || "";

  const [editing,    setEditing]    = useState(false);
  const [fp,         setFp]         = useState({});
  const [photoFile,  setPhotoFile]  = useState(null);
  const [logoFile,   setLogoFile]   = useState(null);
  const [avatarSrc,  setAvatarSrc]  = useState(profile.profile_image_url || "");
  const [logoSrc,    setLogoSrc]    = useState(profile.store_image_url   || "");
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState("");
  const [saveOk,     setSaveOk]     = useState(false);
  const [emailPending, setEmailPending] = useState(null);  // new email awaiting confirmation link

  const photoRef = useRef();
  const logoRef  = useRef();

  const lgas  = getLGAs(fp.state || "");
  const wards = getWards(fp.state || "", fp.lga || "");

  const initials = (() => {
    const n = profile.owner_name || profile.business_name || "";
    return n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  })();

  const fmtDate = (iso) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  };

  const openEdit = () => {
    setFp({ ...profile });
    setPhotoFile(null);
    setLogoFile(null);
    setAvatarSrc(profile.profile_image_url || "");
    setLogoSrc(profile.store_image_url   || "");
    setSaveError("");
    setSaveOk(false);
    setEditing(true);
  };

  const handlePhotoChange = (e, type = "avatar") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === "avatar") { setAvatarSrc(reader.result); setPhotoFile(file); }
      else                   { setLogoSrc(reader.result);   setLogoFile(file);  }
    };
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file, path) => {
    const ext  = file.name.split(".").pop();
    const name = `${path}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(name, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(name);
    return publicUrl;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      let imageUrl = profile.profile_image_url;
      let logoUrl  = profile.store_image_url;

      if (photoFile) imageUrl = await uploadImage(photoFile, `${userId}/profile`);
      if (logoFile)  logoUrl  = await uploadImage(logoFile,  `${userId}/store`);

      // setProfile from store handles both DB update and local state update
      const { error } = await store.setProfile({
        ...fp,
        profile_image_url: imageUrl,
        store_image_url:   logoUrl,
      });
      if (error) throw new Error(error.message || "Failed to save");

      // If email changed, trigger Supabase email change (sends confirmation link)
      if (fp.email && fp.email !== email) {
        await supabase.auth.updateUser({ email: fp.email });
        setEmailPending(fp.email);
      }

      setSaveOk(true);
      setTimeout(() => { setSaveOk(false); setEditing(false); }, 1200);
    } catch (err) {
      setSaveError(err.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };



  const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500";

  // ── View Mode ─────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="pb-32 screen-enter">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
            <ArrowLeft />
          </button>
          <h1 className="text-[22px] font-bold text-slate-900 dark:text-white flex-1">My Profile</h1>
          <button onClick={openEdit}
            className="flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-1.5 rounded-xl active:scale-95 transition">
            <EditIcon /> Edit
          </button>
        </div>

        {/* Profile Photo */}
        <div className="flex flex-col items-center py-8 bg-gradient-to-b from-brand-600/5 to-transparent">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg mb-3">
            {avatarSrc
              ? <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
            }
          </div>
          <p className="text-lg font-extrabold text-slate-800 dark:text-white">{profile.business_name || profile.owner_name || "Your Business"}</p>
          {profile.business_name && profile.owner_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{profile.owner_name}</p>
          )}
        </div>

        <div className="px-4">
          {/* Personal Information */}
          <SectionCard title="Personal Information">
            <ProfileRow label="Full Name"    value={profile.owner_name} />
            <ProfileRow label="Email"        value={email} />
            <ProfileRow label="Phone"        value={profile.phone} />
            <ProfileRow label="Gender"       value={profile.gender} />
            <ProfileRow label="Date of Birth" value={profile.date_of_birth ? fmtDate(profile.date_of_birth) : null} />
            <ProfileRow label="NIN"          value={profile.nin ? `${profile.nin.slice(0, 4)}·····${profile.nin.slice(-2)}` : null} />
          </SectionCard>

          {/* Business Information */}
          <SectionCard title="Business Information">
            <ProfileRow label="Business Name"   value={profile.business_name} />
            <ProfileRow label="Category"        value={profile.business_category} />
            <ProfileRow label="Reg. Number"     value={profile.business_registration_number} />
            <ProfileRow label="Business Phone"  value={profile.business_phone} />
            <ProfileRow label="Business Email"  value={profile.business_email} />

            {/* Business logo */}
            <div className="px-4 py-3 flex items-center gap-3">
              <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0">Store Logo</p>
              {logoSrc
                ? <img src={logoSrc} alt="Store" className="w-12 h-12 rounded-xl object-cover border border-slate-100 dark:border-slate-700" />
                : <span className="text-xs text-slate-300 dark:text-slate-600">Not set</span>
              }
            </div>
          </SectionCard>

          {/* Location */}
          <SectionCard title="Location">
            <ProfileRow label="Address" value={profile.address} />
            <ProfileRow label="State"   value={profile.state} />
            <ProfileRow label="LGA"     value={profile.lga} />
            <ProfileRow label="Ward"    value={profile.ward} />
          </SectionCard>

          {/* Account */}
          <SectionCard title="Account">
            <ProfileRow label="Email"      value={email} />
            <ProfileRow label="Plan"       value={plan?.name || "Free Plan"} />
            <ProfileRow label="Currency"   value={profile.currency || "NGN"} />
          </SectionCard>
        </div>
      </div>
    );
  }

  // ── Edit Mode ─────────────────────────────────────────────────────────────
  return (
    <div className="pb-32 screen-enter">
      {/* Email confirmation banner */}
      {emailPending && (
        <EmailChangeBanner
          newEmail={emailPending}
          onClose={() => { setEmailPending(null); setEditing(false); }}
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

        {/* Avatar + Logo */}
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
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => handlePhotoChange(e, "avatar")} />
            </label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Profile Photo</p>
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
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handlePhotoChange(e, "logo")} />
            </label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Store Logo</p>
          </div>
        </div>

        {/* ── Personal Information ─────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 px-1">Personal Information</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Full Name</label>
              <input value={fp.owner_name || ""} onChange={e => setFp(p => ({ ...p, owner_name: e.target.value }))} placeholder="Your full name" className={inputCls} />
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
              {fp.email && fp.email !== email && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  Saving will send a verification code to this email.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Phone Number</label>
              <input value={fp.phone || ""} onChange={e => setFp(p => ({ ...p, phone: e.target.value }))} type="tel" placeholder="08012345678" className={inputCls} />
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
              <input type="date" value={fp.date_of_birth || ""} max={new Date().toISOString().split("T")[0]}
                onChange={e => setFp(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">NIN</label>
              <input value={fp.nin || ""} inputMode="numeric" placeholder="11-digit NIN"
                onChange={e => setFp(p => ({ ...p, nin: e.target.value.replace(/\D/g, "").slice(0, 11) }))} className={inputCls} />
            </div>
          </div>
        </div>

        {/* ── Business Information ─────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 px-1">Business Information</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Name</label>
              <input value={fp.business_name || ""} onChange={e => setFp(p => ({ ...p, business_name: e.target.value }))} placeholder="Your business name" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Industry / Category</label>
              <select value={fp.business_category || ""} onChange={e => setFp(p => ({ ...p, business_category: e.target.value }))} className={inputCls}>
                <option value="">Select category…</option>
                {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Registration Number (BN/RC)</label>
              <input value={fp.business_registration_number || ""} onChange={e => setFp(p => ({ ...p, business_registration_number: e.target.value }))} placeholder="BN123456789" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Phone</label>
              <input value={fp.business_phone || ""} type="tel" onChange={e => setFp(p => ({ ...p, business_phone: e.target.value }))} placeholder="Business phone number" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Email</label>
              <input value={fp.business_email || ""} type="email" onChange={e => setFp(p => ({ ...p, business_email: e.target.value }))} placeholder="business@example.com" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Address</label>
              <input value={fp.address || ""} onChange={e => setFp(p => ({ ...p, address: e.target.value }))} placeholder="12 Market Road, Onitsha" className={inputCls} />
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
