// The customer's agreement to an identity check (BVN / NIN lookup through Youverify). The identity partner requires it to be the customer's own, explicit
// consent, so it is a checkbox the customer ticks — never pre-ticked, never assumed — and it is sent with the request that needs it. The server refuses a
// lookup unless it receives exactly `true`.
//
// One shared flag rather than a prop threaded through every screen that asks for a BVN / NIN: <KycConsent /> sets it, whichever screen is on top
// reads it when it submits, and it is cleared the moment the checkbox leaves the screen (a tick on one form never carries into another).

export const KYC_CONSENT_VERSION = "2026-09";   // matches platform_config.kyc_consent_version — change both when the wording changes

export const KYC_CONSENT_TEXT =
  "I agree that KudiAI Track may check my BVN / NIN with the national identity records (NIBSS and NIMC) through its verification partner, Youverify. " +
  "Only the result and the name on the record are kept — not my BVN or NIN.";

let given = false;
export const setKycConsent = (v) => { given = v === true; };
export const kycConsentGiven = () => given;
