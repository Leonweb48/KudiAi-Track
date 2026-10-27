// Business posters (2026-10-27) — the owner makes a "Pay with transfer" or an "Ajo & Esusu available" poster, in any of the
// five languages, and saves it as an A4 PDF for printing or shares it as an image (A4 or WhatsApp Status). Opened from the
// Fund wallet sheet, Finance → Finance Tools and the Home screen. The account shown comes from business_poster_lookup —
// the same answer the public kudiai.app/pay/<code> page gives, so the poster and the check page never disagree.
import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "./WalletPanel";
import Icon from "./Icon";
import { supabase } from "../utils/supabase";
import { useLanguage, useT } from "../contexts/LanguageContext";
import { LANGUAGES } from "../utils/i18n";
import { translate } from "../i18n";
import { renderPoster, posterPdf, posterFileName, posterLink, canvasBlob } from "../utils/posterRender";
import { savePdf } from "../utils/pdfSave";
import { shareFile } from "../utils/shareFile";

const inputCls =
  "w-full mt-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold focus:outline-none focus:border-brand-400";

export default function PosterStudio({ open, onClose, profile, initialType = "pay" }) {
  const t = useT();
  const { lang: appLang } = useLanguage();
  const [type, setType] = useState(initialType);
  const [lang, setLang] = useState(appLang || "en");
  const [info, setInfo] = useState(null);         // { code, business_name, account }
  const [loadErr, setLoadErr] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [withContact, setWithContact] = useState(false);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");            // "" | "pdf" | "image" | "status"
  const [err, setErr] = useState("");
  const previewReq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setType(initialType); setLang(appLang || "en"); setErr("");
    setPhone(profile?.business_phone || profile?.phone || "");
    setAddress(profile?.business_address || profile?.address || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setLoadErr(false);
    (async () => {
      const { data: code, error } = await supabase.rpc("owner_poster_code");
      if (error || !code) throw error || new Error("no code");
      const { data, error: e2 } = await supabase.rpc("business_poster_lookup", { p_code: code });
      if (e2 || !data?.ok) throw e2 || new Error("lookup failed");
      if (live) setInfo({ code, ...data });
    })().catch(() => { if (live) setLoadErr(true); });
    return () => { live = false; };
  }, [open, loadKey]);

  const canPay = !!info?.account?.number;
  const opts = (size) => ({
    type, lang, size, code: info.code,
    businessName: info.business_name || profile?.business_name || "",
    account: info.account || undefined,
    contact: withContact ? { phone: phone.trim(), address: address.trim() } : null,
  });

  // live preview (light render), redrawn shortly after the last change
  useEffect(() => {
    if (!open || !info || (type === "pay" && !canPay)) { setPreview(""); return undefined; }
    const req = ++previewReq.current;
    const id = setTimeout(async () => {
      try {
        const canvas = await renderPoster({ ...opts("a4"), scale: 0.5 });
        if (req === previewReq.current) setPreview(canvas.toDataURL("image/jpeg", 0.82));
      } catch { if (req === previewReq.current) setPreview(""); }
    }, 250);
    return () => clearTimeout(id);
  }, [open, info, type, lang, withContact, phone, address]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareText = () => translate(type === "pay" ? "posters.payShare" : "posters.joinShare", lang,
    { biz: info.business_name, link: posterLink(type, info.code) });

  const make = async (kind) => {
    setBusy(kind); setErr("");
    try {
      if (kind === "pdf") {
        const o = opts("a4");
        await savePdf(posterPdf(await renderPoster(o)), posterFileName(o, "pdf"), { shareText: shareText() });
      } else {
        const o = opts(kind === "status" ? "status" : "a4");
        const blob = await canvasBlob(await renderPoster(o), "image/jpeg", 0.92);
        await shareFile(new File([blob], posterFileName(o, "jpg"), { type: "image/jpeg" }),
          { text: shareText(), dialogTitle: t("posters.title") });
      }
    } catch {
      setErr(t("posters.failed"));
    } finally {
      setBusy("");
    }
  };

  const tab = (id, label) => (
    <button key={id} onClick={() => setType(id)}
      className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold transition-colors ${type === id
        ? "bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-300 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
      {label}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={t("posters.title")}>
      <div className="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-4">
        {tab("pay", t("posters.typePay"))}
        {tab("ajo", t("posters.typeAjo"))}
      </div>

      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t("posters.language")}</p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {LANGUAGES.map((l) => (
          <button key={l.code} onClick={() => setLang(l.code)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold border transition-colors ${lang === l.code
              ? "bg-brand-600 border-brand-600 text-white" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
            {l.native}
          </button>
        ))}
      </div>

      {loadErr ? (
        <div className="rounded-2xl bg-red-50 dark:bg-red-900/20 p-4 text-[13px] text-red-700 dark:text-red-300">
          {t("posters.loadFailed")}
          <button onClick={() => setLoadKey((k) => k + 1)} className="block mt-2 font-bold underline">{t("posters.retry")}</button>
        </div>
      ) : !info ? (
        <div className="aspect-[1/1.414] w-full rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : type === "pay" && !canPay ? (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
          {t("posters.noWallet")}
        </div>
      ) : (
        <>
          <div className="w-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-[1/1.414] shadow-card">
            {preview
              ? <img src={preview} alt={t("posters.title")} className="w-full h-full object-cover" />
              : <div className="w-full h-full animate-pulse" />}
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            {type === "pay"
              ? <>{t("posters.nameNote")} {t("posters.qrNote", { link: posterLink("pay", info.code).replace("https://", "") })}</>
              : t("posters.joinNote", { link: posterLink("ajo", info.code).replace("https://", "") })}
          </p>

          <label className="mt-4 flex items-center gap-2.5 text-[13px] font-bold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={withContact} onChange={(e) => setWithContact(e.target.checked)}
              className="w-4 h-4 accent-[var(--brand-green)]" />
            {t("posters.showContact")}
          </label>
          {withContact && (
            <div className="mt-2 grid gap-2">
              <label className="text-[12px] font-semibold text-slate-500">{t("posters.phone")}
                <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 40))} inputMode="tel" className={inputCls} />
              </label>
              <label className="text-[12px] font-semibold text-slate-500">{t("posters.address")}
                <input value={address} onChange={(e) => setAddress(e.target.value.slice(0, 120))} className={inputCls} />
              </label>
            </div>
          )}

          <button onClick={() => make("pdf")} disabled={!!busy}
            className="w-full mt-5 flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-2xl py-3.5 text-[14.5px] active:scale-[0.99]">
            <Icon name="download" size={16} /> {busy === "pdf" ? t("posters.making") : t("posters.downloadPdf")}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => make("image")} disabled={!!busy}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 py-3 text-[13px] font-bold text-slate-700 dark:text-slate-200 disabled:opacity-50">
              <Icon name="send" size={14} /> {busy === "image" ? t("posters.making") : t("posters.shareImage")}
            </button>
            <button onClick={() => make("status")} disabled={!!busy}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 py-3 text-[13px] font-bold text-slate-700 dark:text-slate-200 disabled:opacity-50">
              <Icon name="phone" size={14} /> {busy === "status" ? t("posters.making") : t("posters.statusImage")}
            </button>
          </div>
          {err && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400 text-center">{err}</p>}
        </>
      )}
    </BottomSheet>
  );
}
