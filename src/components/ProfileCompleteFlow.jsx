import React, { useState } from "react";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { compressImage } from "../utils/compressImage";
import { supabase } from "../utils/supabase";
import {
  COMPLETION_SECTIONS,
  getSectionStatus,
  computeCompletion,
} from "../utils/profileCompletion";

const BUSINESS_CATEGORIES = [
  "Retail & Trading", "Food & Beverage", "Fashion & Beauty",
  "Technology", "Agriculture", "Transportation", "Healthcare",
  "Education", "Construction", "Entertainment", "Finance",
  "Manufacturing", "Wholesale", "Real Estate", "Other",
];

const BUSINESS_TYPES = [
  "Sole Proprietorship", "Partnership",
  "Limited Liability Company (LLC)", "Non-Governmental Organization (NGO)",
  "Cooperative", "Startup", "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function inputStyle(dark) {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1.5px solid ${dark ? "#3a3a3a" : "#e5e7eb"}`,
    background: dark ? "#1c1c1c" : "#f9fafb",
    color: dark ? "#f3f4f6" : "#111827",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  };
}

function Label({ children, dark }) {
  return (
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: dark ? "#9ca3af" : "#6b7280", marginBottom: 4 }}>
      {children}
    </label>
  );
}

function StatusDot({ filled, total }) {
  const done = filled === total;
  const partial = filled > 0 && !done;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600,
      color: done ? "#16a34a" : partial ? "#d97706" : "#9ca3af",
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: done ? "#16a34a" : partial ? "#f59e0b" : "#d1d5db",
        display: "inline-block",
      }} />
      {done ? "Done" : `${filled}/${total}`}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ section, profile, dark, onSave }) {
  const { filled, total, done } = getSectionStatus(section, profile);
  const [open, setOpen]     = useState(!done);
  const [fields, setFields] = useState(() => initFields(section, profile));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");
  const [logoPreview,    setLogoPreview]    = useState(profile.store_image_url || "");
  const [logoFile,       setLogoFile]       = useState(null);
  const [docFileName,    setDocFileName]    = useState(profile.reg_doc_url ? "Uploaded" : "");
  const [docFile,        setDocFile]        = useState(null);
  const [uploading,      setUploading]      = useState("");

  const userId = profile.id;

  function initFields(sec, p) {
    const out = {};
    sec.fields.forEach(f => { out[f.key] = p[f.key] || ""; });
    return out;
  }

  function set(key, val) { setFields(prev => ({ ...prev, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      let extra = {};

      // Handle logo upload
      if (section.id === "business" && logoFile) {
        setUploading("Compressing…");
        const compressed = await compressImage(logoFile, 900);
        setUploading("Uploading logo…");
        const path = `${userId}/store.jpg`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
        extra.store_image_url = `${publicUrl}?v=${Date.now()}`;
        setUploading("");
      }

      // Handle document upload
      if (section.id === "verification" && docFile) {
        setUploading("Uploading document…");
        const ext  = docFile.name.split(".").pop();
        const path = `${userId}/reg_doc.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, docFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
        extra.reg_doc_url = publicUrl;
        setUploading("");
      }

      // industry + business_category sync
      const patch = { ...fields, ...extra };
      if (patch.industry) patch.business_category = patch.industry;

      await onSave(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setOpen(false);
    } catch (e) {
      setError(e.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
      setUploading("");
    }
  }

  const lgas = fields.business_state ? getLGAs(fields.business_state) : [];

  return (
    <div style={{
      border: `1.5px solid ${dark ? "#2a2a2a" : "#e5e7eb"}`,
      borderRadius: 14,
      overflow: "hidden",
      background: dark ? "#111" : "#fff",
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", textAlign: "left",
          background: "none", border: "none", cursor: "pointer",
          padding: "14px 16px",
          display: "flex", alignItems: "center", gap: 12,
        }}
      >
        <span style={{ fontSize: 20 }}>{section.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: dark ? "#f3f4f6" : "#111827" }}>
            {section.title}
          </div>
          <StatusDot filled={saved ? total : filled} total={total} />
        </div>
        <span style={{ fontSize: 16, color: dark ? "#6b7280" : "#9ca3af", transition: "transform .2s", display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {/* Why it matters */}
          <div style={{
            background: dark ? "#1a2a1a" : "#f0fdf4",
            border: `1px solid ${dark ? "#2d4a2d" : "#bbf7d0"}`,
            borderRadius: 8, padding: "8px 12px", marginBottom: 16,
            fontSize: 12, color: dark ? "#86efac" : "#15803d", lineHeight: 1.5,
          }}>
            💡 {section.why}
          </div>

          {/* Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {renderFields(section, fields, set, dark, logoPreview, setLogoPreview, setLogoFile, docFileName, setDocFileName, setDocFile, lgas)}
          </div>

          {error && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#ef4444", background: dark ? "#2a1111" : "#fef2f2", borderRadius: 8, padding: "8px 12px" }}>
              {error}
            </div>
          )}

          {uploading && (
            <div style={{ marginTop: 10, fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", textAlign: "center" }}>
              {uploading}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              marginTop: 14, width: "100%",
              padding: "12px",
              background: saved ? "#16a34a" : saving ? (dark ? "#4a3010" : "#fed7aa") : "linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)",
              color: saved ? "#fff" : saving ? (dark ? "#d97706" : "#92400e") : "#fff",
              border: "none", borderRadius: 10,
              fontWeight: 700, fontSize: 14, cursor: saving ? "not-allowed" : "pointer",
              transition: "background .3s",
            }}
          >
            {saved ? "✓ Saved!" : saving ? (uploading || "Saving…") : "Save this section"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Field renderers by section ────────────────────────────────────────────────

function renderFields(section, fields, set, dark, logoPreview, setLogoPreview, setLogoFile, docFileName, setDocFileName, setDocFile, lgas) {
  const inp = inputStyle(dark);

  if (section.id === "about") {
    return (
      <>
        <div>
          <Label dark={dark}>Gender</Label>
          <select value={fields.gender} onChange={e => set("gender", e.target.value)} style={inp}>
            <option value="">Select…</option>
            {["Male", "Female", "Prefer not to say"].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <Label dark={dark}>Date of birth</Label>
          <input type="date" value={fields.date_of_birth} onChange={e => set("date_of_birth", e.target.value)}
            max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split("T")[0]}
            style={inp} />
        </div>
        <div>
          <Label dark={dark}>Home address</Label>
          <input value={fields.address} onChange={e => set("address", e.target.value)}
            placeholder="12 Elm Street, Lagos" style={inp} />
        </div>
        <div>
          <Label dark={dark}>National ID Number (NIN)</Label>
          <input value={fields.nin} onChange={e => set("nin", e.target.value.replace(/\D/g, ""))}
            placeholder="12345678901" maxLength={11} inputMode="numeric" style={inp} />
        </div>
      </>
    );
  }

  if (section.id === "business") {
    return (
      <>
        <div>
          <Label dark={dark}>Business logo</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logoPreview && (
              <img src={logoPreview} alt="logo" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
            )}
            <label style={{
              flex: 1, padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "center",
              border: `1.5px dashed ${dark ? "#3a3a3a" : "#d1d5db"}`,
              color: dark ? "#9ca3af" : "#6b7280", fontSize: 12, fontWeight: 600,
            }}>
              {logoPreview ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                setLogoFile(f);
                const url = URL.createObjectURL(f);
                setLogoPreview(url);
              }} />
            </label>
          </div>
        </div>
        <div>
          <Label dark={dark}>Industry / Category</Label>
          <select value={fields.industry} onChange={e => set("industry", e.target.value)} style={inp}>
            <option value="">Select category…</option>
            {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label dark={dark}>Business type</Label>
          <select value={fields.business_type} onChange={e => set("business_type", e.target.value)} style={inp}>
            <option value="">Select type…</option>
            {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label dark={dark}>Operating model</Label>
          <input value={fields.operating_model} onChange={e => set("operating_model", e.target.value)}
            placeholder="e.g. Physical store, Online, Both" style={inp} />
        </div>
      </>
    );
  }

  if (section.id === "location") {
    return (
      <>
        <div>
          <Label dark={dark}>State</Label>
          <select value={fields.business_state} onChange={e => set("business_state", e.target.value)} style={inp}>
            <option value="">Select state…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <Label dark={dark}>Local Government Area</Label>
          <select value={fields.business_lga} onChange={e => set("business_lga", e.target.value)}
            disabled={!fields.business_state} style={{ ...inp, opacity: fields.business_state ? 1 : 0.5 }}>
            <option value="">{fields.business_state ? "Select LGA…" : "Select state first"}</option>
            {lgas.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <Label dark={dark}>Business address</Label>
          <input value={fields.business_address} onChange={e => set("business_address", e.target.value)}
            placeholder="12 Market Road, Onitsha" style={inp} />
        </div>
      </>
    );
  }

  if (section.id === "verification") {
    return (
      <>
        <div>
          <Label dark={dark}>Business registration document</Label>
          <p style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginBottom: 8, lineHeight: 1.5 }}>
            CAC certificate, business name certificate, or any government-issued registration document. PDF or image.
          </p>
          <label style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px", borderRadius: 10, cursor: "pointer",
            border: `1.5px dashed ${dark ? "#3a3a3a" : "#d1d5db"}`,
            color: dark ? "#9ca3af" : "#6b7280", fontSize: 13,
          }}>
            <span style={{ fontSize: 20 }}>📎</span>
            <span>{docFileName || "Choose file…"}</span>
            <input type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: "none" }} onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setDocFile(f);
              setDocFileName(f.name);
            }} />
          </label>
          {fields.reg_doc_url && !docFileName && (
            <p style={{ fontSize: 11, color: "#16a34a", marginTop: 6 }}>✓ Document already on file</p>
          )}
        </div>
      </>
    );
  }

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfileCompleteFlow({ store, onClose }) {
  const profile = store.profile || {};
  const dark    = profile.dark_mode ?? false;
  const { pct } = computeCompletion(profile);

  async function handleSectionSave(patch) {
    await store.setProfile(prev => ({ ...prev, ...patch }));
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.55)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: dark ? "#0a0a0a" : "#f9fafb",
          borderRadius: "20px 20px 0 0",
          maxHeight: "92dvh",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drag handle + header */}
        <div style={{ padding: "12px 20px 0", textAlign: "center" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: dark ? "#3a3a3a" : "#d1d5db", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: dark ? "#f3f4f6" : "#111827" }}>
                Complete your profile
              </div>
              <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginTop: 2 }}>
                {pct}% complete · Each section saves independently
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: dark ? "#1f1f1f" : "#e5e7eb",
                border: "none", borderRadius: "50%",
                width: 30, height: 30, fontSize: 14, cursor: "pointer",
                color: dark ? "#9ca3af" : "#6b7280",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>

          {/* Global progress bar */}
          <div style={{ height: 5, background: dark ? "#1f1f1f" : "#e5e7eb", borderRadius: 999, margin: "10px 0 16px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #FF6B35, #FF8C42)", borderRadius: 999, transition: "width .4s" }} />
          </div>
        </div>

        {/* Scrollable sections */}
        <div style={{ overflowY: "auto", padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
          {COMPLETION_SECTIONS.map(section => (
            <Section
              key={section.id}
              section={section}
              profile={profile}
              dark={dark}
              onSave={handleSectionSave}
            />
          ))}

          <p style={{ textAlign: "center", fontSize: 11, color: dark ? "#4b5563" : "#9ca3af", marginTop: 6 }}>
            None of this is required to use KudiTrack — complete at your own pace.
          </p>
        </div>
      </div>
    </div>
  );
}
