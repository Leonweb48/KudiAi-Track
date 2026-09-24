import { digits11 } from "../utils/walletId";

const INPUT = "w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";

// The BVN / NIN pair used wherever a wallet is opened. Either one is enough (see utils/walletId.js), so neither is
// marked required — the screen validates with walletIdError() before submitting.
export default function WalletIdFields({ bvn, nin, onBvn, onNin, inputClass = INPUT, className = "" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">Enter your BVN <span className="text-slate-400 font-normal">or</span> your NIN — either one is enough.</p>
      <div>
        <label className={LABEL}>BVN</label>
        <input inputMode="numeric" value={bvn} onChange={(e) => onBvn(digits11(e.target.value))}
          placeholder="11-digit BVN" className={inputClass} />
      </div>
      <div>
        <label className={LABEL}>NIN</label>
        <input inputMode="numeric" value={nin} onChange={(e) => onNin(digits11(e.target.value))}
          placeholder="11-digit NIN" className={inputClass} />
      </div>
    </div>
  );
}
