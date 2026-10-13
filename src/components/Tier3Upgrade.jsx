import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TIER3_ID_TYPES, TIER3_DOCS, tier3IdType, tier3RequiredDocs, tier3IdNumberError, formatKoboLimit,
} from "../utils/walletTier";
import { uploadTier3Doc } from "../hooks/useWalletTier";
import { useHistoryStep } from "../hooks/useHistoryStep";
import { useVisibleViewport, revealOnFocus } from "../hooks/useVisibleViewport";

// Tier 3 upgrade, bank-style (2026-10-13): the customer sees exactly what is needed — with a SAMPLE of each document —
// uploads every document here (private storage), and a person at KudiAI checks each one before the tier changes.
// Full screen and sized to the visible viewport, so the keyboard never hides an input or the buttons.

const FIELD = "w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 text-[16px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[13px] font-bold text-slate-700 dark:text-slate-200";
const BTN = "w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold text-[15px] transition-colors";
const BTN2 = "py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[15px]";
const STEPS = ["What you need", "Your ID", "Documents", "Review"];

function docTitle(kind, idType) {
  if (kind === "id_front") return tier3IdType(idType)?.front || TIER3_DOCS.id_front.title;
  if (kind === "id_back") return `Back of your ${tier3IdType(idType)?.label || "ID card"}`;
  return TIER3_DOCS[kind].title;
}

// A sample image, full screen.
function SampleViewer({ kind, idType, onClose }) {
  const d = TIER3_DOCS[kind];
  return (
    <div className="fixed inset-0 z-[310] bg-black flex flex-col" onClick={onClose} role="dialog" aria-label="Sample document">
      <div className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))] pb-3">
        <p className="text-white font-bold text-[15px]">Sample — {docTitle(kind, idType)}</p>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 text-white text-lg" aria-label="Close">✕</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
        <img src={d.sample} alt={`Sample ${d.title}`} className="max-w-full max-h-full rounded-xl" />
      </div>
      <div className="px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 space-y-1" onClick={(e) => e.stopPropagation()}>
        {d.good.map((g) => <p key={g} className="text-[13px] text-emerald-300">✓ {g}</p>)}
        {d.bad.map((b) => <p key={b} className="text-[13px] text-rose-300">✕ {b}</p>)}
      </div>
    </div>
  );
}

// One document: sample + rules + the customer's own upload.
function DocCard({ kind, idType, value, onPick, onSample }) {
  const d = TIER3_DOCS[kind];
  const cam = useRef(null);
  const pick = useRef(null);
  const state = value?.state;            // undefined | "uploading" | "done" | "error"
  return (
    <div className={`rounded-3xl border p-4 bg-white dark:bg-slate-800 ${state === "done" ? "border-emerald-300 dark:border-emerald-700" : state === "error" ? "border-rose-300 dark:border-rose-700" : "border-slate-200 dark:border-slate-700"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50">{docTitle(kind, idType)}</p>
        {state === "done" && <span className="text-[11px] font-extrabold px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Uploaded</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={onSample} className="text-left">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
            <img src={d.sample} alt="" className="max-w-full max-h-full" />
          </div>
          <p className="mt-1 text-[11.5px] font-bold text-brand-700 dark:text-brand-300">Sample · tap to enlarge</p>
        </button>
        <div>
          <div className="aspect-[4/3] rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
            {value?.preview
              ? <img src={value.preview} alt="Your upload" className="w-full h-full object-cover" />
              : value?.isPdf
                ? <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 px-2 text-center">📄 {value.name}</span>
                : <span className="text-[12px] text-slate-400 px-2 text-center">Yours appears here</span>}
          </div>
          <p className={`mt-1 text-[11.5px] font-bold ${state === "error" ? "text-rose-600" : state === "uploading" ? "text-amber-600" : state === "done" ? "text-emerald-600" : "text-slate-400"}`}>
            {state === "uploading" ? "Uploading…" : state === "error" ? value.error : state === "done" ? "✓ Saved securely" : "Not uploaded yet"}
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-0.5">
        {d.good.map((g) => <li key={g} className="text-[12.5px] text-slate-600 dark:text-slate-300">✓ {g}</li>)}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={state === "uploading"} onClick={() => cam.current?.click()}
          className="py-3 rounded-2xl bg-brand-600 text-white text-[14px] font-bold disabled:opacity-40">
          {state === "done" ? "Retake photo" : "Take photo"}
        </button>
        <button type="button" disabled={state === "uploading"} onClick={() => pick.current?.click()}
          className="py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[14px] font-bold disabled:opacity-40">
          {d.pdf ? "Choose photo / PDF" : "Choose photo"}
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture={d.camera} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
      <input ref={pick} type="file" accept={d.pdf ? "image/jpeg,image/png,image/webp,application/pdf" : "image/jpeg,image/png,image/webp"} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </div>
  );
}

/**
 * Full-screen Tier 3 upgrade. `tierApi` = useWalletTier(); `prefill` = { address }.
 */
export default function Tier3Upgrade({ tierApi, prefill, onClose }) {
  const vp = useVisibleViewport();
  const [step, setStep] = useState(0);
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState(prefill?.address || "");
  const [note, setNote] = useState("");
  const [docs, setDocs] = useState({});          // kind → { state, path, preview, isPdf, name, error }
  const [sample, setSample] = useState(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const scrollRef = useRef(null);

  const required = useMemo(() => tier3RequiredDocs(idType), [idType]);
  const allUploaded = required.every((k) => docs[k]?.state === "done");
  const uploading = Object.values(docs).some((d) => d?.state === "uploading");
  const typed = !!(idType || idNumber || Object.keys(docs).length);

  // phone back = previous step; on the first step (or when done) it closes
  const [arm, setArm] = useState(1);
  const backRef = useRef(null);
  backRef.current = () => {
    if (sample) { setSample(null); setArm((a) => a + 1); return; }
    if (sent || step === 0) {
      if (busy || (typed && !sent && !window.confirm("Leave without submitting? Your uploads won't be sent for review."))) { setArm((a) => a + 1); return; }
      onClose();
    } else { setStep((s) => s - 1); setArm((a) => a + 1); }
  };
  const historyBack = useHistoryStep(`t3-${arm}`, () => backRef.current?.());

  useEffect(() => { scrollRef.current?.scrollTo?.({ top: 0 }); setErr(""); }, [step]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const pickFile = async (kind, file) => {
    const isPdf = file.type === "application/pdf";
    const preview = isPdf ? "" : URL.createObjectURL(file);
    setDocs((p) => ({ ...p, [kind]: { state: "uploading", preview, isPdf, name: file.name } }));
    try {
      const up = await uploadTier3Doc(kind, file);
      setDocs((p) => ({ ...p, [kind]: { ...p[kind], state: "done", path: up.path } }));
    } catch (e) {
      setDocs((p) => ({ ...p, [kind]: { ...p[kind], state: "error", error: e?.message || "Upload failed — try again" } }));
    }
  };

  const idErr = idType ? tier3IdNumberError(idType, idNumber) : "Choose the type of ID";
  const next = () => {
    setErr("");
    if (step === 1) {
      if (!idType) { setErr("Choose the type of ID you'll upload"); return; }
      if (idErr) { setErr(idErr); return; }
      if (address.trim().length < 8) { setErr("Enter your home address as it appears on your utility bill"); return; }
    }
    if (step === 2 && !allUploaded) { setErr(uploading ? "Wait for the uploads to finish" : "Upload every document on this page"); return; }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setErr("");
    if (!agree) { setErr("Tick the box to confirm your documents"); return; }
    setBusy(true);
    try {
      const res = await tierApi.submitTier3({
        id_type: idType, id_number: idNumber.toUpperCase().replace(/\s+/g, ""), address: address.trim(), note: note.trim(),
        documents: required.map((k) => ({ kind: k, path: docs[k].path })),
      });
      if (res?.already_pending) setErr("");
      setSent(true);
    } catch (e) {
      setErr(e?.message || "Could not send your documents. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const t = tier3IdType(idType);
  const ui = (
    <div role="dialog" aria-modal="true" aria-label="Upgrade to Tier 3"
      className="fixed left-0 right-0 z-[300] bg-slate-50 dark:bg-slate-900 flex flex-col"
      style={{ top: vp.top, height: vp.h || "100dvh" }}>
      <div className="w-full max-w-xl mx-auto h-full flex flex-col min-h-0">
        {/* Header */}
        <div className="shrink-0 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button onClick={historyBack} aria-label={step === 0 || sent ? "Close" : "Back"}
              className="w-10 h-10 rounded-xl bg-slate-200/70 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-lg shrink-0">
              {step === 0 || sent ? "✕" : "←"}
            </button>
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">Upgrade to Tier 3</p>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{sent ? "Submitted for review" : `Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}</p>
            </div>
          </div>
          {!sent && (
            <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
              {STEPS.map((s, i) => <span key={s} className={`h-1.5 rounded-full ${i <= step ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />)}
            </div>
          )}
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
          {sent ? (
            <div className="text-center py-10 px-2">
              <div className="text-5xl">📨</div>
              <p className="mt-3 text-[20px] font-extrabold text-slate-900 dark:text-slate-50">Documents submitted</p>
              <p className="mt-2 text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Our team checks each document by hand, usually within 1–2 working days. You'll get a notification and an email when it's done.
                Until then you stay on Tier {tierApi.tier} with your current limits.
              </p>
              <p className="mt-4 text-[12px] text-slate-400 leading-relaxed">KudiAI will never ask for your PIN, password or OTP about this request.</p>
            </div>
          ) : step === 0 ? (
            <>
              <div className="rounded-3xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 p-4">
                <p className="text-[15px] font-extrabold text-amber-900 dark:text-amber-100">Tier 3 — Fully Verified</p>
                <p className="mt-1 text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {formatKoboLimit(tierApi.nextLimits?.maxBalanceKobo)} balance and up to {formatKoboLimit(tierApi.nextLimits?.dailyKobo)} a day.
                  Like any bank, we need to see your documents. It takes about 3 minutes; a person reviews them.
                </p>
              </div>
              <p className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">What you'll need</p>
              {["id_front", "utility_bill", "passport_photo"].map((k) => (
                <button key={k} type="button" onClick={() => setSample(k)}
                  className="w-full flex items-center gap-3 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-left">
                  <img src={TIER3_DOCS[k].sample} alt="" className="w-24 h-[72px] object-contain rounded-xl bg-slate-100 dark:bg-slate-900 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-extrabold text-slate-900 dark:text-slate-50">
                      {k === "id_front" ? "A valid ID" : TIER3_DOCS[k].title}
                    </p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
                      {k === "id_front" ? "National ID or NIN slip, voter's card, driver's licence or international passport — not expired. Cards need front and back."
                        : k === "utility_bill" ? "From the last 3 months, with your name and home address."
                          : "A clear, recent photo of your face on a plain background."}
                    </p>
                    <p className="mt-0.5 text-[11.5px] font-bold text-brand-700 dark:text-brand-300">See sample →</p>
                  </div>
                </button>
              ))}
              <p className="text-[12px] text-slate-400 leading-relaxed">
                Your documents are stored privately and seen only by KudiAI's verification team. We use them only to confirm who you are, as the law requires of wallet providers.
              </p>
            </>
          ) : step === 1 ? (
            <>
              <div>
                <p className={LABEL}>Which ID will you upload?</p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {TIER3_ID_TYPES.map((x) => (
                    <button key={x.id} type="button" onClick={() => { setIdType(x.id); setErr(""); }}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${idType === x.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}>
                      <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{x.label}</span>
                      <span className={`w-5 h-5 rounded-full border-2 ${idType === x.id ? "border-brand-600 bg-brand-600" : "border-slate-300 dark:border-slate-600"}`} />
                    </button>
                  ))}
                </div>
              </div>
              {t && (
                <div>
                  <label className={LABEL} htmlFor="t3-idno">{t.numberLabel}</label>
                  <input id="t3-idno" value={idNumber} onFocus={revealOnFocus}
                    onChange={(e) => setIdNumber(t.numeric ? e.target.value.replace(/\D/g, "").slice(0, 11) : e.target.value.toUpperCase().slice(0, 23))}
                    inputMode={t.numeric ? "numeric" : "text"} autoCapitalize="characters" placeholder={t.placeholder} className={FIELD + " tracking-wider"} />
                  <p className="mt-1 text-[12px] text-slate-400">Exactly as printed on your {t.label.toLowerCase()}.</p>
                </div>
              )}
              <div>
                <label className={LABEL} htmlFor="t3-addr">Home address</label>
                <textarea id="t3-addr" value={address} onFocus={revealOnFocus} onChange={(e) => setAddress(e.target.value.slice(0, 200))} rows={2}
                  placeholder="House number, street, town, state" className={FIELD} />
                <p className="mt-1 text-[12px] text-slate-400">The same address that is on your utility bill.</p>
              </div>
            </>
          ) : step === 2 ? (
            <>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Upload each document below. Compare yours with the sample — a clear, complete photo is approved fastest.
              </p>
              {required.map((k) => (
                <DocCard key={k} kind={k} idType={idType} value={docs[k]} onPick={(f) => pickFile(k, f)} onSample={() => setSample(k)} />
              ))}
            </>
          ) : (
            <>
              <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                {[["ID", t?.label], [t?.numberLabel || "ID number", idNumber.toUpperCase()], ["Address", address.trim()]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-[13px] text-slate-500 dark:text-slate-400">{k}</span>
                    <span className="text-[13px] font-bold text-slate-900 dark:text-slate-50 text-right break-words min-w-0">{v}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {required.map((k) => (
                  <div key={k}>
                    <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                      {docs[k]?.preview ? <img src={docs[k].preview} alt="" className="w-full h-full object-cover" /> : <span className="text-[12px] font-bold text-slate-500">📄 PDF</span>}
                    </div>
                    <p className="mt-1 text-[11.5px] font-bold text-slate-600 dark:text-slate-300">{docTitle(k, idType)}</p>
                  </div>
                ))}
              </div>
              <div>
                <label className={LABEL} htmlFor="t3-note">Anything we should know? <span className="font-normal text-slate-400">optional</span></label>
                <textarea id="t3-note" value={note} onFocus={revealOnFocus} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2}
                  placeholder="e.g. the bill is in my spouse's name" className={FIELD} />
              </div>
              <label className="flex items-start gap-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 w-5 h-5 accent-brand-600 shrink-0" />
                <span className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">
                  These documents are mine, genuine and current. I understand that false documents lead to the account being closed and reported.
                </span>
              </label>
            </>
          )}
        </div>

        {/* Footer — sits just above the keyboard */}
        <div className="shrink-0 px-4 pt-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
          style={{ paddingBottom: vp.keyboardOpen ? 8 : "max(14px, env(safe-area-inset-bottom))" }}>
          {err && <p role="alert" className="mb-2 text-[13px] text-rose-600 bg-rose-50 dark:bg-rose-900/30 rounded-xl px-3 py-2">{err}</p>}
          {sent ? (
            <button onClick={onClose} className={BTN}>Done</button>
          ) : (
            <div className="flex gap-2.5">
              {step > 0 && <button onClick={historyBack} disabled={busy} className={BTN2 + " w-1/3"}>Back</button>}
              {step < 3
                ? <button onClick={next} disabled={step === 2 && uploading} className={BTN}>{step === 0 ? "Start" : step === 2 && uploading ? "Uploading…" : "Continue"}</button>
                : <button onClick={submit} disabled={busy || !agree} className={BTN}>{busy ? "Submitting…" : "Submit for review"}</button>}
            </div>
          )}
        </div>
      </div>
      {sample && <SampleViewer kind={sample} idType={idType} onClose={() => setSample(null)} />}
    </div>
  );
  return createPortal(ui, document.body);
}
