import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { compressImage } from "../utils/compressImage";
import { supabase } from "../utils/supabase";
import { useHistoryStep } from "../hooks/useHistoryStep";
import { useVisibleViewport, revealOnFocus } from "../hooks/useVisibleViewport";
import {
  COMPLETION_SECTIONS,
  getSectionStatus,
  computeCompletion,
} from "../utils/profileCompletion";
import { useT } from "../contexts/LanguageContext";

// "Complete your profile" — a full-screen, one-step-at-a-time form (2026-10-13 rework).
// The old version was a bottom sheet with every section open at once: on phones the keyboard covered the lower inputs and
// the user had to hunt for the right "Save this section" button. Now:
//   • the screen's height follows the VISIBLE viewport (window.visualViewport), so the keyboard never sits on top of the
//     form and the Back / Save & continue bar stays just above it;
//   • a focused input is scrolled into the middle of the screen once the keyboard has opened;
//   • one section per step, with step chips to jump around; typed values live here (not per section), so moving between
//     steps never loses them, and closing with unsaved changes asks first;
//   • inputs are 16px (smaller text makes iOS zoom the page on focus).

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

// Stored option values (sent to the profile row) stay English; only what is shown goes through t().
const OPT_KEYS = {
  "Retail & Trading": "settings.acct.pc.cat.retail", "Food & Beverage": "settings.acct.pc.cat.food",
  "Fashion & Beauty": "settings.acct.pc.cat.fashion", "Technology": "settings.acct.pc.cat.tech",
  "Agriculture": "settings.acct.pc.cat.agric", "Transportation": "settings.acct.pc.cat.transport",
  "Healthcare": "settings.acct.pc.cat.health", "Education": "settings.acct.pc.cat.education",
  "Construction": "settings.acct.pc.cat.construction", "Entertainment": "settings.acct.pc.cat.entertainment",
  "Finance": "settings.acct.pc.cat.finance", "Manufacturing": "settings.acct.pc.cat.manufacturing",
  "Wholesale": "settings.acct.pc.cat.wholesale", "Real Estate": "settings.acct.pc.cat.realEstate",
  "Other": "settings.acct.pc.other",
  "Sole Proprietorship": "settings.acct.pc.type.soleProp", "Partnership": "settings.acct.pc.type.partnership",
  "Limited Liability Company (LLC)": "settings.acct.pc.type.llc", "Non-Governmental Organization (NGO)": "settings.acct.pc.type.ngo",
  "Cooperative": "settings.acct.pc.type.cooperative", "Startup": "settings.acct.pc.type.startup",
  "Male": "settings.acct.pc.opt.male", "Female": "settings.acct.pc.opt.female", "Prefer not to say": "settings.acct.pc.opt.preferNot",
  "Registered (CAC)": "settings.acct.pc.reg.cac", "Registered (Other)": "settings.acct.pc.reg.other",
  "Not yet registered": "settings.acct.pc.reg.not", "Exempt (informal)": "settings.acct.pc.reg.exempt",
  "Solo / 1 person": "settings.acct.pc.size.solo", "2–5 people": "settings.acct.pc.size.2_5",
  "6–20 people": "settings.acct.pc.size.6_20", "21–50 people": "settings.acct.pc.size.21_50", "51+ people": "settings.acct.pc.size.51",
  "Physical store": "settings.acct.pc.op.physical", "Online": "settings.acct.pc.op.online", "Both": "settings.acct.pc.op.both",
};
const optLabel = (t, v) => (OPT_KEYS[v] ? t(OPT_KEYS[v]) : v);

const SHORT = {
  about: "settings.acct.pc.short.about", business: "settings.acct.pc.short.business",
  location: "settings.acct.pc.short.location", verification: "settings.acct.pc.short.verification",
};
// Section title / "why" text from COMPLETION_SECTIONS, shown by section id.
const SECTION_KEYS = {
  about: "settings.acct.pc.sec.about", business: "settings.acct.pc.sec.business",
  location: "settings.acct.pc.sec.location", verification: "settings.acct.pc.sec.verification",
};
const sectionTitle = (t, s) => (SECTION_KEYS[s.id] ? t(`${SECTION_KEYS[s.id]}.title`) : s.title);
const sectionWhy = (t, s) => (SECTION_KEYS[s.id] ? t(`${SECTION_KEYS[s.id]}.why`) : s.why);
const BRAND = "linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)";
const ALL_KEYS = COMPLETION_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
const initialFields = (p) => Object.fromEntries(ALL_KEYS.map((k) => [k, p?.[k] || ""]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function palette(dark) {
  return {
    bg: dark ? "#0a0a0a" : "#f9fafb",
    card: dark ? "#111" : "#fff",
    border: dark ? "#2a2a2a" : "#e5e7eb",
    text: dark ? "#f3f4f6" : "#111827",
    sub: dark ? "#9ca3af" : "#6b7280",
    faint: dark ? "#4b5563" : "#9ca3af",
    track: dark ? "#1f1f1f" : "#e5e7eb",
  };
}

function inputStyle(dark) {
  return {
    width: "100%",
    minHeight: 48,
    padding: "12px 14px",
    borderRadius: 12,
    border: `1.5px solid ${dark ? "#3a3a3a" : "#e5e7eb"}`,
    background: dark ? "#1c1c1c" : "#fff",
    color: dark ? "#f3f4f6" : "#111827",
    fontSize: 16,
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
    scrollMarginBottom: 96,
  };
}

function Field({ label, hint, dark, children }) {
  const c = palette(dark);
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 12, color: c.sub, marginTop: 5, lineHeight: 1.45 }}>{hint}</p>}
    </div>
  );
}

// ── Fields per step ───────────────────────────────────────────────────────────

function StepFields({ section, fields, set, dark, logo, setLogo, doc, setDoc }) {
  const inp = inputStyle(dark);
  const c = palette(dark);
  const focus = { onFocus: revealOnFocus };
  const personalLgas = fields.state ? getLGAs(fields.state) : [];
  const lgas = fields.business_state ? getLGAs(fields.business_state) : [];
  const pick = (k) => (e) => set(k, e.target.value);
  const t = useT();

  if (section.id === "about") {
    return (
      <>
        <Field label={t("settings.acct.pc.gender")} dark={dark}>
          <select value={fields.gender} onChange={pick("gender")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.select")}</option>
            {["Male", "Female", "Prefer not to say"].map((g) => <option key={g} value={g}>{optLabel(t, g)}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.dob")} dark={dark} hint={t("settings.acct.pc.dobHint")}>
          <input type="date" value={fields.date_of_birth} onChange={pick("date_of_birth")}
            max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split("T")[0]}
            style={inp} {...focus} />
        </Field>
        <Field label={t("settings.acct.pc.homeAddress")} dark={dark}>
          <input value={fields.address} onChange={pick("address")} placeholder="12 Elm Street, Lagos"
            autoComplete="street-address" enterKeyHint="next" style={inp} {...focus} />
        </Field>
        <Field label={t("settings.acct.pc.stateRes")} dark={dark}>
          <select value={fields.state} onChange={(e) => { set("state", e.target.value); set("lga", ""); }} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.selectState")}</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.lgaRes")} dark={dark}>
          <select value={fields.lga} onChange={pick("lga")} disabled={!fields.state}
            style={{ ...inp, opacity: fields.state ? 1 : 0.5 }} {...focus}>
            <option value="">{fields.state ? t("settings.acct.pc.selectLga") : t("settings.acct.pc.stateFirst")}</option>
            {personalLgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.nin")} dark={dark} hint={t("settings.acct.pc.ninHint")}>
          <input value={fields.nin} onChange={(e) => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="12345678901" maxLength={11} inputMode="numeric" enterKeyHint="done"
            style={{ ...inp, letterSpacing: 1 }} {...focus} />
        </Field>
      </>
    );
  }

  if (section.id === "business") {
    return (
      <>
        <Field label={t("settings.acct.pc.logo")} dark={dark}>
          <label style={{
            display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, cursor: "pointer",
            border: `1.5px dashed ${dark ? "#3a3a3a" : "#d1d5db"}`, background: c.card,
          }}>
            {logo.preview
              ? <img src={logo.preview} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              : <span style={{ width: 52, height: 52, borderRadius: 10, background: c.track, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🏪</span>}
            <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{logo.preview ? t("settings.acct.pc.changeLogo") : t("settings.acct.pc.uploadLogo")}
              <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: c.sub }}>{t("settings.acct.pc.logoHint")}</span></span>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setLogo({ file: f, preview: URL.createObjectURL(f) });
            }} />
          </label>
        </Field>
        <Field label={t("settings.acct.pc.bizType")} dark={dark}>
          <select value={fields.business_type} onChange={pick("business_type")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.selectType")}</option>
            {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{optLabel(t, bt)}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.regStatus")} dark={dark}>
          <select value={fields.reg_status} onChange={pick("reg_status")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.select")}</option>
            {["Registered (CAC)", "Registered (Other)", "Not yet registered", "Exempt (informal)"].map((r) => <option key={r} value={r}>{optLabel(t, r)}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.industry")} dark={dark}>
          <select value={fields.industry} onChange={pick("industry")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.selectCategory")}</option>
            {BUSINESS_CATEGORIES.map((x) => <option key={x} value={x}>{optLabel(t, x)}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.bizSize")} dark={dark}>
          <select value={fields.business_size} onChange={pick("business_size")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.select")}</option>
            {["Solo / 1 person", "2–5 people", "6–20 people", "21–50 people", "51+ people"].map((s) => <option key={s} value={s}>{optLabel(t, s)}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.products")} dark={dark}>
          <input value={fields.products_services_type} onChange={pick("products_services_type")}
            placeholder={t("settings.acct.pc.productsPh")} enterKeyHint="next" style={inp} {...focus} />
        </Field>
        <Field label={t("settings.acct.pc.opModel")} dark={dark}>
          <select value={fields.operating_model} onChange={pick("operating_model")} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.select")}</option>
            {[...new Set(["Physical store", "Online", "Both", fields.operating_model].filter(Boolean))].map((m) => <option key={m} value={m}>{optLabel(t, m)}</option>)}
          </select>
        </Field>
      </>
    );
  }

  if (section.id === "location") {
    return (
      <>
        <Field label={t("settings.acct.pc.state")} dark={dark}>
          <select value={fields.business_state} onChange={(e) => { set("business_state", e.target.value); set("business_lga", ""); }} style={inp} {...focus}>
            <option value="">{t("settings.acct.pc.selectState")}</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.lga")} dark={dark}>
          <select value={fields.business_lga} onChange={pick("business_lga")} disabled={!fields.business_state}
            style={{ ...inp, opacity: fields.business_state ? 1 : 0.5 }} {...focus}>
            <option value="">{fields.business_state ? t("settings.acct.pc.selectLga") : t("settings.acct.pc.stateFirst")}</option>
            {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label={t("settings.acct.pc.bizAddress")} dark={dark} hint={t("settings.acct.pc.bizAddressHint")}>
          <input value={fields.business_address} onChange={pick("business_address")} placeholder="12 Market Road, Onitsha"
            autoComplete="street-address" enterKeyHint="done" style={inp} {...focus} />
        </Field>
      </>
    );
  }

  if (section.id === "verification") {
    return (
      <Field label={t("settings.acct.pc.regDoc")} dark={dark}
        hint={t("settings.acct.pc.regDocHint")}>
        <label style={{
          display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, cursor: "pointer",
          border: `1.5px dashed ${dark ? "#3a3a3a" : "#d1d5db"}`, background: c.card,
        }}>
          {doc.preview
            ? <img src={doc.preview} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            : <span style={{ fontSize: 26 }}>📎</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: c.text, minWidth: 0 }}>
            {doc.file ? t("settings.acct.pc.changePhoto") : fields.reg_doc_url ? t("settings.acct.pc.replaceDoc") : t("settings.acct.pc.takePhoto")}
            <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: doc.file || fields.reg_doc_url ? "#16a34a" : c.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.file ? doc.file.name : fields.reg_doc_url ? t("settings.acct.pc.docOnFile") : t("settings.acct.pc.opensCamera")}
            </span>
          </span>
          <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setDoc({ file: f, preview: URL.createObjectURL(f) });
          }} />
        </label>
      </Field>
    );
  }

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfileCompleteFlow({ store, onClose }) {
  const t = useT();
  const profile = useMemo(() => store.profile || {}, [store.profile]);
  const dark = profile.dark_mode ?? false;
  const c = palette(dark);
  const vp = useVisibleViewport();
  const userId = profile.id;

  const sections = COMPLETION_SECTIONS;
  const firstOpen = Math.max(0, sections.findIndex((s) => !getSectionStatus(s, profile).done));
  const [step, setStep] = useState(firstOpen);
  const [fields, setFields] = useState(() => initialFields(profile));
  const [logo, setLogo] = useState({ file: null, preview: profile.store_image_url || "" });
  const [doc, setDoc] = useState({ file: null, preview: "" });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const scrollRef = useRef(null);

  const section = sections[step];
  const isLast = step === sections.length - 1;
  // what the user has typed but not saved yet (any step)
  const dirtyKeys = ALL_KEYS.filter((k) => (fields[k] || "") !== (profile[k] || ""));
  const stepDirty = section.fields.some((f) => dirtyKeys.includes(f.key))
    || (section.id === "business" && !!logo.file) || (section.id === "verification" && !!doc.file);
  const anyDirty = dirtyKeys.length > 0 || !!logo.file || !!doc.file;
  const { pct } = computeCompletion({ ...profile });

  const set = (k, v) => setFields((p) => ({ ...p, [k]: v }));

  const requestClose = useCallback(() => {
    if (saving) return;
    if (anyDirty && !window.confirm(t("settings.acct.pc.unsavedConfirm"))) return;
    onClose();
  }, [anyDirty, saving, onClose, t]);

  // Phone back button: one step back, or close on the first step. Each press uses up the history entry, so it is
  // re-armed (a new `arm` value) whenever the screen stays open.
  const [arm, setArm] = useState(1);
  const backRef = useRef(null);
  backRef.current = () => {
    if (finished || step === 0) {
      if (saving || (anyDirty && !window.confirm(t("settings.acct.pc.unsavedConfirm")))) { setArm((a) => a + 1); return; }
      onClose();
    } else { setStep((s) => s - 1); setArm((a) => a + 1); }
  };
  const historyBack = useHistoryStep(`arm-${arm}`, () => backRef.current?.());

  // stop the page behind from scrolling while this is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo?.({ top: 0 }); setError(""); }, [step]);

  async function saveStep() {
    setError("");
    if (!stepDirty) return true;
    if (section.id === "about" && fields.nin && !/^\d{11}$/.test(fields.nin)) {
      setError(t("settings.acct.pc.ninError"));
      return false;
    }
    try {
      const extra = {};
      if (section.id === "business" && logo.file) {
        setSaving(t("settings.acct.pc.uploadingLogo"));
        const compressed = await compressImage(logo.file, 900);
        const path = `${userId}/store.jpg`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
        extra.store_image_url = `${publicUrl}?v=${Date.now()}`;
      }
      if (section.id === "verification" && doc.file) {
        if (!/^image\//.test(doc.file.type || "")) throw new Error(t("settings.acct.pc.docTypeError"));
        setSaving(t("settings.acct.pc.uploadingDoc"));
        const compressed = await compressImage(doc.file, 1200);
        const path = `${userId}/reg_doc.jpg`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
        extra.reg_doc_url = `${publicUrl}?v=${Date.now()}`;
      }
      setSaving(t("common.saving"));
      const patch = {};
      section.fields.forEach((f) => { patch[f.key] = fields[f.key]; });
      Object.assign(patch, extra);
      if (patch.industry) patch.business_category = patch.industry;
      const result = await store.setProfile((prev) => ({ ...prev, ...patch }));
      if (result?.error) throw new Error(result.error.message || t("settings.acct.pc.saveFailed"));
      if (extra.store_image_url) setLogo({ file: null, preview: extra.store_image_url });
      if (extra.reg_doc_url) { setDoc({ file: null, preview: "" }); set("reg_doc_url", extra.reg_doc_url); }
      if (extra.store_image_url) set("store_image_url", extra.store_image_url);
      return true;
    } catch (e) {
      setError(e?.message || t("settings.acct.pc.saveFailedConn"));
      return false;
    } finally {
      setSaving("");
    }
  }

  async function next() {
    if (!(await saveStep())) return;
    if (isLast) setFinished(true);
    else setStep((s) => s + 1);
  }

  async function jumpTo(i) {
    if (i === step || saving) return;
    if (stepDirty && !(await saveStep())) return;
    setFinished(false);
    setStep(i);
  }

  const status = (s) => getSectionStatus(s, { ...profile, ...fields });
  const { filled, total } = status(section);
  const footerPad = vp.keyboardOpen ? 8 : "max(14px, env(safe-area-inset-bottom))";

  const ui = (
    <div
      role="dialog" aria-modal="true" aria-label={t("settings.acct.pc.title")}
      style={{
        position: "fixed", left: 0, right: 0, top: vp.top, height: vp.h || "100dvh",
        zIndex: 300, background: c.bg, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: "max(12px, env(safe-area-inset-top)) 16px 10px", borderBottom: `1px solid ${c.border}`, background: c.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={historyBack} aria-label={step === 0 || finished ? t("common.close") : t("common.back")}
              style={{ width: 38, height: 38, borderRadius: 12, border: "none", background: c.track, color: c.text, fontSize: 18, cursor: "pointer", flexShrink: 0 }}>
              {step === 0 || finished ? "✕" : "←"}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: c.text }}>{t("settings.acct.pc.title")}</div>
              <div style={{ fontSize: 12, color: c.sub, marginTop: 1 }}>
                {finished ? t("settings.acct.pc.pctComplete", { pct }) : t("settings.acct.pc.stepOf", { n: step + 1, total: sections.length, title: sectionTitle(t, section) })}
              </div>
            </div>
            {!finished && <button onClick={requestClose} style={{ border: "none", background: "none", color: c.sub, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 6 }}>{t("settings.acct.pc.later")}</button>}
          </div>
          {/* step chips — tap to jump */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))`, gap: 6, marginTop: 12 }}>
            {sections.map((s, i) => {
              const st = status(s);
              const active = i === step && !finished;
              return (
                <button key={s.id} onClick={() => jumpTo(i)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0,
                    padding: "6px 2px", borderRadius: 12, cursor: "pointer", fontSize: 11, fontWeight: 700, lineHeight: 1.2,
                    border: `1.5px solid ${active ? "#FF6B35" : st.done ? (dark ? "#14532d" : "#bbf7d0") : c.border}`,
                    background: active ? (dark ? "#2a160c" : "#fff4ee") : st.done ? (dark ? "#0f2416" : "#f0fdf4") : c.card,
                    color: active ? "#ea580c" : st.done ? "#16a34a" : c.sub,
                  }}>
                  <span style={{ fontSize: 15 }}>{st.done ? "✓" : s.icon}</span>
                  <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SHORT[s.id] ? t(SHORT[s.id]) : sectionTitle(t, s)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body — the only part that scrolls */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", padding: "16px 16px 24px" }}>
          {finished ? (
            <div style={{ textAlign: "center", padding: "40px 8px" }}>
              <div style={{ fontSize: 46 }}>{pct >= 100 ? "🎉" : "👍"}</div>
              <div style={{ fontWeight: 800, fontSize: 20, color: c.text, marginTop: 10 }}>{pct >= 100 ? t("settings.acct.pc.complete") : t("settings.acct.pc.saved")}</div>
              <p style={{ fontSize: 14, color: c.sub, marginTop: 6, lineHeight: 1.5 }}>
                {pct >= 100
                  ? t("settings.acct.pc.completeBody")
                  : t("settings.acct.pc.partialBody", { pct })}
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 26 }}>{section.icon}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: c.text }}>{sectionTitle(t, section)}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: filled === total ? "#16a34a" : c.sub }}>{filled === total ? t("settings.acct.pc.allDone") : t("settings.acct.pc.filledOf", { filled, total })}</div>
                </div>
              </div>
              <div style={{
                background: dark ? "#1a2a1a" : "#f0fdf4", border: `1px solid ${dark ? "#2d4a2d" : "#bbf7d0"}`,
                borderRadius: 10, padding: "9px 12px", marginBottom: 18, fontSize: 13, color: dark ? "#86efac" : "#15803d", lineHeight: 1.5,
              }}>
                💡 {sectionWhy(t, section)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <StepFields section={section} fields={fields} set={set} dark={dark} logo={logo} setLogo={setLogo} doc={doc} setDoc={setDoc} />
              </div>
              <p style={{ textAlign: "center", fontSize: 12, color: c.faint, marginTop: 22 }}>
                {t("settings.acct.pc.optionalNote")}
              </p>
            </>
          )}
        </div>

        {/* Footer — always visible, sits just above the keyboard */}
        <div style={{ flexShrink: 0, padding: `10px 16px`, paddingBottom: footerPad, borderTop: `1px solid ${c.border}`, background: c.bg }}>
          {error && (
            <div role="alert" style={{ marginBottom: 8, fontSize: 13, color: "#ef4444", background: dark ? "#2a1111" : "#fef2f2", borderRadius: 10, padding: "8px 12px" }}>{error}</div>
          )}
          {finished ? (
            <button onClick={onClose} style={{ width: "100%", padding: 14, background: BRAND, color: "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>{t("common.done")}</button>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              {step > 0 && (
                <button onClick={historyBack} disabled={!!saving}
                  style={{ flex: "0 0 32%", padding: 14, background: c.card, color: c.text, border: `1.5px solid ${c.border}`, borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                  {t("common.back")}
                </button>
              )}
              <button onClick={next} disabled={!!saving}
                style={{ flex: 1, padding: 14, background: saving ? (dark ? "#4a3010" : "#fed7aa") : BRAND, color: saving ? (dark ? "#d97706" : "#92400e") : "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: saving ? "wait" : "pointer" }}>
                {saving || (stepDirty ? (isLast ? t("settings.acct.pc.saveFinish") : t("settings.acct.pc.saveContinue")) : (isLast ? t("settings.acct.pc.finish") : t("common.continue")))}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}
