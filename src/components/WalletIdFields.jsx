import { digits11 } from "../utils/walletId";
import KycConsent from "./KycConsent";
import SelfieCapture from "./SelfieCapture";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useT } from "../contexts/LanguageContext";

const INPUT = "w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";

// walletIdError() (utils/walletId.js) returns English; screens show it through this map so it follows the chosen language.
const WALLET_ID_ERROR_KEYS = {
  "Your BVN must be exactly 11 digits": "wallet.id.err.bvn11",
  "Your NIN must be exactly 11 digits": "wallet.id.err.nin11",
  "Enter your BVN or your NIN": "wallet.id.err.either",
};
/** The walletIdError() message in the chosen language (`t` = useT()). Unknown messages are shown as they are. */
export const walletIdErrorText = (msg, t) => (WALLET_ID_ERROR_KEYS[msg] ? t(WALLET_ID_ERROR_KEYS[msg]) : msg);

// The BVN / NIN pair used wherever a wallet is opened. Either one is enough (see utils/walletId.js), so neither is
// marked required — the screen validates with walletIdError() before submitting.
// selfie / onSelfie are optional — pass them to also collect a selfie (shown only while identity checks require one).
export default function WalletIdFields({ bvn, nin, onBvn, onNin, selfie, onSelfie, inputClass = INPUT, className = "" }) {
  const { kycSelfieRequired } = usePlatformConfig();
  const t = useT();
  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">{t("wallet.id.introA")} <span className="text-slate-400 font-normal">{t("wallet.id.introOr")}</span> {t("wallet.id.introB")}</p>
      <div>
        <label className={LABEL}>BVN</label>
        <input inputMode="numeric" value={bvn} onChange={(e) => onBvn(digits11(e.target.value))}
          placeholder={t("wallet.id.bvnPlaceholder")} className={inputClass} />
      </div>
      <div>
        <label className={LABEL}>NIN</label>
        <input inputMode="numeric" value={nin} onChange={(e) => onNin(digits11(e.target.value))}
          placeholder={t("wallet.id.ninPlaceholder")} className={inputClass} />
      </div>
      <KycConsent />
      {kycSelfieRequired && onSelfie && <SelfieCapture value={selfie} onCapture={onSelfie} onClear={() => onSelfie("")} />}
    </div>
  );
}
