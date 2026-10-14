import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TIER3_ID_TYPES, TIER3_DOCS, TIER3_ID_ERROR_KEYS, tier3IdType, tier3RequiredDocs, tier3IdNumberError, formatKoboLimit,
} from "../utils/walletTier";
import { uploadTier3Doc } from "../hooks/useWalletTier";
import { useHistoryStep } from "../hooks/useHistoryStep";
import { useVisibleViewport, revealOnFocus } from "../hooks/useVisibleViewport";
import { useT } from "../contexts/LanguageContext";

// Tier 3 upgrade, bank-style (2026-10-13): the customer sees exactly what is needed — with a SAMPLE of each document —
// uploads every document here (private storage), and a person at KudiAI checks each one before the tier changes.
// Full screen and sized to the visible viewport, so the keyboard never hides an input or the buttons.

const FIELD = "w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 text-[16px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[13px] font-bold text-slate-700 dark:text-slate-200";
const BTN = "w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold text-[15px] transition-colors";
const BTN2 = "py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[15px]";
const STEPS = ["What you need", "Your ID", "Documents", "Review"];
const STEP_KEYS = ["wallet.tier3.step.need", "wallet.tier3.step.id", "wallet.tier3.step.docs", "wallet.tier3.step.review"];

// `t` = useT() of the calling component
function docTitle(kind, idType, t) {
  if (kind === "id_front") { const x = tier3IdType(idType); return x ? t(x.frontKey) : t(TIER3_DOCS.id_front.titleKey); }
  if (kind === "id_back") { const x = tier3IdType(idType); return t("wallet.tier3.backOf", { label: x ? t(x.labelKey) : t("wallet.tier3.idCard") }); }
  return t(TIER3_DOCS[kind].titleKey);
}
// "Unlimited" in the chosen language
const limitText = (kobo, t) => (kobo === null || kobo === undefined ? t("wallet.tier.unlimited") : formatKoboLimit(kobo));

// A sample image, full screen.
function SampleViewer({ kind, idType, onClose }) {
  const d = TIER3_DOCS[kind];
  const t = useT();
  return (
    <div className="fixed inset-0 z-[310] bg-black flex flex-col" onClick={onClose} role="dialog" aria-label={t("wallet.tier3.sampleDoc")}>
      <div className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))] pb-3">
        <p className="text-white font-bold text-[15px]">{t("wallet.tier3.sampleOf", { title: docTitle(kind, idType, t) })}</p>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 text-white text-lg" aria-label={t("common.close")}>✕</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
        <img src={d.sample} alt={t("wallet.tier3.sampleAlt", { title: t(d.titleKey) })} className="max-w-full max-h-full rounded-xl" />
      </div>
      <div className="px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 space-y-1" onClick={(e) => e.stopPropagation()}>
        {d.good.map((g, i) => <p key={g} className="text-[13px] text-emerald-300">✓ {t(d.goodKeys[i])}</p>)}
        {d.bad.map((b, i) => <p key={b} className="text-[13px] text-rose-300">✕ {t(d.badKeys[i])}</p>)}
      </div>
    </div>
  );
}

// One document: sample + rules + the customer's own upload.
function DocCard({ kind, idType, value, onPick, onSample }) {
  const d = TIER3_DOCS[kind];
  const t = useT();
  const cam = useRef(null);
  const pick = useRef(null);
  const state = value?.state;            // undefined | "uploading" | "done" | "error"
  return (
    <div className={`rounded-3xl border p-4 bg-white dark:bg-slate-800 ${state === "done" ? "border-emerald-300 dark:border-emerald-700" : state === "error" ? "border-rose-300 dark:border-rose-700" : "border-slate-200 dark:border-slate-700"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50">{docTitle(kind, idType, t)}</p>
        {state === "done" && <span className="text-[11px] font-extrabold px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">{t("wallet.tier3.uploaded")}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={onSample} className="text-left">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
            <img src={d.sample} alt="" className="max-w-full max-h-full" />
          </div>
          <p className="mt-1 text-[11.5px] font-bold text-brand-700 dark:text-brand-300">{t("wallet.tier3.tapEnlarge")}</p>
        </button>
        <div>
          <div className="aspect-[4/3] rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
            {value?.preview
              ? <img src={value.preview} alt={t("wallet.tier3.yourUpload")} className="w-full h-full object-cover" />
              : value?.isPdf
                ? <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 px-2 text-center">📄 {value.name}</span>
                : <span className="text-[12px] text-slate-400 px-2 text-center">{t("wallet.tier3.yoursHere")}</span>}
          </div>
          <p className={`mt-1 text-[11.5px] font-bold ${state === "error" ? "text-rose-600" : state === "uploading" ? "text-amber-600" : state === "done" ? "text-emerald-600" : "text-slate-400"}`}>
            {state === "uploading" ? t("wallet.tier3.uploading") : state === "error" ? (value.error || t("wallet.tier3.uploadFailed")) : state === "done" ? t("wallet.tier3.savedSecurely") : t("wallet.tier3.notUploaded")}
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-0.5">
        {d.good.map((g, i) => <li key={g} className="text-[12.5px] text-slate-600 dark:text-slate-300">✓ {t(d.goodKeys[i])}</li>)}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={state === "uploading"} onClick={() => cam.current?.click()}
          className="py-3 rounded-2xl bg-brand-600 text-white text-[14px] font-bold disabled:opacity-40">
          {state === "done" ? t("wallet.tier3.retake") : t("wallet.tier3.takePhoto")}
        </button>
        <button type="button" disabled={state === "uploading"} onClick={() => pick.current?.click()}
          className="py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[14px] font-bold disabled:opacity-40">
          {d.pdf ? t("wallet.tier3.choosePhotoPdf") : t("wallet.tier3.choosePhoto")}
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
  const t = useT();
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
      if (busy || (typed && !sent && !window.confirm(t("wallet.tier3.leaveConfirm")))) { setArm((a) => a + 1); return; }
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
      setDocs((p) => ({ ...p, [kind]: { ...p[kind], state: "error", error: e?.message || "" } }));
    }
  };

  const idErr = idType ? tier3IdNumberError(idType, idNumber) : "Choose the type of ID";
  const idErrText = (m) => (TIER3_ID_ERROR_KEYS[m] ? t(TIER3_ID_ERROR_KEYS[m]) : m);
  const next = () => {
    setErr("");
    if (step === 1) {
      if (!idType) { setErr(t("wallet.tier3.err.chooseUpload")); return; }
      if (idErr) { setErr(idErrText(idErr)); return; }
      if (address.trim().length < 8) { setErr(t("wallet.tier3.err.address")); return; }
    }
    if (step === 2 && !allUploaded) { setErr(uploading ? t("wallet.tier3.err.wait") : t("wallet.tier3.err.uploadAll")); return; }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setErr("");
    if (!agree) { setErr(t("wallet.tier3.err.tick")); return; }
    setBusy(true);
    try {
      const res = await tierApi.submitTier3({
        id_type: idType, id_number: idNumber.toUpperCase().replace(/\s+/g, ""), address: address.trim(), note: note.trim(),
        documents: required.map((k) => ({ kind: k, path: docs[k].path })),
      });
      if (res?.already_pending) setErr("");
      setSent(true);
    } catch (e) {
      setErr(e?.message || t("wallet.tier3.err.send"));
    } finally {
      setBusy(false);
    }
  };

  const idt = tier3IdType(idType);
  const ui = (
    <div role="dialog" aria-modal="true" aria-label={t("wallet.tier.upgradeTo3")}
      className="fixed left-0 right-0 z-[300] bg-slate-50 dark:bg-slate-900 flex flex-col"
      style={{ top: vp.top, height: vp.h || "100dvh" }}>
      <div className="w-full max-w-xl mx-auto h-full flex flex-col min-h-0">
        {/* Header */}
        <div className="shrink-0 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button onClick={historyBack} aria-label={step === 0 || sent ? t("common.close") : t("common.back")}
              className="w-10 h-10 rounded-xl bg-slate-200/70 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-lg shrink-0">
              {step === 0 || sent ? "✕" : "←"}
            </button>
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{t("wallet.tier.upgradeTo3")}</p>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{sent ? t("wallet.tier3.submittedForReview") : t("wallet.tier3.stepOf", { n: step + 1, total: STEPS.length, name: t(STEP_KEYS[step]) })}</p>
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
              <p className="mt-3 text-[20px] font-extrabold text-slate-900 dark:text-slate-50">{t("wallet.tier3.sentTitle")}</p>
              <p className="mt-2 text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {t("wallet.tier3.sentBody", { tier: tierApi.tier })}
              </p>
              <p className="mt-4 text-[12px] text-slate-400 leading-relaxed">{t("wallet.tier3.neverAsk")}</p>
            </div>
          ) : step === 0 ? (
            <>
              <div className="rounded-3xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 p-4">
                <p className="text-[15px] font-extrabold text-amber-900 dark:text-amber-100">{t("wallet.tier3.headline", { name: t("wallet.tier.name3") })}</p>
                <p className="mt-1 text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {t("wallet.tier3.intro", { balance: limitText(tierApi.nextLimits?.maxBalanceKobo, t), daily: limitText(tierApi.nextLimits?.dailyKobo, t) })}
                </p>
              </div>
              <p className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">{t("wallet.tier3.youNeed")}</p>
              {["id_front", "utility_bill", "passport_photo"].map((k) => (
                <button key={k} type="button" onClick={() => setSample(k)}
                  className="w-full flex items-center gap-3 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-left">
                  <img src={TIER3_DOCS[k].sample} alt="" className="w-24 h-[72px] object-contain rounded-xl bg-slate-100 dark:bg-slate-900 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-extrabold text-slate-900 dark:text-slate-50">
                      {k === "id_front" ? t("wallet.tier3.validId") : t(TIER3_DOCS[k].titleKey)}
                    </p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
                      {k === "id_front" ? t("wallet.tier3.need.id")
                        : k === "utility_bill" ? t("wallet.tier3.need.bill")
                          : t("wallet.tier3.need.photo")}
                    </p>
                    <p className="mt-0.5 text-[11.5px] font-bold text-brand-700 dark:text-brand-300">{t("wallet.tier3.seeSample")}</p>
                  </div>
                </button>
              ))}
              <p className="text-[12px] text-slate-400 leading-relaxed">
                {t("wallet.tier3.privacy")}
              </p>
            </>
          ) : step === 1 ? (
            <>
              <div>
                <p className={LABEL}>{t("wallet.tier3.whichId")}</p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {TIER3_ID_TYPES.map((x) => (
                    <button key={x.id} type="button" onClick={() => { setIdType(x.id); setErr(""); }}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${idType === x.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}>
                      <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{t(x.labelKey)}</span>
                      <span className={`w-5 h-5 rounded-full border-2 ${idType === x.id ? "border-brand-600 bg-brand-600" : "border-slate-300 dark:border-slate-600"}`} />
                    </button>
                  ))}
                </div>
              </div>
              {idt && (
                <div>
                  <label className={LABEL} htmlFor="t3-idno">{t(idt.numberLabelKey)}</label>
                  <input id="t3-idno" value={idNumber} onFocus={revealOnFocus}
                    onChange={(e) => setIdNumber(idt.numeric ? e.target.value.replace(/\D/g, "").slice(0, 11) : e.target.value.toUpperCase().slice(0, 23))}
                    inputMode={idt.numeric ? "numeric" : "text"} autoCapitalize="characters" placeholder={t(idt.placeholderKey)} className={FIELD + " tracking-wider"} />
                  <p className="mt-1 text-[12px] text-slate-400">{t("wallet.tier3.exactlyAsPrinted", { label: t(idt.labelKey).toLowerCase() })}</p>
                </div>
              )}
              <div>
                <label className={LABEL} htmlFor="t3-addr">{t("wallet.tier3.homeAddress")}</label>
                <textarea id="t3-addr" value={address} onFocus={revealOnFocus} onChange={(e) => setAddress(e.target.value.slice(0, 200))} rows={2}
                  placeholder={t("wallet.tier3.homeAddressPh")} className={FIELD} />
                <p className="mt-1 text-[12px] text-slate-400">{t("wallet.tier3.sameAddress")}</p>
              </div>
            </>
          ) : step === 2 ? (
            <>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {t("wallet.tier3.uploadIntro")}
              </p>
              {required.map((k) => (
                <DocCard key={k} kind={k} idType={idType} value={docs[k]} onPick={(f) => pickFile(k, f)} onSample={() => setSample(k)} />
              ))}
            </>
          ) : (
            <>
              <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                {[[t("wallet.tier3.review.id"), idt ? t(idt.labelKey) : undefined], [idt ? t(idt.numberLabelKey) : t("wallet.tier3.review.idNumber"), idNumber.toUpperCase()], [t("wallet.tier3.review.address"), address.trim()]].map(([k, v]) => (
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
                    <p className="mt-1 text-[11.5px] font-bold text-slate-600 dark:text-slate-300">{docTitle(k, idType, t)}</p>
                  </div>
                ))}
              </div>
              <div>
                <label className={LABEL} htmlFor="t3-note">{t("wallet.tier3.anything")} <span className="font-normal text-slate-400">{t("common.optional")}</span></label>
                <textarea id="t3-note" value={note} onFocus={revealOnFocus} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2}
                  placeholder={t("wallet.tier3.notePh")} className={FIELD} />
              </div>
              <label className="flex items-start gap-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 w-5 h-5 accent-brand-600 shrink-0" />
                <span className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">
                  {t("wallet.tier3.declare")}
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
            <button onClick={onClose} className={BTN}>{t("common.done")}</button>
          ) : (
            <div className="flex gap-2.5">
              {step > 0 && <button onClick={historyBack} disabled={busy} className={BTN2 + " w-1/3"}>{t("common.back")}</button>}
              {step < 3
                ? <button onClick={next} disabled={step === 2 && uploading} className={BTN}>{step === 0 ? t("wallet.tier3.start") : step === 2 && uploading ? t("wallet.tier3.uploading") : t("common.continue")}</button>
                : <button onClick={submit} disabled={busy || !agree} className={BTN}>{busy ? t("wallet.tier3.submitting") : t("wallet.tier3.submitForReview")}</button>}
            </div>
          )}
        </div>
      </div>
      {sample && <SampleViewer kind={sample} idType={idType} onClose={() => setSample(null)} />}
    </div>
  );
  return createPortal(ui, document.body);
}
