// Pieces of "what is this account for?" shared by the sign-in screen (Auth.jsx: the email form's KudiAI Wallet option
// and the Google chooser on the Create account tab) and the screen a brand-new Google account sees after signing in
// from the Sign in tab (GoogleAccountChoice.jsx).
import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase";
import { registrationFeeNotice } from "../../utils/registrationFee";

// Amaya & Co. Technologies — pre-selected in the "business you're saving with" picker.
export const DEFAULT_CLIENT_BUSINESS_ID = "fef18c36-867b-4740-926d-7399e6aa6596";

/** The public list of businesses a KudiAI Wallet can save with, loaded the first time `enabled` is true. */
export function useSavingBusinesses(enabled) {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [businessId, setBusinessId] = useState("");
  useEffect(() => {
    if (!enabled || businesses.length || loading) return;
    setLoading(true);
    supabase.functions.invoke("ajo-portal", { body: { action: "list-businesses" } })
      .then(({ data }) => {
        const list = data?.businesses || [];
        setBusinesses(list);
        setBusinessId(prev => prev || (list.find(b => b.id === DEFAULT_CLIENT_BUSINESS_ID)?.id) || list[0]?.id || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { businesses, loading, businessId, setBusinessId };
}

/** "Business you're saving with" + its registration-fee note. */
export function SavingBusinessPicker({ businesses, loading, value, onChange }) {
  const biz = businesses.find(b => b.id === value);
  const n = biz ? registrationFeeNotice(biz.registration_fee, biz.business_name) : null;
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
        Business you're saving with
      </label>
      <select
        required value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:opacity-60"
      >
        {loading && <option value="">Loading businesses…</option>}
        {!loading && businesses.length === 0 && <option value="">No businesses available</option>}
        {businesses.map(b => <option key={b.id} value={b.id}>{b.business_name}</option>)}
      </select>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5 leading-relaxed">
        Your registration goes to this business for review — they'll set your contribution terms and
        approve before you can start saving.
      </p>
      {n && (
        <div className={`mt-2.5 rounded-xl px-3.5 py-3 border ${n.hasFee
          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/60"
          : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/60"}`}>
          <p className={`text-xs font-bold ${n.hasFee ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"}`}>{n.headline}</p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 leading-relaxed">{n.detail}</p>
        </div>
      )}
    </div>
  );
}

export function TermsAgreement({ agreed, onToggle, onOpen }) {
  return (
    <div className="flex items-start gap-2.5 pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-checked={agreed}
        role="checkbox"
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
          agreed ? "bg-emerald-600 border-emerald-600" : "border-gray-300 dark:border-slate-500 bg-white dark:bg-slate-800"
        }`}
      >
        {agreed && (
          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="white" strokeWidth={3} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </button>
      <p className="text-[12px] text-gray-500 dark:text-slate-400 leading-snug">
        I agree to the{" "}
        <button type="button" onClick={() => onOpen("terms")} className="font-semibold text-emerald-600 dark:text-emerald-400 underline underline-offset-2">
          Terms & Conditions
        </button>
        {" "}and{" "}
        <button type="button" onClick={() => onOpen("privacy")} className="font-semibold text-emerald-600 dark:text-emerald-400 underline underline-offset-2">
          Privacy Policy
        </button>
      </p>
    </div>
  );
}

export function GoogleMark({ className = "w-5 h-5 flex-shrink-0" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

const OPTION_CLS = "w-full text-left flex items-start gap-3.5 rounded-2xl border-2 border-gray-200 dark:border-slate-700 hover:border-emerald-500 active:bg-emerald-50 dark:active:bg-emerald-900/20 p-4 transition-colors disabled:opacity-60";

/** The two things an account can be for. */
export function AccountTypeOptions({ onBusiness, onWallet, disabled = false }) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBusiness} disabled={disabled} className={OPTION_CLS}>
        <span className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9h18" />
          </svg>
        </span>
        <span>
          <span className="block text-sm font-bold text-gray-900 dark:text-white">Register a business</span>
          <span className="block text-xs text-gray-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Record sales and profit, manage stock and staff, pay bills and run Ajo savings for your customers.
          </span>
        </span>
      </button>
      <button type="button" onClick={onWallet} disabled={disabled} className={OPTION_CLS}>
        <span className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 7H5a2 2 0 010-4h13v4" /><path d="M3 5v14a2 2 0 002 2h15V7" /><path d="M16 14h.01" />
          </svg>
        </span>
        <span>
          <span className="block text-sm font-bold text-gray-900 dark:text-white">Open a KudiAI Wallet</span>
          <span className="block text-xs text-gray-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Save with a business you trust, get your own account number and pay bills.
          </span>
        </span>
      </button>
    </div>
  );
}

/** Phone, the business they're saving with, and the terms tick — what a KudiAI Wallet needs beyond a Google account. */
export function WalletDetailsFields({ phone, onPhone, businesses, loading, businessId, onBusinessId, agreed, onToggleAgreed, onOpenLegal }) {
  return (
    <>
      <div>
        <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Phone</label>
        <input
          type="tel" value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="08012345678"
          className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
        />
      </div>
      <SavingBusinessPicker businesses={businesses} loading={loading} value={businessId} onChange={onBusinessId} />
      <TermsAgreement agreed={agreed} onToggle={onToggleAgreed} onOpen={onOpenLegal} />
    </>
  );
}
