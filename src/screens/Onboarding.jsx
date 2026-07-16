import { useState } from "react";
import { supabase } from "../utils/supabase";
import Field from "../components/shared/Field";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { AuthShell } from "../components/AuthShell";
import AppLogo from "../components/AppLogo";
import { sendEmailTrigger } from "../utils/emailTrigger";
import { maxDobDate, isAtLeast18, AGE_ERROR } from "../utils/ageValidation";

/* ── Constants ─────────────────────────────────────────────────── */
const CURRENCIES = ["Nigerian Naira (₦)", "US Dollar ($)", "British Pound (£)", "Euro (€)"];
const GENDERS    = ["Male", "Female", "Prefer not to say"];

const COUNTRIES = [
  "Nigeria",
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan",
  "Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize",
  "Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil",
  "Brunei","Bulgaria","Burkina Faso","Burundi",
  "Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo (Brazzaville)",
  "Congo (Kinshasa)","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic",
  "Denmark","Djibouti","Dominica","Dominican Republic",
  "Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia",
  "Eswatini","Ethiopia",
  "Fiji","Finland","France",
  "Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada",
  "Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary",
  "Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
  "Jamaica","Japan","Jordan",
  "Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein",
  "Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta",
  "Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia",
  "Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
  "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger",
  "North Korea","North Macedonia","Norway",
  "Oman",
  "Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay",
  "Peru","Philippines","Poland","Portugal",
  "Qatar",
  "Romania","Russia","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines",
  "Samoa","San Marino","São Tomé and Príncipe","Saudi Arabia","Senegal",
  "Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia",
  "Solomon Islands","Somalia","South Africa","South Korea","South Sudan",
  "Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga",
  "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
  "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States",
  "Uruguay","Uzbekistan",
  "Vanuatu","Vatican City","Venezuela","Vietnam",
  "Yemen","Zambia","Zimbabwe",
];

const BIZ_TYPES = [
  "Sole Proprietorship","Partnership",
  "Limited Liability Company (LLC)",
  "Non-Governmental Organization (NGO)",
  "Cooperative","Startup",
];
const REG_STATUSES   = ["Registered","Unregistered","In Process"];
const INDUSTRIES     = [
  "Agriculture","Education","Health","Technology","Finance",
  "Retail & Commerce","Manufacturing","Logistics & Transport",
  "Creative & Media","Energy","Construction",
];
const BIZ_SIZES      = [
  "Micro (1–9 employees)","Small (10–49 employees)",
  "Medium (50–249 employees)","Large (250+ employees)",
];
const PRODUCTS_TYPES = ["Physical Products","Digital Products","Services","Hybrid"];
const TARGET_MARKETS = ["Individuals (B2C)","Businesses (B2B)","Government","International Market"];
const OP_MODELS      = ["Online","Physical Store","Hybrid","Field-Based"];
const DOC_TYPES      = ["CAC Certificate","Tax Certificate","Business License","None"];

/* ── Helpers ───────────────────────────────────────────────────── */
async function uploadFile(file, bucket, path) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Returns the custom text when "Other" is picked, otherwise the selected value
const actual = (sel, other) => (sel === "Other" ? (other.trim() || "Other") : sel);


function Select({ label, required: req, value, onChange, disabled, placeholder, options }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
        {label}{req && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        required={req} value={value} onChange={onChange} disabled={disabled}
        className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-900 dark:text-white
          disabled:bg-gray-50 dark:disabled:bg-slate-800 disabled:text-gray-400 dark:disabled:text-slate-500"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// Dropdown that appends "Other (please specify)" and reveals a text input
function DrpOther({ label, required: req, value, onChange, otherValue, onOtherChange, options, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
        {label}{req && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-900 dark:text-white"
      >
        <option value="">{placeholder || "Select…"}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="Other">Other (please specify)</option>
      </select>
      {value === "Other" && (
        <input
          type="text"
          autoFocus
          placeholder="Please specify…"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          className="mt-2 w-full border border-green-400 dark:border-green-700 rounded-xl px-3 py-2.5 text-sm
            focus:outline-none focus:ring-2 focus:ring-green-500 bg-green-50 dark:bg-green-950/30 placeholder-green-400 dark:text-white"
        />
      )}
    </div>
  );
}

function SectionHead({ emoji, title }) {
  return (
    <div className="flex items-center gap-2.5 pt-3 pb-0.5 border-t-2 border-gray-100 dark:border-slate-800 mt-1">
      <div className="w-7 h-7 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-base flex-shrink-0">
        {emoji}
      </div>
      <p className="text-[11px] font-bold text-green-700 dark:text-green-400 uppercase tracking-widest">{title}</p>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */
export default function Onboarding({ session, onComplete }) {
  const [step,         setStep]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [needsSignOut, setNeedsSignOut] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const email    = session?.user?.email || "";
  const fullName = session?.user?.user_metadata?.full_name || "";

  /* ── Step 1 — Personal / KYC ───────────────────── */
  const [phone,          setPhone]          = useState("");
  const [homeAddress,    setHomeAddress]    = useState("");
  const [gender,         setGender]         = useState("");
  const [dob,            setDob]            = useState("");
  const [state,          setState_]         = useState("");
  const [lga,            setLga]            = useState("");
  const [ward,           setWard]           = useState("");
  const [nin,            setNin]            = useState("");
  const [profileFile,    setProfileFile]    = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);

  /* ── Step 2 — Business Identity ────────────────── */
  const [bizName,            setBizName]            = useState("");
  const [bizType,            setBizType]            = useState("");
  const [bizTypeOther,       setBizTypeOther]       = useState("");
  const [regStatus,          setRegStatus]          = useState("");
  const [regStatusOther,     setRegStatusOther]     = useState("");
  const [countryOfReg,       setCountryOfReg]       = useState("");
  const [countryOfRegOther,  setCountryOfRegOther]  = useState("");
  const [currency,           setCurrency]           = useState(CURRENCIES[0]);

  /* ── Step 2 — Industry ──────────────────────────── */
  const [industry,        setIndustry]        = useState("");
  const [industryOther,   setIndustryOther]   = useState("");
  const [bizSize,         setBizSize]         = useState("");
  const [bizSizeOther,    setBizSizeOther]    = useState("");

  /* ── Step 2 — Operations ────────────────────────── */
  const [productsType,        setProductsType]        = useState("");
  const [productsTypeOther,   setProductsTypeOther]   = useState("");
  const [targetMarket,        setTargetMarket]        = useState("");
  const [targetMarketOther,   setTargetMarketOther]   = useState("");
  const [operatingModel,      setOperatingModel]      = useState("");
  const [operatingModelOther, setOperatingModelOther] = useState("");

  /* ── Step 2 — Business Location ────────────────── */
  const [bizCountry, setBizCountry] = useState("Nigeria");
  const [bizState,   setBizState]   = useState("");
  const [bizLga,     setBizLga]     = useState("");
  const [bizWard,    setBizWard]    = useState("");
  const [bizAddress, setBizAddress] = useState("");

  /* ── Step 2 — Verification (optional) ──────────── */
  const [regDocType,      setRegDocType]      = useState("");
  const [regDocTypeOther, setRegDocTypeOther] = useState("");
  const [regDocFile,      setRegDocFile]      = useState(null);
  const [regDocName,      setRegDocName]      = useState("");

  /* ── Derived location options ───────────────────── */
  const lgas     = getLGAs(state);
  const wards    = getWards(state, lga);
  const bizLgas  = bizCountry === "Nigeria" ? getLGAs(bizState)  : [];
  const bizWards = bizCountry === "Nigeria" ? getWards(bizState, bizLga) : [];

  /* ── Handlers ───────────────────────────────────── */
  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
  };

  const handleStateChange    = (s) => { setState_(s); setLga("");    setWard(""); };
  const handleLgaChange      = (l) => { setLga(l);   setWard(""); };
  const handleBizStateChange = (s) => { setBizState(s); setBizLga(""); setBizWard(""); };
  const handleBizLgaChange   = (l) => { setBizLga(l);  setBizWard(""); };

  const handleStep1 = (e) => {
    e.preventDefault();
    setError("");
    if (!profileFile) { setError("Please upload a profile photo to continue."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    if (dob && !isAtLeast18(dob)) { setError(AGE_ERROR); return; }
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
          profileImageUrl = await uploadFile(profileFile, "avatars", `${uid}/profile`);
        } catch { photoFailed = true; }
      }

      // Upload business registration document (optional — ignore failure silently)
      let docUrl = null;
      const docTypeVal = actual(regDocType, regDocTypeOther);
      if (regDocFile && docTypeVal && docTypeVal !== "None") {
        try {
          const ext = regDocFile.name.split(".").pop();
          docUrl = await uploadFile(regDocFile, "business-docs", `${uid}/reg-doc.${ext}`);
        } catch { /* silent — non-critical */ }
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
        state,
        lga,
        ward,
        currency,
        dark_mode:               false,
        profile_image_url:       profileImageUrl,
        // Business identity
        business_name:           bizName,
        business_type:           actual(bizType, bizTypeOther)          || null,
        reg_status:              actual(regStatus, regStatusOther)       || null,
        country_of_registration: actual(countryOfReg, countryOfRegOther) || null,
        // Industry
        industry:                actual(industry, industryOther)         || null,
        business_size:           actual(bizSize, bizSizeOther)           || null,
        // Operations
        products_services_type:  actual(productsType, productsTypeOther)       || null,
        target_market:           actual(targetMarket, targetMarketOther)        || null,
        operating_model:         actual(operatingModel, operatingModelOther)    || null,
        // Business location
        business_country:        bizCountry || null,
        business_state:          bizState   || null,
        business_lga:            bizLga     || null,
        business_ward:           bizWard    || null,
        business_address:        bizAddress || null,
        // Verification
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

      // Fire welcome email for the new business user (non-blocking)
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

  const stepLabel = step === 1 ? "Personal & KYC Information" : "Business Registration";

  return (
    <AuthShell variant="page">
      <div className="w-full max-w-md flex flex-col min-h-screen mx-auto">

        {/* Header */}
        <div className="bg-green-600 px-5 pb-6 flex flex-col items-center" style={{ paddingTop: "max(40px, env(safe-area-inset-top, 40px))" }}>
          <div className="bg-white rounded-2xl px-4 py-2 shadow-sm mb-2">
            <AppLogo className="h-9 w-auto" />
          </div>
          <h1 className="text-lg font-bold text-white mt-1">Set Up Your Profile</h1>
          <p className="text-green-100 text-xs mt-1">Step {step} of 2 — {stepLabel}</p>
          <div className="flex gap-1.5 mt-4 w-full max-w-xs">
            <div className="flex-1 h-1 rounded-full bg-white" />
            <div className={`flex-1 h-1 rounded-full transition-colors ${step === 2 ? "bg-white" : "bg-white/30"}`} />
          </div>
        </div>

        {/* ── Step 1 — Personal / KYC ──────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleStep1} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 pb-10 bg-white dark:bg-slate-900">

            {/* Profile photo */}
            <div className="flex flex-col items-center pb-2">
              <label className="relative cursor-pointer group">
                <div className={`w-28 h-28 rounded-full overflow-hidden flex items-center justify-center transition-all
                  ${profilePreview
                    ? "border-2 border-green-500"
                    : "bg-gray-50 dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 group-hover:border-green-400"}`}>
                  {profilePreview
                    ? <img src={profilePreview} alt="profile" className="w-full h-full object-cover" />
                    : <div className="flex flex-col items-center gap-1 text-gray-400 dark:text-slate-500">
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
              <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mt-2">
                Profile Photo <span className="text-red-500">*</span>
              </p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">Required — used as your account avatar</p>
            </div>

            <Field label="Full Name">
              <input readOnly value={fullName || email.split("@")[0]}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed" />
            </Field>

            <Field label="Phone Number" required
              type="tel" placeholder="08012345678" value={phone}
              onChange={(e) => setPhone(e.target.value)} inputMode="tel" />

            <Field label="Email Address">
              <input readOnly value={email}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed" />
            </Field>

            <Field label="Home Address"
              placeholder="e.g. 12 Aba Road, Port Harcourt"
              value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />

            <Select label="Gender"
              value={gender} onChange={(e) => setGender(e.target.value)}
              placeholder="Select gender…" options={GENDERS} />

            <Field label="Date of Birth" type="date" value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={maxDobDate()} />

            <Select label="State"
              value={state} onChange={(e) => handleStateChange(e.target.value)}
              placeholder="Select State…" options={STATES} />

            <Select label="Local Government Area (LGA)"
              value={lga} onChange={(e) => handleLgaChange(e.target.value)}
              disabled={!state}
              placeholder={state ? "Select LGA…" : "Select state first"}
              options={lgas} />

            <Select label="Ward"
              value={ward} onChange={(e) => setWard(e.target.value)}
              disabled={!lga}
              placeholder={lga ? "Select Ward…" : "Select LGA first"}
              options={wards} />

            <Field label="National Identity Number (NIN)"
              placeholder="Enter your 11-digit NIN"
              value={nin}
              onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
              inputMode="numeric"
              hint="Your NIN is kept private and secure" />

            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</div>
            )}

            <button type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
              Next — Business Registration →
            </button>
          </form>
        )}

        {/* ── Step 2 — Business Registration ───────────────── */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 pb-12 bg-white dark:bg-slate-900 space-y-4">

            <button type="button" onClick={() => { setStep(1); setError(""); }}
              className="flex items-center gap-1 text-sm text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 -mt-1">
              ← Back
            </button>

            {/* ── Section 1: Business Identity ── */}
            <SectionHead emoji="🏢" title="Business Identity" />

            <Field label="Business Name" required
              placeholder="e.g. Adaeze Fabrics & Co."
              value={bizName} onChange={(e) => setBizName(e.target.value)} />

            <DrpOther
              label="Business Type"
              value={bizType} onChange={setBizType}
              otherValue={bizTypeOther} onOtherChange={setBizTypeOther}
              options={BIZ_TYPES}
              placeholder="Select business type…"
            />

            <DrpOther
              label="Registration Status"
              value={regStatus} onChange={setRegStatus}
              otherValue={regStatusOther} onOtherChange={setRegStatusOther}
              options={REG_STATUSES}
              placeholder="Select registration status…"
            />

            <DrpOther
              label="Country of Registration"
              value={countryOfReg} onChange={setCountryOfReg}
              otherValue={countryOfRegOther} onOtherChange={setCountryOfRegOther}
              options={COUNTRIES}
              placeholder="Select country of registration…"
            />

            <Select label="Preferred Currency"
              value={currency} onChange={(e) => setCurrency(e.target.value)}
              placeholder="Select currency…" options={CURRENCIES} />

            {/* ── Section 2: Industry Information ── */}
            <SectionHead emoji="🏭" title="Industry Information" />

            <DrpOther
              label="Industry"
              value={industry} onChange={setIndustry}
              otherValue={industryOther} onOtherChange={setIndustryOther}
              options={INDUSTRIES}
              placeholder="Select your industry…"
            />

            <DrpOther
              label="Business Size"
              value={bizSize} onChange={setBizSize}
              otherValue={bizSizeOther} onOtherChange={setBizSizeOther}
              options={BIZ_SIZES}
              placeholder="Select business size…"
            />

            {/* ── Section 3: Business Operations ── */}
            <SectionHead emoji="⚙️" title="Business Operations" />

            <DrpOther
              label="Products / Services Type"
              value={productsType} onChange={setProductsType}
              otherValue={productsTypeOther} onOtherChange={setProductsTypeOther}
              options={PRODUCTS_TYPES}
              placeholder="Select type…"
            />

            <DrpOther
              label="Target Market"
              value={targetMarket} onChange={setTargetMarket}
              otherValue={targetMarketOther} onOtherChange={setTargetMarketOther}
              options={TARGET_MARKETS}
              placeholder="Select target market…"
            />

            <DrpOther
              label="Operating Model"
              value={operatingModel} onChange={setOperatingModel}
              otherValue={operatingModelOther} onOtherChange={setOperatingModelOther}
              options={OP_MODELS}
              placeholder="Select operating model…"
            />

            {/* ── Section 4: Location ── */}
            <SectionHead emoji="📍" title="Business Location" />

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Country</label>
              <select
                value={bizCountry}
                onChange={(e) => { setBizCountry(e.target.value); setBizState(""); setBizLga(""); setBizWard(""); }}
                className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-900 dark:text-white"
              >
                <option value="">Select country…</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other</option>
              </select>
            </div>

            {/* State/Region */}
            {bizCountry === "Nigeria" ? (
              <Select label="State"
                value={bizState}
                onChange={(e) => handleBizStateChange(e.target.value)}
                placeholder="Select state…" options={STATES} />
            ) : (
              <Field label="State / Region"
                placeholder="Enter state or region"
                value={bizState} onChange={(e) => setBizState(e.target.value)} />
            )}

            {/* LGA */}
            {bizCountry === "Nigeria" ? (
              <Select label="Local Government"
                value={bizLga}
                onChange={(e) => handleBizLgaChange(e.target.value)}
                disabled={!bizState}
                placeholder={bizState ? "Select LGA…" : "Select state first"}
                options={bizLgas} />
            ) : (
              <Field label="Local Government / District"
                placeholder="Enter local government or district"
                value={bizLga} onChange={(e) => setBizLga(e.target.value)} />
            )}

            {/* Ward */}
            {bizCountry === "Nigeria" ? (
              <Select label="Ward"
                value={bizWard}
                onChange={(e) => setBizWard(e.target.value)}
                disabled={!bizLga}
                placeholder={bizLga ? "Select ward…" : "Select LGA first"}
                options={bizWards} />
            ) : (
              <Field label="Ward / Area"
                placeholder="Enter ward or local area"
                value={bizWard} onChange={(e) => setBizWard(e.target.value)} />
            )}

            <Field label="Full Business Address"
              placeholder="e.g. Shop 4, Onitsha Main Market"
              value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} />

            {/* ── Section 5: Verification (Optional) ── */}
            <SectionHead emoji="📄" title="Verification (Optional)" />

            <p className="text-[11px] text-gray-400 dark:text-slate-500 -mt-1">
              Upload a business registration document to verify your account. You can skip this and do it later in Settings.
            </p>

            <DrpOther
              label="Document Type"
              value={regDocType} onChange={setRegDocType}
              otherValue={regDocTypeOther} onOtherChange={setRegDocTypeOther}
              options={DOC_TYPES}
              placeholder="Select document type…"
            />

            {regDocType && regDocType !== "None" && actual(regDocType, regDocTypeOther) !== "None" && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Upload Document</label>
                <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors
                  ${regDocFile ? "border-green-400 bg-green-50 dark:bg-green-950/30" : "border-gray-300 dark:border-slate-600 hover:border-green-400 bg-gray-50 dark:bg-slate-800"}`}>
                  <svg className={`w-5 h-5 flex-shrink-0 ${regDocFile ? "text-green-600" : "text-gray-400 dark:text-slate-500"}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="min-w-0">
                    {regDocFile
                      ? <p className="text-xs font-semibold text-green-700 truncate">{regDocName}</p>
                      : <p className="text-xs text-gray-500 dark:text-slate-400">Tap to select a file <span className="text-gray-400 dark:text-slate-500">(PDF, JPG, PNG)</span></p>
                    }
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      setRegDocFile(f);
                      setRegDocName(f.name);
                    }}
                  />
                </label>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</div>
            )}

            {needsSignOut && (
              <button type="button" onClick={() => supabase.auth.signOut()}
                className="w-full border-2 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-bold rounded-xl py-3 text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                Sign Out &amp; Try Again
              </button>
            )}

            {profileSaved ? (
              <button type="button" onClick={onComplete}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
                Continue to Plans →
              </button>
            ) : (
              <button type="submit" disabled={loading || needsSignOut}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
                {loading ? "Setting up your account…" : "Complete Registration →"}
              </button>
            )}

          </form>
        )}

      </div>
    </AuthShell>
  );
}
