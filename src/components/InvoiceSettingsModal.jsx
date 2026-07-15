import { useState, useRef } from "react";
import { supabase } from "../utils/supabase";

const FIELDS = [
  { key: "reg_number",     label: "Business Reg. Number",   placeholder: "e.g. RC-1234567", type: "text" },
  { key: "contact_email",  label: "Invoice Contact Email",  placeholder: "billing@yourbusiness.com", type: "email" },
  { key: "contact_phone",  label: "Invoice Contact Phone",  placeholder: "08012345678", type: "tel" },
  { key: "address",        label: "Business Address",       placeholder: "12 Market Street, Lagos", type: "textarea" },
  { key: "bank_name",      label: "Bank Name",              placeholder: "e.g. GTBank", type: "text" },
  { key: "account_number", label: "Account Number",         placeholder: "0123456789", type: "text" },
  { key: "account_name",   label: "Account Name",           placeholder: "John Doe Ventures", type: "text" },
  { key: "thank_you_note", label: "Thank-You Note",         placeholder: "Thank you for your business!", type: "textarea" },
];

export default function InvoiceSettingsModal({ settings, onSave, onClose, userId }) {
  const [form,      setForm]      = useState({ ...settings });
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/logo_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("invoice-logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setError("Logo upload failed: " + upErr.message);
    } else {
      const { data } = supabase.storage.from("invoice-logos").getPublicUrl(path);
      setForm(p => ({ ...p, logo_url: data.publicUrl }));
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleSave = async () => {
    setSaving(true); setError("");
    const { error: err } = await onSave(form);
    setSaving(false);
    if (err) { setError(err.message || "Failed to save"); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900">
      {/* Header — padded past status bar */}
      <div className="flex items-center gap-3 px-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}>
        <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-95 transition">
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

        {/* Logo upload */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Business Logo
          </label>
          {form.logo_url ? (
            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-2xl p-3">
              <img
                src={form.logo_url}
                alt="logo"
                className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                onError={e => { e.target.style.display = "none"; }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Appears top-left on your invoice PDF</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg text-white active:scale-95 transition bg-[linear-gradient(135deg,#1B2A5E,#2563eb)]">
                    {uploading ? "Uploading…" : "Change"}
                  </button>
                  <button
                    onClick={() => setForm(p => ({ ...p, logo_url: "" }))}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 active:scale-95 transition">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-sm font-semibold active:scale-95 transition bg-slate-50 dark:bg-slate-800">
              {uploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Tap to upload logo
                </>
              )}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
        </div>

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
          disabled={saving || uploading}
          className="w-full py-3.5 rounded-2xl font-bold text-sm text-white active:scale-95 transition"
          style={{ background: saved ? "#16a34a" : "linear-gradient(135deg,#1B2A5E,#2563eb)" }}>
          {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Invoice Settings"}
        </button>
      </div>
    </div>
  );
}
