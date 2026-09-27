import { useEffect, useState } from "react";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { KYC_CONSENT_TEXT, kycConsentGiven, setKycConsent } from "../utils/kycConsent";

// "I agree to an identity check" — shown only while identity checks are switched on (platform_config.kyc_youverify_enabled), so with the
// switch off nothing changes on any screen. Drop it next to a BVN / NIN field; the submit reads kycConsentGiven().
export default function KycConsent({ className = "" }) {
  const { kycEnabled } = usePlatformConfig();
  const [on, setOn] = useState(kycConsentGiven());
  useEffect(() => () => setKycConsent(false), []);          // a tick never carries over to another form
  if (!kycEnabled) return null;
  return (
    <label className={`flex items-start gap-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 px-3.5 py-3 cursor-pointer ${className}`}>
      <input
        type="checkbox" checked={on} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-500"
        onChange={(e) => { setOn(e.target.checked); setKycConsent(e.target.checked); }}
      />
      <span className="text-[12px] leading-snug text-slate-600 dark:text-slate-300">{KYC_CONSENT_TEXT}</span>
    </label>
  );
}
