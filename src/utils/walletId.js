// Opening a wallet needs ONE government ID number — the BVN or the NIN (Flutterwave accepts either for an NGN virtual
// account). Both fields are optional individually; at least one is required (except in test mode, where the server
// substitutes a placeholder). A number that is typed must be exactly 11 digits.
export const isElevenDigits = (s) => /^\d{11}$/.test(String(s || ""));

/** Returns an error message, or "" when the entry is acceptable. */
export function walletIdError(bvn, nin, testMode = false) {
  if (bvn && !isElevenDigits(bvn)) return "Your BVN must be exactly 11 digits";
  if (nin && !isElevenDigits(nin)) return "Your NIN must be exactly 11 digits";
  if (!testMode && !bvn && !nin) return "Enter your BVN or your NIN";
  return "";
}

/** Keep only digits, max 11 — for the onChange of a BVN/NIN input. */
export const digits11 = (v) => String(v || "").replace(/\D/g, "").slice(0, 11);
