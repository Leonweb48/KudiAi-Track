import { useState } from "react";
import { supabase } from "../utils/supabase";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import AppLogo from "../components/AppLogo";

const CURRENCIES = ["Nigerian Naira (₦)", "US Dollar ($)", "British Pound (£)", "Euro (€)"];
const GENDERS    = ["Male", "Female", "Prefer not to say"];

async function uploadImg(file, bucket, path) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function InputField({ label, required: req, children, hint, ...props }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{req && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children || (
        <input
          className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          {...props}
        />
      )}
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function SelectField({ label, required: req, value, onChange, disabled, placeholder, options }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{req && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        required={req}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function Onboarding({ session, onComplete }) {
  const [step,             setStep]             = useState(1);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState("");
  const [needsSignOut,     setNeedsSignOut]     = useState(false);
  const [profileSaved,     setProfileSaved]     = useState(false); // saved but photo failed

  const email    = session?.user?.email || "";
  const fullName = session?.user?.user_metadata?.full_name || "";

  // Step 1 — personal
  const [gender,  setGender]  = useState("");
  const [dob,     setDob]     = useState("");
  const [nin,     setNin]     = useState("");
  const [profileFile,    setProfileFile]    = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);

  // Step 2 — business
  const [bizName,  setBizName]  = useState("");
  const [phone,    setPhone]    = useState("");
  const [address,  setAddress]  = useState("");
  const [state,    setState_]   = useState("");
  const [lga,      setLga]      = useState("");
  const [ward,     setWard]     = useState("");
  const [currency, setCurrency] = useState(CURRENCIES[0]);

  const lgas  = getLGAs(state);
  const wards = getWards(state, lga);

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
  };

  const handleStateChange = (s) => { setState_(s); setLga(""); setWard(""); };
  const handleLgaChange   = (l) => { setLga(l);   setWard(""); };

  const handleStep1 = (e) => {
    e.preventDefault();
    setError("");
    if (!profileFile) { setError("Please upload a profile photo to continue."); return; }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bizName.trim()) { setError("Business name is required."); return; }
    if (!state)          { setError("Please select your state."); return; }
    if (!lga)            { setError("Please select your LGA."); return; }

    setLoading(true);
    setError("");
    setNeedsSignOut(false);
    setProfileSaved(false);
    try {
      // Re-verify the session is live before writing — catches stale JWTs
      const { data: { user: liveUser }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !liveUser) {
        await supabase.auth.signOut();
        return; // useAuth detects sign-out → shows Auth screen
      }

      const uid = liveUser.id;
      let profileImageUrl = null;
      let photoFailed = false;
      if (profileFile) {
        try {
          profileImageUrl = await uploadImg(profileFile, "avatars", `${uid}/profile`);
        } catch {
          photoFailed = true;
        }
      }

      const { error: dbErr } = await supabase.from("profiles").upsert({
        id:                uid,
        full_name:         fullName || email.split("@")[0],
        email:             liveUser.email || email,
        gender,
        date_of_birth:     dob || null,
        nin,
        phone,
        business_name:     bizName,
        address,
        state,
        lga,
        ward,
        currency,
        profile_image_url: profileImageUrl,
        dark_mode:         false,
      }, { onConflict: "id" });

      if (dbErr) {
        if (dbErr.message?.toLowerCase().includes("foreign key") || dbErr.code === "23503") {
          setNeedsSignOut(true);
          setError(
            "Database setup issue: the profiles table is missing required RLS policies. " +
            "Please run the SQL from the setup guide, then sign out and sign back in."
          );
        } else {
          throw dbErr;
        }
        return;
      }

      if (photoFailed) {
        // Profile saved — just the photo didn't upload. Let user acknowledge before continuing.
        setProfileSaved(true);
        setError(
          "Your profile was saved, but the photo could not be uploaded because the " +
          "'avatars' storage bucket is missing in Supabase. " +
          "Go to Supabase → Storage → New bucket → name 'avatars' → enable Public → Create. " +
          "You can add your photo in Settings once the bucket is ready."
        );
        return;
      }

      onComplete();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center">
      <div className="w-full max-w-md flex flex-col min-h-screen">

        {/* Header */}
        <div className="bg-green-600 px-5 pt-10 pb-6 flex flex-col items-center">
          <div className="bg-white rounded-2xl px-4 py-2 shadow-sm mb-2">
            <AppLogo className="h-9 w-auto" />
          </div>
          <h1 className="text-lg font-bold text-white mt-1">Set Up Your Profile</h1>
          <p className="text-green-100 text-xs mt-1">Step {step} of 2 — {step === 1 ? "Personal Information" : "Business Information"}</p>
          {/* Progress bar */}
          <div className="flex gap-1.5 mt-4 w-full max-w-xs">
            <div className="flex-1 h-1 rounded-full bg-white" />
            <div className={`flex-1 h-1 rounded-full transition-colors ${step === 2 ? "bg-white" : "bg-white/30"}`} />
          </div>
        </div>

        {/* Step 1 — Personal */}
        {step === 1 && (
          <form onSubmit={handleStep1} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 pb-10 bg-white">

            {/* Profile photo — required */}
            <div className="flex flex-col items-center pb-2">
              <label className="relative cursor-pointer group">
                <div className={`w-28 h-28 rounded-full overflow-hidden flex items-center justify-center transition-all
                  ${profilePreview
                    ? "border-2 border-green-500"
                    : "bg-gray-50 border-2 border-dashed border-gray-300 group-hover:border-green-400"}`}>
                  {profilePreview
                    ? <img src={profilePreview} alt="profile" className="w-full h-full object-cover" />
                    : <div className="flex flex-col items-center gap-1 text-gray-400">
                        <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-[10px] font-semibold">Tap to upload</span>
                      </div>
                  }
                </div>
                <span className="absolute bottom-1 right-1 bg-green-600 rounded-full p-1.5 shadow-md">
                  <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </label>
              <p className="text-xs font-semibold text-gray-600 mt-2">
                Profile Photo <span className="text-red-500">*</span>
              </p>
              <p className="text-[10px] text-gray-400">Required — used as your account avatar</p>
            </div>

            {/* Full Name — locked */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
              <input readOnly value={fullName || email.split("@")[0]}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
            </div>

            {/* Email — locked */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address</label>
              <input readOnly value={email}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
            </div>

            {/* Gender */}
            <SelectField
              label="Gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              placeholder="Select gender…"
              options={GENDERS}
            />

            {/* Date of Birth */}
            <InputField label="Date of Birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)}
              max={new Date().toISOString().split("T")[0]} />

            {/* NIN */}
            <InputField
              label="National Identity Number (NIN)"
              placeholder="Enter your 11-digit NIN"
              value={nin}
              onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
              inputMode="numeric"
              hint="Your NIN is kept private and secure"
            />

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
            )}

            <button type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
              Next — Business Info →
            </button>
          </form>
        )}

        {/* Step 2 — Business */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 pb-10 bg-white">

            <button type="button" onClick={() => { setStep(1); setError(""); }}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 -mt-1 mb-1">
              ← Back
            </button>

            {/* Business Name */}
            <InputField label="Business / Store Name" required
              placeholder="e.g. Adaeze Fabrics & Co."
              value={bizName} onChange={(e) => setBizName(e.target.value)} />

            {/* Phone */}
            <InputField label="Phone Number" type="tel"
              placeholder="08012345678"
              value={phone} onChange={(e) => setPhone(e.target.value)} />

            {/* Address */}
            <InputField label="Business Address"
              placeholder="e.g. 12 Market Road, Onitsha"
              value={address} onChange={(e) => setAddress(e.target.value)} />

            {/* State */}
            <SelectField label="State" required
              value={state} onChange={(e) => handleStateChange(e.target.value)}
              placeholder="Select State…" options={STATES} />

            {/* LGA */}
            <SelectField label="Local Government Area (LGA)" required
              value={lga} onChange={(e) => handleLgaChange(e.target.value)}
              disabled={!state}
              placeholder={state ? "Select LGA…" : "Select state first"}
              options={lgas} />

            {/* Ward */}
            <SelectField label="Ward"
              value={ward} onChange={(e) => setWard(e.target.value)}
              disabled={!lga}
              placeholder={lga ? "Select Ward…" : "Select LGA first"}
              options={wards} />

            {/* Currency */}
            <SelectField label="Currency"
              value={currency} onChange={(e) => setCurrency(e.target.value)}
              placeholder="" options={CURRENCIES} />

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
            )}

            {needsSignOut && (
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className="w-full border-2 border-red-300 text-red-600 font-bold rounded-xl py-3 text-sm hover:bg-red-50 transition-colors"
              >
                Sign Out &amp; Try Again
              </button>
            )}

            {profileSaved ? (
              <button
                type="button"
                onClick={onComplete}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-3.5 text-sm transition-colors"
              >
                Continue to Plans →
              </button>
            ) : (
              <button type="submit" disabled={loading || needsSignOut}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
                {loading ? "Setting up your account…" : "Get Started"}
              </button>
            )}
          </form>
        )}

      </div>
    </div>
  );
}
