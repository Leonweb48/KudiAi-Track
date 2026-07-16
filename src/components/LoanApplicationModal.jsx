import { useState } from "react";
import { supabase } from "../utils/supabase";
import Field from "./shared/Field";

const BUSINESS_TYPES = [
  "Retail / Trading",
  "Food & Catering",
  "Fashion & Clothing",
  "Logistics & Delivery",
  "Agriculture & Farming",
  "Technology & Services",
  "Health & Beauty",
  "Construction & Real Estate",
  "Education",
  "Other",
];

const YEARS_OPTIONS = ["Less than 1 year", "1–2 years", "2–5 years", "5–10 years", "10+ years"];

export default function LoanApplicationModal({ session, profile, onClose }) {
  const [form, setForm] = useState({
    full_name:        profile?.owner_name || profile?.full_name || "",
    business_name:    profile?.business_name || "",
    phone:            profile?.phone || "",
    loan_amount:      "",
    loan_purpose:     "",
    business_type:    "",
    years_in_business: "",
    monthly_revenue:  "",
  });
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.loan_amount || !form.loan_purpose || !form.business_type || !form.phone) {
      setError("Please fill in all required fields.");
      return;
    }
    setBusy(true); setError("");
    try {
      const { error: err } = await supabase.from("loan_applications").insert({
        user_id:           session.user.id,
        full_name:         form.full_name,
        business_name:     form.business_name,
        phone:             form.phone,
        loan_amount:       parseFloat(form.loan_amount.replace(/,/g, "")) || null,
        loan_purpose:      form.loan_purpose,
        business_type:     form.business_type,
        years_in_business: form.years_in_business,
        monthly_revenue:   parseFloat(form.monthly_revenue.replace(/,/g, "")) || null,
      });
      if (err) throw err;
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Could not submit application. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 dark:bg-slate-700 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 flex items-center justify-between border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Business Loan Application</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Our lending team reviews within 3–5 business days</p>
          </div>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Application Submitted!</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
              Our lending team will review your application and contact you within <strong>3–5 business days</strong>.
            </p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 bg-green-600 text-white rounded-xl font-semibold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            <Field label="Full Name" value={form.full_name} onChange={e => set("full_name", e.target.value)} placeholder="Your full name" />
            <Field label="Business Name" value={form.business_name} onChange={e => set("business_name", e.target.value)} placeholder="Your business name" />
            <Field label="Phone Number *" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="e.g. 08012345678" type="tel" required />

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 mb-1.5">Business Type *</label>
              <select
                value={form.business_type}
                onChange={e => set("business_type", e.target.value)}
                required
                className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select business type</option>
                {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 mb-1.5">Years in Business</label>
              <select
                value={form.years_in_business}
                onChange={e => set("years_in_business", e.target.value)}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select duration</option>
                {YEARS_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <Field
              label="Loan Amount (₦) *"
              value={form.loan_amount}
              onChange={e => set("loan_amount", e.target.value)}
              placeholder="e.g. 500000"
              type="number"
              required
            />
            <Field
              label="Monthly Revenue (₦)"
              value={form.monthly_revenue}
              onChange={e => set("monthly_revenue", e.target.value)}
              placeholder="Approximate monthly income"
              type="number"
            />

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 mb-1.5">Loan Purpose *</label>
              <textarea
                value={form.loan_purpose}
                onChange={e => set("loan_purpose", e.target.value)}
                placeholder="Briefly describe what the loan will be used for…"
                required
                rows={3}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
            </div>

            <div className="pb-6">
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl font-bold text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
              >
                {busy ? "Submitting…" : "Submit Application"}
              </button>
              <p className="text-[10px] text-gray-400 dark:text-slate-500 text-center mt-2">
                Your information is secure and will only be used for loan assessment.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
