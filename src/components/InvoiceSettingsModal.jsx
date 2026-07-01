import { useState } from "react";

const FIELDS = [
  { key: "logo_url",       label: "Logo URL",               placeholder: "https://... (link to your business logo)", type: "url" },
  { key: "reg_number",     label: "Business Reg. Number",   placeholder: "e.g. RC-1234567", type: "text" },
  { key: "contact_email",  label: "Invoice Contact Email",  placeholder: "billing@yourbusiness.com", type: "email" },
  { key: "contact_phone",  label: "Invoice Contact Phone",  placeholder: "08012345678", type: "tel" },
  { key: "address",        label: "Business Address",       placeholder: "12 Market Street, Lagos", type: "textarea" },
  { key: "bank_name",      label: "Bank Name",              placeholder: "e.g. GTBank", type: "text" },
  { key: "account_number", label: "Account Number",         placeholder: "0123456789", type: "text" },
  { key: "account_name",   label: "Account Name",           placeholder: "John Doe Ventures", type: "text" },
  { key: "thank_you_note", label: "Thank-You Note",         placeholder: "Thank you for your business!", type: "textarea" },
];

export default function InvoiceSettingsModal({ settings, onSave, onClose }) {
  const [form,   setForm]   = useState({ ...settings });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const handleSave = async () => {
    setSaving(true); setError("");
    const { error: err } = await onSave(form);
    setSaving(false);
    if (err) { setError(err.message || "Failed to save"); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-95 transition">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-slate-600 dark:text-slate-300">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div>
          <p className="font-black text-slate-800 dark:text-white text-base leading-tight">Invoice Settings</p>
          <p className="text-[11px] text-slate-400 leading-tight">One-time setup — appears on all your invoices</p>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Logo preview */}
        {form.logo_url && (
          <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-2xl p-3">
            <img src={form.logo_url} alt="logo" className="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
              onError={e => { e.target.style.display = "none"; }} />
            <p className="text-xs text-slate-500 dark:text-slate-400">Logo preview — will appear top-left on your invoice PDF</p>
          </div>
        )}

        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              {f.label}
            </label>
            {f.type === "textarea" ? (
              <textarea
                rows={3}
                value={form[f.key] || ""}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            ) : (
              <input
                type={f.type}
                value={form[f.key] || ""}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            )}
          </div>
        ))}

        <div className="h-4" />
      </div>

      {/* Save button */}
      <div className="shrink-0 px-4 pb-6 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl font-bold text-sm text-white active:scale-95 transition"
          style={{ background: saved ? "#16a34a" : "linear-gradient(135deg,#1B2A5E,#2563eb)" }}>
          {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Invoice Settings"}
        </button>
      </div>
    </div>
  );
}
