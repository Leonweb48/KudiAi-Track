/**
 * Full client profile view + edit modal for Credit and Aso clients.
 * Handles photo upload, personal info, address (state/LGA/ward dropdowns),
 * NIN, and next-of-kin details.
 */
import { useState } from "react";
import { supabase } from "../../utils/supabase";
import { STATES, getLGAs, getWards } from "../../utils/nigeriaData";

const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

/* ── Supabase image upload ────────────────────────────────────────── */
async function uploadClientPhoto(file, recordId, type) {
  const path = `clients/${type}/${recordId}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/* ── Shared form input style ─────────────────────────────────────── */
const inputCls =
  "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-slate-700 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50 transition";

function FormField({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SectionHead({ title, icon }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className="text-base">{icon}</span>
      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{title}</p>
    </div>
  );
}

/* ── Info row (view mode) ─────────────────────────────────────────── */
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 w-32">{label}</span>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right flex-1 break-words leading-relaxed">{value}</span>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    active:          "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    paid:            "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    partially_paid:  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    overdue:         "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  };
  const cls = map[status] || map.active;
  return (
    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide ${cls}`}>
      {(status || "active").replace("_", " ")}
    </span>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export function ClientProfile({ record, type, onSave, onClose }) {
  const [editing,      setEditing]      = useState(false);
  const [form,         setForm]         = useState({ ...record });
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const isCredit = type === "credit";
  const name     = isCredit ? (record.customer_name || "Client") : (record.full_name || "Client");
  const initials = name[0]?.toUpperCase() || "C";
  const avatarSrc = photoPreview || form.profile_image_url;

  const lgas  = getLGAs(form.state  || "");
  const wards = getWards(form.state || "", form.lga || "");

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleStateChange = (s) => setForm(p => ({ ...p, state: s, lga: "", ward: "" }));
  const handleLgaChange   = (l) => setForm(p => ({ ...p, lga: l, ward: "" }));

  const handleSave = async () => {
    setSaving(true);
    setSaveErr("");
    let imageUrl = form.profile_image_url;

    if (photoFile && record.id) {
      try {
        imageUrl = await uploadClientPhoto(photoFile, record.id, isCredit ? "credit" : "aso");
      } catch (err) {
        setSaveErr(`Photo upload failed: ${err.message}`);
        setSaving(false);
        return;
      }
    }

    const updates = { ...form, profile_image_url: imageUrl };
    const { error } = await onSave(record.id, updates);
    setSaving(false);
    if (error) {
      setSaveErr(error.message || "Failed to save profile.");
      return;
    }
    setEditing(false);
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm({ ...record });
    setPhotoFile(null);
    setPhotoPreview(null);
    setSaveErr("");
  };

  /* ── shared overlay wrapper ─────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden fade-in">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <button onClick={editing ? cancelEdit : onClose}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 dark:text-white text-base truncate">{name}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{isCredit ? "Credit Profile" : "Aso Client Profile"}</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition active:scale-95">
            Edit
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Profile header card ─────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <div className="px-5 pt-6 pb-5 flex items-center gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-slate-100 dark:border-slate-600 shadow-sm">
                {avatarSrc
                  ? <img src={avatarSrc} alt={name} className="w-full h-full object-cover" />
                  : <div className={`w-full h-full flex items-center justify-center text-white font-black text-3xl ${
                      isCredit ? "bg-gradient-to-br from-amber-400 to-amber-600" : "bg-gradient-to-br from-violet-500 to-violet-700"
                    }`}>
                      {initials}
                    </div>
                }
              </div>
              {editing && (
                <label className="absolute -bottom-1 -right-1 w-7 h-7 bg-brand-600 rounded-full flex items-center justify-center cursor-pointer shadow-md hover:bg-brand-700 transition">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
              )}
            </div>

            {/* Name + status */}
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-xl text-slate-900 dark:text-white leading-tight truncate">{name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusBadge status={record.status} />
                {record.phone && <p className="text-xs text-slate-400 dark:text-slate-500">{record.phone}</p>}
              </div>
            </div>
          </div>

          {/* Financial summary strip */}
          {isCredit ? (
            <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
              {[
                { label: "Total",       value: fmt(record.total_amount), color: "text-slate-700 dark:text-slate-200" },
                { label: "Paid",        value: fmt(record.amount_paid),  color: "text-green-600 dark:text-green-400" },
                { label: "Outstanding", value: fmt(record.outstanding),  color: "text-red-500 dark:text-red-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-4 py-3 text-center">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
                  <p className={`text-sm font-extrabold tabular mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
              {[
                { label: "Balance",   value: fmt(record.current_balance), color: "text-violet-600 dark:text-violet-400" },
                { label: "Saved",     value: fmt(record.total_saved),     color: "text-green-600 dark:text-green-400" },
                { label: "Withdrawn", value: fmt(record.total_withdrawn),  color: "text-slate-600 dark:text-slate-300" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-4 py-3 text-center">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
                  <p className={`text-sm font-extrabold tabular mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="px-4 py-5 space-y-5">

          {editing ? (
            /* ===== EDIT MODE ===== */
            <>
              {/* Personal info */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Personal Information" icon="👤" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label={isCredit ? "Customer Name" : "Full Name"} required>
                    <input
                      value={isCredit ? (form.customer_name || "") : (form.full_name || "")}
                      onChange={e => set(isCredit ? "customer_name" : "full_name", e.target.value)}
                      placeholder={isCredit ? "Customer full name" : "Client full name"}
                      className={inputCls}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Phone">
                      <input type="tel" value={form.phone || ""} onChange={e => set("phone", e.target.value)}
                        placeholder="08012345678" className={inputCls} />
                    </FormField>
                    <FormField label="Email">
                      <input type="email" value={form.email || ""} onChange={e => set("email", e.target.value)}
                        placeholder="email@example.com" className={inputCls} />
                    </FormField>
                  </div>
                  <FormField label="NIN">
                    <input type="text" inputMode="numeric" value={form.nin || ""}
                      onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder="11-digit NIN" className={inputCls} />
                  </FormField>
                </div>
              </div>

              {/* Address */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Address" icon="📍" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label="Street Address">
                    <input value={form.address || ""} onChange={e => set("address", e.target.value)}
                      placeholder="12 Market Road, Onitsha" className={inputCls} />
                  </FormField>
                  <FormField label="State">
                    <select value={form.state || ""} onChange={e => handleStateChange(e.target.value)} className={inputCls}>
                      <option value="">Select State…</option>
                      {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="LGA">
                      <select value={form.lga || ""} onChange={e => handleLgaChange(e.target.value)}
                        disabled={!form.state} className={inputCls}>
                        <option value="">{form.state ? "Select LGA…" : "Select state first"}</option>
                        {lgas.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Ward">
                      <select value={form.ward || ""} onChange={e => set("ward", e.target.value)}
                        disabled={!form.lga} className={inputCls}>
                        <option value="">{form.lga ? "Select Ward…" : "Select LGA first"}</option>
                        {wards.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </FormField>
                  </div>
                </div>
              </div>

              {/* Next of Kin */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                <div className="px-4 pt-4 pb-2"><SectionHead title="Next of Kin" icon="👨‍👩‍👦" /></div>
                <div className="px-4 pb-4 space-y-3.5">
                  <FormField label="Full Name">
                    <input value={form.next_of_kin || ""} onChange={e => set("next_of_kin", e.target.value)}
                      placeholder="Next of kin full name" className={inputCls} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Phone">
                      <input type="tel" value={form.next_of_kin_phone || ""} onChange={e => set("next_of_kin_phone", e.target.value)}
                        placeholder="08012345678" className={inputCls} />
                    </FormField>
                    <FormField label="Email">
                      <input type="email" value={form.next_of_kin_email || ""} onChange={e => set("next_of_kin_email", e.target.value)}
                        placeholder="email@example.com" className={inputCls} />
                    </FormField>
                  </div>
                  <FormField label="Address">
                    <input value={form.next_of_kin_address || ""} onChange={e => set("next_of_kin_address", e.target.value)}
                      placeholder="Next of kin address" className={inputCls} />
                  </FormField>
                </div>
              </div>

              {/* Error */}
              {saveErr && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs rounded-xl px-4 py-3">
                  {saveErr}
                </div>
              )}

              {/* Save / Cancel */}
              <div className="grid grid-cols-2 gap-3 pb-6">
                <button onClick={cancelEdit}
                  className="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-[0.99]">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="py-3.5 rounded-xl font-bold text-sm bg-brand-600 hover:bg-brand-700 text-white transition active:scale-[0.99] disabled:opacity-60 shadow-sm">
                  {saving ? "Saving…" : "Save Profile"}
                </button>
              </div>
            </>
          ) : (
            /* ===== VIEW MODE ===== */
            <>
              {/* Personal info */}
              {(record.phone || record.email || record.nin || record.address) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Personal Information" icon="👤" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Phone"   value={record.phone} />
                    <InfoRow label="Email"   value={record.email} />
                    <InfoRow label="NIN"     value={record.nin} />
                    <InfoRow label="Address" value={record.address} />
                    <InfoRow label="State"   value={[record.state, record.lga, record.ward].filter(Boolean).join(" · ") || null} />
                  </div>
                </div>
              )}

              {/* Next of Kin */}
              {(record.next_of_kin || record.next_of_kin_phone) && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Next of Kin" icon="👨‍👩‍👦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Name"    value={record.next_of_kin} />
                    <InfoRow label="Phone"   value={record.next_of_kin_phone} />
                    <InfoRow label="Email"   value={record.next_of_kin_email} />
                    <InfoRow label="Address" value={record.next_of_kin_address} />
                  </div>
                </div>
              )}

              {/* Credit / Aso specific info */}
              {isCredit ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Credit Details" icon="💳" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Due Date"   value={record.due_date} />
                    <InfoRow label="Date Given" value={record.date_given} />
                    <InfoRow label="Notes"      value={record.notes} />
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card">
                  <div className="px-4 pt-4 pb-2"><SectionHead title="Savings Details" icon="🏦" /></div>
                  <div className="px-4 pb-3">
                    <InfoRow label="Frequency"    value={record.contribution_frequency} />
                    <InfoRow label="Contribution" value={fmt(record.contribution_amount)} />
                    <InfoRow label="Next Due"     value={record.next_contribution_date} />
                    <InfoRow label="Registered"   value={record.registration_date} />
                    <InfoRow label="Notes"        value={record.notes} />
                  </div>
                </div>
              )}

              {/* Empty state prompt */}
              {!record.phone && !record.email && !record.nin && !record.next_of_kin && (
                <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-600">
                  <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">Profile incomplete</p>
                  <p className="text-slate-300 dark:text-slate-600 text-xs mt-1 mb-3">Add contact and KYC details</p>
                  <button onClick={() => setEditing(true)}
                    className="px-4 py-2 bg-brand-600 text-white rounded-xl font-bold text-xs hover:bg-brand-700 transition">
                    Complete Profile
                  </button>
                </div>
              )}

              <div className="pb-6" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
