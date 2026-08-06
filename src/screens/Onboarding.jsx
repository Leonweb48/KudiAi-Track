import { useState, useRef } from "react";
import { supabase } from "../utils/supabase";
import Field from "../components/shared/Field";
import { AuthShell } from "../components/AuthShell";
import AppLogo from "../components/AppLogo";
import { sendEmailTrigger } from "../utils/emailTrigger";
import { compressImage } from "../utils/compressImage";

/* ── Helpers ───────────────────────────────────────────────────── */
async function uploadFile(file, bucket, path) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Returns the custom text when "Other" is picked, otherwise the selected value
const actual = (sel, other) => (sel === "Other" ? (other.trim() || "Other") : sel);

/* ── Main component ────────────────────────────────────────────── */
export default function Onboarding({ session, onComplete }) {
  const [step,         setStep]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [needsSignOut, setNeedsSignOut] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const email    = session?.user?.email || "";
  const fullName = session?.user?.user_metadata?.full_name || "";
  const firstName = fullName.split(" ")[0] || email.split("@")[0];

  /* ── Step 1 — Photo + Phone (required) ─────────── */
  const [phone,          setPhone]          = useState("");
  const [profileFile,    setProfileFile]    = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const photoRef = useRef(null);

  /* ── Step 2 — Business (all optional except name) ─ */
  const [logoFile,    setLogoFile]    = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [bizName,     setBizName]     = useState("");

  /* ── Fields kept in state for DB write, not shown in UI ── */
  // These are set to defaults/null and remain editable in Settings/Profile later.
  const homeAddress = "";
  const gender      = "";
  const dob         = "";
  const nin         = "";
  const state_      = "";
  const lga         = "";
  const ward        = "";
  const bizType     = "";
  const bizTypeOther = "";
  const regStatus    = "";
  const regStatusOther = "";
  const countryOfReg = "";
  const countryOfRegOther = "";
  const currency     = "Nigerian Naira (₦)";
  const industry     = "";
  const industryOther = "";
  const bizSize      = "";
  const bizSizeOther = "";
  const productsType = "";
  const productsTypeOther = "";
  const targetMarket = "";
  const targetMarketOther = "";
  const operatingModel = "";
  const operatingModelOther = "";
  const bizCountry   = "Nigeria";
  const bizState     = "";
  const bizLga       = "";
  const bizWard      = "";
  const bizAddress   = "";
  const regDocType   = "";
  const regDocTypeOther = "";
  const regDocFile   = null;

  /* ── Handlers ───────────────────────────────────── */
  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Photo must be under 5 MB."); return; }
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
    setError("");
  };

  const handleStep1 = (e) => {
    e.preventDefault();
    setError("");
    if (!profileFile) { setError("Please upload a profile photo to continue."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bizName.trim()) { setError("Business name is required."); return; }

    setLoading(true); setError(""); setNeedsSignOut(false); setProfileSaved(false);

    try {
      const { data: { user: liveUser }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !liveUser) { await supabase.auth.signOut(); return; }

      const uid = liveUser.id;
      let profileImageUrl = null;
      let photoFailed     = false;

      if (profileFile) {
        try {
          const compressed = await compressImage(profileFile, 900);
          profileImageUrl = await uploadFile(compressed, "avatars", `${uid}/profile`);
        } catch { photoFailed = true; }
      }

      let storeImageUrl = null;
      if (logoFile) {
        try {
          const compressed = await compressImage(logoFile, 900);
          storeImageUrl = await uploadFile(compressed, "avatars", `${uid}/store`);
        } catch { /* silent — non-critical */ }
      }

      // Registration document — not shown in minimal UI; docUrl stays null
      let docUrl = null;
      const docTypeVal = actual(regDocType, regDocTypeOther);
      if (regDocFile && docTypeVal && docTypeVal !== "None") {
        try {
          const ext = regDocFile.name.split(".").pop();
          docUrl = await uploadFile(regDocFile, "business-docs", `${uid}/reg-doc.${ext}`);
        } catch { /* silent */ }
      }

      const { error: dbErr } = await supabase.from("profiles").upsert({
        id:                      uid,
        full_name:               fullName || email.split("@")[0],
        email:                   liveUser.email || email,
        phone,
        gender,
        date_of_birth:           dob || null,
        nin,
        address:                 homeAddress,
        state:                   state_,
        lga,
        ward,
        currency,
        dark_mode:               false,
        profile_image_url:       profileImageUrl,
        store_image_url:         storeImageUrl,
        business_name:           bizName,
        business_type:           actual(bizType, bizTypeOther)          || null,
        reg_status:              actual(regStatus, regStatusOther)       || null,
        country_of_registration: actual(countryOfReg, countryOfRegOther) || null,
        industry:                actual(industry, industryOther)         || null,
        business_size:           actual(bizSize, bizSizeOther)           || null,
        products_services_type:  actual(productsType, productsTypeOther)       || null,
        target_market:           actual(targetMarket, targetMarketOther)        || null,
        operating_model:         actual(operatingModel, operatingModelOther)    || null,
        business_country:        bizCountry || null,
        business_state:          bizState   || null,
        business_lga:            bizLga     || null,
        business_ward:           bizWard    || null,
        business_address:        bizAddress || null,
        reg_doc_type:            docTypeVal || null,
        reg_doc_url:             docUrl,
      }, { onConflict: "id" });

      if (dbErr) {
        if (dbErr.message?.toLowerCase().includes("foreign key") || dbErr.code === "23503") {
          setNeedsSignOut(true);
          setError("Database issue — please sign out and sign back in.");
        } else {
          throw dbErr;
        }
        return;
      }

      if (photoFailed) {
        setProfileSaved(true);
        setError(
          "Profile saved! However, your photo couldn't be uploaded — " +
          "the 'avatars' storage bucket may be missing in Supabase. " +
          "You can add your photo later in Settings."
        );
        return;
      }

      sendEmailTrigger("business_registered", {
        email:         session.user.email,
        name:          fullName || session.user.user_metadata?.full_name || session.user.email.split("@")[0],
        business_name: bizName || "",
      });

      onComplete();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell variant="page">
      <div className="w-full max-w-md flex flex-col min-h-screen mx-auto">

        {/* ── Warm colourful header ─────────────────────────────── */}
        <div
          className="px-5 pb-8 flex flex-col items-center"
          style={{
            paddingTop: "max(40px, env(safe-area-inset-top, 40px))",
            background: step === 1
              ? "linear-gradient(135deg, #f97316 0%, #fb923c 100%)"
              : "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)",
            transition: "background 0.4s ease",
          }}
        >
          <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-4 py-2 shadow-sm mb-4">
            <AppLogo className="h-8 w-auto" />
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-4">
            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
              step === 1 ? "bg-white text-orange-600 shadow-sm" : "bg-white/25 text-white/80"
            }`}>
              {step > 1
                ? <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                : <span>1</span>
              }
              <span>You</span>
            </div>
            <div className={`w-5 h-px transition-all duration-300 ${step === 2 ? "bg-white" : "bg-white/30"}`} />
            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
              step === 2 ? "bg-white text-green-600 shadow-sm" : "bg-white/25 text-white/80"
            }`}>
              <span>2</span>
              <span>Your Business</span>
            </div>
          </div>

          {step === 1 ? (
            <>
              <p className="text-white text-xl font-bold text-center">Hi {firstName}!</p>
              <p className="text-white/80 text-sm text-center mt-1">Just 2 things and you're in</p>
            </>
          ) : (
            <>
              <p className="text-white text-xl font-bold text-center">Almost done!</p>
              <p className="text-white/80 text-sm text-center mt-1">Tell us about your business</p>
            </>
          )}
        </div>

        {/* ── Step 1 — Photo + Phone ───────────────────────────── */}
        {step === 1 && (
          <>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            <form onSubmit={handleStep1} className="flex-1 overflow-y-auto px-5 py-6 space-y-5 bg-white dark:bg-slate-900">

              {/* Account context row */}
              <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/30 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0 text-base">
                  👤
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{fullName || email.split("@")[0]}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{email}</p>
                </div>
              </div>

              {/* Photo upload */}
              <div className="flex flex-col items-center py-2">
                <div
                  className="relative cursor-pointer group"
                  onClick={() => photoRef.current?.click()}
                >
                  <div className={`w-24 h-24 rounded-full overflow-hidden flex items-center justify-center transition-all ${
                    profilePreview
                      ? "ring-4 ring-orange-400 ring-offset-2 dark:ring-offset-slate-900"
                      : "bg-orange-50 dark:bg-slate-800 border-2 border-dashed border-orange-300 dark:border-orange-800 group-hover:border-orange-400"
                  }`}>
                    {profilePreview
                      ? <img src={profilePreview} alt="profile" className="w-full h-full object-cover" />
                      : <div className="flex flex-col items-center gap-1 text-orange-400 dark:text-orange-700">
                          <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="text-[10px] font-semibold">Tap to upload</span>
                        </div>
                    }
                  </div>
                  <span className="absolute bottom-0 right-0 bg-orange-500 rounded-full p-1.5 shadow-md ring-2 ring-white dark:ring-slate-900">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-3">
                  Profile photo <span className="text-red-500">*</span>
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Your account avatar · up to 5 MB, compressed before upload</p>
              </div>

              {/* Phone */}
              <Field label="Phone Number" required
                type="tel" placeholder="08012345678" value={phone}
                onChange={(e) => setPhone(e.target.value)} inputMode="tel" />

              {error && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</div>
              )}

              <button type="submit"
                className="w-full font-bold rounded-2xl py-4 text-base text-white active:scale-[0.98] transition-all"
                style={{ background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)" }}>
                Next — Your Business →
              </button>
            </form>
          </>
        )}

        {/* ── Step 2 — Business Name + Logo ───────────────────── */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-6 pb-12 bg-white dark:bg-slate-900 space-y-5">

            <button type="button" onClick={() => { setStep(1); setError(""); }}
              className="flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 -mt-1 mb-1">
              ← Back
            </button>

            {/* Business Name */}
            <Field label="Business Name" required
              placeholder="e.g. Adaeze Fabrics & Co."
              value={bizName} onChange={(e) => setBizName(e.target.value)} />

            {/* Business Logo — optional */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Business Logo
                  <span className="ml-1.5 text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
                </label>
                <span className="text-xs text-slate-400 dark:text-slate-500">Used on invoices</span>
              </div>
              <label className="flex items-center gap-4 cursor-pointer group">
                <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 group-hover:border-green-400 dark:group-hover:border-green-600 overflow-hidden flex-shrink-0 transition-colors bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                  {logoPreview
                    ? <img src={logoPreview} alt="Business logo" className="w-full h-full object-cover" />
                    : <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    {logoFile ? logoFile.name : "Tap to upload logo"}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">JPG or PNG · up to 5 MB</p>
                  {logoPreview && (
                    <button type="button"
                      onClick={(e) => { e.preventDefault(); setLogoFile(null); setLogoPreview(null); }}
                      className="text-xs text-red-500 mt-1 hover:text-red-700">
                      Remove
                    </button>
                  )}
                </div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files[0];
                    if (!f) return;
                    if (f.size > 5 * 1024 * 1024) { setError("Logo must be under 5 MB."); return; }
                    setLogoFile(f);
                    setLogoPreview(URL.createObjectURL(f));
                    setError("");
                  }}
                />
              </label>
            </div>

            {/* Reassurance note */}
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 rounded-xl px-4 py-3">
              <p className="text-xs text-green-800 dark:text-green-300 leading-relaxed">
                Your address, business type, industry, and more can be filled in from your profile after setup — nothing is lost by skipping them now.
              </p>
            </div>

            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</div>
            )}
            {needsSignOut && (
              <button type="button" onClick={() => supabase.auth.signOut()}
                className="w-full border-2 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-bold rounded-2xl py-3.5 text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                Sign Out &amp; Try Again
              </button>
            )}
            {profileSaved ? (
              <button type="button" onClick={onComplete}
                className="w-full text-white font-bold rounded-2xl py-4 text-base active:scale-[0.98] transition-all"
                style={{ background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)" }}>
                Continue →
              </button>
            ) : (
              <button type="submit" disabled={loading || needsSignOut}
                className="w-full text-white font-bold rounded-2xl py-4 text-base active:scale-[0.98] transition-all disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)" }}>
                {loading ? "Setting up your account…" : "Get started →"}
              </button>
            )}
          </form>
        )}

      </div>
    </AuthShell>
  );
}
