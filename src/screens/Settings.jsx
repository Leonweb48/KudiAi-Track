import { useState, useEffect } from "react";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import { supabase } from "../utils/supabase";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { PLANS_META } from "../utils/plans";

const GENDERS = ["Male", "Female", "Prefer not to say"];

const INFO_CONTENT = {
  notify: {
    title: "Notifications",
    body: "Push notifications for payment reminders and overdue credits are coming in a future update. Stay tuned!",
  },
  privacy: {
    title: "Privacy Policy",
    body: "KudiAI Track collects only the data you enter. Your business data is stored securely in Supabase and is never shared with third parties. You can request data deletion at any time by contacting support.",
  },
  terms: {
    title: "Terms of Service",
    body: "By using KudiAI Track you agree to use the app for lawful business purposes only. We are not liable for financial decisions made based on app data. Subscription fees are non-refundable after the billing period starts.",
  },
};

function MenuRow({ icon, label, sub, onClick, chevron = true }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus-visible:outline-none"
      aria-label={label}
    >
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{label}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>
      </div>
      {chevron && (
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

async function uploadProfileImg(file, userId) {
  const path = `${userId}/profile`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  const base = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return `${base}?v=${Date.now()}`;
}

export default function Settings({ store, session, plan = "starter", onUpgrade }) {
  const { profile, setProfile } = store;
  const [editProfile, setEditProfile] = useState(false);
  const [fp, setFp]                   = useState({ ...profile });
  const [photoFile, setPhotoFile]     = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState("");
  const [signingOut, setSigningOut]   = useState(false);
  const [infoModal, setInfoModal]     = useState(null);

  // Keep fp in sync with profile whenever loadData finishes and the modal is closed.
  // Without this, fp could be initialised with empty defaults before the DB fetch completes.
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

  const handleMenuAction = (action) => {
    if (action === "help") {
      window.open("https://wa.me/2348000000000?text=Hi%2C+I+need+help+with+KudiAI+Track", "_blank");
      return;
    }
    setInfoModal(INFO_CONTENT[action]);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveError("");
    let imageUrl = fp.profile_image_url;
    let photoWarn = "";
    if (photoFile && session?.user?.id) {
      try {
        imageUrl = await uploadProfileImg(photoFile, session.user.id);
      } catch (uploadErr) {
        // Don't block the save — other profile fields still update.
        photoWarn = `Photo upload failed: ${uploadErr.message}`;
      }
    }
    const { error } = await setProfile({ ...fp, profile_image_url: imageUrl });
    setSaving(false);
    if (error) {
      setSaveError(error.message || "Failed to save. Please try again.");
      return;
    }
    if (photoWarn) {
      setSaveError(photoWarn);
      return;
    }
    setEditProfile(false);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase?.auth.signOut();
  };

  const toggleDark = () => setProfile(p => ({ ...p, dark_mode: !p.dark_mode }));

  const initials  = profile.owner_name?.[0]?.toUpperCase() || "A";
  const avatarSrc = photoPreview || profile.profile_image_url;

  return (
    <div className="px-5 pt-5 pb-28 screen-enter">
      <h1 className="text-xl font-bold text-slate-800 dark:text-white mb-5">Settings</h1>

      {/* Profile card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700 mb-4 overflow-hidden">
        {/* Avatar + name row */}
        <div className="flex items-center gap-4 px-4 pt-4 pb-3">
          {profile.profile_image_url ? (
            <img src={profile.profile_image_url} alt="Profile"
              className="w-16 h-16 rounded-2xl object-cover shadow-sm flex-shrink-0 border-2 border-green-100 dark:border-green-900" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl shadow-sm flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-slate-900 dark:text-white truncate text-lg leading-tight">{profile.owner_name || "—"}</p>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">{profile.business_name || "—"}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{session?.user?.email}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100 dark:border-slate-700 mx-4" />

        {/* Detail rows */}
        <div className="px-4 py-3 space-y-2.5">
          {[
            { label: "Phone",    value: profile.phone         || "—" },
            { label: "Gender",   value: profile.gender        || "—" },
            { label: "Address",  value: profile.address       || "—" },
            { label: "State",    value: [profile.state, profile.lga].filter(Boolean).join(" · ") || "—" },
            { label: "Currency", value: profile.currency      || "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 w-20 pt-0.5">{label}</span>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200 text-right flex-1 break-words">{value}</span>
            </div>
          ))}
        </div>

        {/* Edit button */}
        <div className="px-4 pb-4">
          <button onClick={openEdit}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors">
            Edit Profile
          </button>
        </div>
      </div>

      {/* Subscription plan card */}
      {(() => {
        const meta = PLANS_META[plan] || PLANS_META.starter;

        const accentMap = {
          gray:   { badge: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300", check: "text-slate-400", ring: "border-slate-200 dark:border-slate-700" },
          green:  { badge: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400", check: "text-green-500", ring: "border-green-200 dark:border-green-800" },
          purple: { badge: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400", check: "text-purple-500", ring: "border-purple-200 dark:border-purple-800" },
        };
        const accent = accentMap[meta.color];

        const PLAN_FEATURES = {
          starter: [
            "Up to 100 transactions/month",
            "Basic profit & loss reports",
            "Credit sales tracking",
            "Customer records",
            "1 user account",
          ],
          business: [
            "Unlimited transactions",
            "All Starter features",
            "Aso savings management",
            "PDF report export",
            "Advanced analytics dashboard",
            "Email support",
          ],
          premium: [
            "Everything in Business",
            "AI-powered business insights",
            "WhatsApp payment reminders",
            "Priority customer support",
            "Multi-device access",
            "Custom business branding",
          ],
        };

        const features = PLAN_FEATURES[plan] || PLAN_FEATURES.starter;

        return (
          <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-card border mb-4 overflow-hidden ${accent.ring}`}>
            {/* Plan header */}
            <div className="flex items-center gap-3 px-4 pt-4 pb-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                <span className="text-xl">{plan === "premium" ? "⭐" : plan === "business" ? "💼" : "🆓"}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Current Plan</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-base">{meta.name}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${accent.badge}`}>{meta.badge}</span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100 dark:border-slate-700 mx-4" />

            {/* Features list */}
            <div className="px-4 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">What's included</p>
              {features.map((f) => (
                <div key={f} className="flex items-center gap-2.5">
                  <svg className={`w-4 h-4 flex-shrink-0 ${accent.check}`} viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs text-slate-600 dark:text-slate-300">{f}</span>
                </div>
              ))}
            </div>

            {/* Upgrade button */}
            {plan !== "premium" && (
              <div className="px-4 pb-4 pt-1">
                <button onClick={onUpgrade}
                  className="w-full py-2.5 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-700 text-white transition-colors active:scale-95">
                  Upgrade Plan
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Store banner */}
      {profile.store_image_url && (
        <div className="mb-4 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700 h-28">
          <img src={profile.store_image_url} alt="Store" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Dark mode toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700 mb-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">Dark Mode</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Easier on the eyes at night</p>
        </div>
        <button onClick={toggleDark} role="switch" aria-checked={!!profile.dark_mode}
          className={`w-12 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none ${profile.dark_mode ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
          <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200"
            style={{ left: profile.dark_mode ? "calc(100% - 22px)" : "2px" }} />
        </button>
      </div>

      {/* Menu group */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700 overflow-hidden mb-4 divide-y divide-slate-50 dark:divide-slate-700">
        <MenuRow label="Notifications" sub="Manage reminders & alerts"
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>}
          onClick={() => handleMenuAction("notify")} />
        <MenuRow label="Privacy Policy" sub="How we handle your data"
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z" /></svg>}
          onClick={() => handleMenuAction("privacy")} />
        <MenuRow label="Terms of Service" sub="App usage terms"
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>}
          onClick={() => handleMenuAction("terms")} />
        <MenuRow label="Help & Support" sub="WhatsApp or email us"
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500 dark:text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>}
          onClick={() => handleMenuAction("help")} />
      </div>

      {/* Sign out */}
      <button onClick={handleSignOut} disabled={signingOut}
        className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-800 hover:bg-red-100 disabled:opacity-60 transition-colors">
        {signingOut ? "Signing out…" : "Sign Out"}
      </button>

      <p className="text-center text-[11px] text-slate-300 dark:text-slate-600 mt-5 font-medium">
        KudiAI Track v1.0 · Made with ♥ for Nigerian traders
      </p>

      {/* Info modal */}
      {infoModal && (
        <Modal title={infoModal.title} onClose={() => setInfoModal(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{infoModal.body}</p>
          <button onClick={() => setInfoModal(null)}
            className="w-full mt-5 py-3 bg-brand-600 text-white rounded-xl font-bold text-sm hover:bg-brand-700 transition-colors">
            Got it
          </button>
        </Modal>
      )}

      {/* Edit profile modal */}
      {editProfile && (
        <Modal title="Edit Profile" onClose={() => setEditProfile(false)}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

            {/* Profile photo */}
            <div className="flex flex-col items-center">
              <label className="relative cursor-pointer">
                <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center border-2 border-green-200">
                  {avatarSrc
                    ? <img src={avatarSrc} alt="profile" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
                  }
                </div>
                <span className="absolute bottom-0 right-0 bg-green-600 rounded-full p-1 shadow">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
              <p className="text-xs text-gray-400 mt-1.5">Tap to change photo</p>
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Full Name</label>
              <input value={fp.owner_name || ""} placeholder="Your full name"
                onChange={e => setFp(p => ({ ...p, owner_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" />
            </div>

            {/* Business Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Business Name</label>
              <input value={fp.business_name || ""} placeholder="Your business name"
                onChange={e => setFp(p => ({ ...p, business_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" />
            </div>

            {/* Gender */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Gender</label>
              <select value={fp.gender || ""} onChange={e => setFp(p => ({ ...p, gender: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100">
                <option value="">Select gender…</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            {/* Date of Birth */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Date of Birth</label>
              <input type="date" value={fp.date_of_birth || ""} max={new Date().toISOString().split("T")[0]}
                onChange={e => setFp(p => ({ ...p, date_of_birth: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" />
            </div>

            {/* NIN */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">NIN</label>
              <input type="text" inputMode="numeric" placeholder="11-digit NIN" value={fp.nin || ""}
                onChange={e => setFp(p => ({ ...p, nin: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" />
            </div>

            {/* Phone */}
            <Field label="Phone Number" type="tel" value={fp.phone || ""}
              onChange={e => setFp(p => ({ ...p, phone: e.target.value }))} placeholder="08012345678" />

            {/* Address */}
            <Field label="Business Address" value={fp.address || ""}
              onChange={e => setFp(p => ({ ...p, address: e.target.value }))} placeholder="12 Market Road, Onitsha" />

            {/* State */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">State</label>
              <select value={fp.state || ""} onChange={(e) => handleStateChange(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100">
                <option value="">Select State…</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* LGA */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">LGA</label>
              <select value={fp.lga || ""} onChange={(e) => handleLgaChange(e.target.value)} disabled={!fp.state}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">{fp.state ? "Select LGA…" : "Select state first"}</option>
                {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {/* Ward */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Ward</label>
              <select value={fp.ward || ""} onChange={(e) => setFp(p => ({ ...p, ward: e.target.value }))} disabled={!fp.lga}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">{fp.lga ? "Select Ward…" : "Select LGA first"}</option>
                {wards.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>

            {saveError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</div>
            )}

            <button onClick={handleSaveProfile} disabled={saving}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 transition-colors">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
