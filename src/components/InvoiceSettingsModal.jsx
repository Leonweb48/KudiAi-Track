import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

const FIELDS = [
  { key: "reg_number",     label: "Business Reg. Number",  placeholder: "e.g. RC-1234567",              type: "text"     },
  { key: "contact_email",  label: "Invoice Contact Email", placeholder: "billing@yourbusiness.com",      type: "email"    },
  { key: "contact_phone",  label: "Invoice Contact Phone", placeholder: "08012345678",                  type: "tel"      },
  { key: "address",        label: "Business Address",      placeholder: "12 Market Street, Lagos",      type: "textarea" },
  { key: "thank_you_note", label: "Thank-You Note",        placeholder: "Thank you for your business!", type: "textarea" },
];

const inputCls = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500";
const labelCls = "block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5";

export default function InvoiceSettingsModal({ settings, onSave, onClose, userId }) {
  const [form,      setForm]      = useState({ ...settings });
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState("");
  const [uploading, setUploading] = useState(false);

  const [banks,        setBanks]        = useState([]);
  const [verifying,    setVerifying]    = useState(false);
  const [verifyErr,    setVerifyErr]    = useState("");
  const [verifiedName, setVerifiedName] = useState("");

  const fileRef = useRef(null);

  useEffect(() => {
    supabase.functions.invoke("paystack", { body: { action: "list-banks" } })
      .then(({ data }) => { if (data?.data) setBanks(data.data); })
      .catch(() => {});
  }, []);

  const handleBankChange = (e) => {
    const code = e.target.value;
    const bank = banks.find(b => b.code === code);
    setForm(p => ({ ...p, bank_code: code, bank_name: bank?.name || "" }));
    setVerifiedName(""); setVerifyErr("");
  };

  const handleVerify = async () => {
    const acct = (form.account_number || "").trim();
    const code = form.bank_code;
    if (!acct || acct.length < 10 || !code) {
      setVerifyErr("Enter a 10-digit account number and select a bank first.");
      return;
    }
    setVerifying(true); setVerifyErr(""); setVerifiedName("");
    try {
      const { data, error: err } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: acct, bank_code: code },
      });
      if (err || !data?.status) throw new Error(data?.message || "Could not verify account");
      const name = data.data?.account_name || "";
      setVerifiedName(name);
      setForm(p => ({ ...p, account_name: name }));
    } catch (e) {
      setVerifyErr(e.message || "Account verification failed");
    } finally {
      setVerifying(false);
    }
  };

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

  const canVerify = (form.account_number || "").trim().length >= 10 && !!form.bank_code;

  return (
    <div className="fixed inset-0 z-sub-sheet flex flex-col bg-white dark:bg-slate-900">
      {/* Header */}
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
          <label className={labelCls}>Business Logo</label>
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
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg text-white active:scale-95 transition bg-brand-600 hover:bg-brand-700">
                    {uploading ? "Uploading…" : "Change"}
                  </button>
                  <button onClick={() => setForm(p => ({ ...p, logo_url: "" }))}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 active:scale-95 transition">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
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

        {/* Standard fields (no bank fields) */}
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className={labelCls}>{f.label}</label>
            {f.type === "textarea" ? (
              <textarea
                rows={3}
                value={form[f.key] || ""}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className={inputCls + " resize-none"}
              />
            ) : (
              <input
                type={f.type}
                value={form[f.key] || ""}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className={inputCls}
              />
            )}
          </div>
        ))}

        {/* ── Payment / Bank Details ──────────────────────────────── */}
        <div className="pt-1">
          <p className="text-[12px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Payment Details</p>

          {/* Bank select */}
          <div className="mb-4">
            <label className={labelCls}>Bank Name</label>
            <select
              value={form.bank_code || ""}
              onChange={handleBankChange}
              className={inputCls}>
              <option value="">{banks.length === 0 ? "Loading banks…" : "Select bank…"}</option>
              {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>

          {/* Account number + Verify button */}
          <div className="mb-4">
            <label className={labelCls}>Account Number</label>
            <div className="flex gap-2">
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={form.account_number || ""}
                onChange={e => {
                  setForm(p => ({ ...p, account_number: e.target.value }));
                  setVerifiedName(""); setVerifyErr("");
                }}
                placeholder="0123456789"
                className={inputCls + " flex-1"}
              />
              <button
                onClick={handleVerify}
                disabled={verifying || !canVerify}
                className="px-4 py-3 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 active:scale-95 transition shrink-0 min-w-[72px]">
                {verifying ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mx-auto" />
                ) : "Verify"}
              </button>
            </div>

            {verifiedName && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-green-600 dark:text-green-400 shrink-0">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                <p className="text-xs font-bold text-green-700 dark:text-green-400">{verifiedName}</p>
                <span className="text-[10px] text-green-600 dark:text-green-500 ml-auto">Verified</span>
              </div>
            )}
            {verifyErr && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{verifyErr}</p>
            )}
          </div>

          {/* Account name — auto-filled, still editable */}
          <div>
            <label className={labelCls}>Account Name</label>
            <input
              type="text"
              value={form.account_name || ""}
              onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))}
              placeholder="Auto-filled after verification"
              className={inputCls}
            />
          </div>
        </div>

        <div className="h-4" />
      </div>

      {/* Save button */}
      <div className="shrink-0 px-4 pb-6 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={handleSave}
          disabled={saving || uploading}
          className={`w-full py-3.5 rounded-2xl font-bold text-sm text-white active:scale-95 transition ${
            saved ? "bg-brand-600" : "bg-brand-700 hover:bg-brand-600"
          }`}>
          {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Invoice Settings"}
        </button>
      </div>
    </div>
  );
}
