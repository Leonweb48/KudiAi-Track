/**
 * Festive receipt (2026-10-27) — the holiday version of a receipt the user can share instead of the plain card, OPay-style:
 * "Transfer from NAME", the amount, the theme's artwork, then "Dear <recipient>", a greeting the user can change, and the
 * recipient, date and reference. Shown only while the admin has a theme switched on (utils/receiptThemes.js).
 * Inline styles only — html2canvas captures it exactly as seen (captureReceipt.js; [data-private] nodes are left out).
 */
import { useState } from "react";
import { RECEIPT_THEMES } from "../../utils/receiptThemes";
import { useT } from "../../contexts/LanguageContext";

const first = (v) => String(v || "").split("\n")[0].trim();

// "0123456789" → "012****789" (the way bank receipts print the other side's number)
const maskDigits = (s) => String(s || "").replace(/\d{7,}/g, (d) => `${d.slice(0, 3)}****${d.slice(-3)}`);

/** What the festive card shows, read from a receipt built by receiptConfig.js. */
export function festiveParts(data) {
  const field = (label) => data?.fields?.find((f) => f.label === label)?.value;
  const recipient = field("Recipient Details");
  const sender = field("Sender Details") || field("Paid by");
  const recipientTail = String(recipient || "").split("\n")[1] || "";
  const txNo = field("Transaction No.");
  return {
    senderName: first(sender),
    recipientName: first(recipient),
    recipientLine: maskDigits(recipientTail.replace(/\s*•\s*/g, " | ")),
    reference: data?.hasRef ? data.receiptRef : (txNo || data?.receiptRef || ""),
  };
}

const fmtAmount = (n) => {
  const [i, d] = Number(n || 0).toFixed(2).split(".");
  return `₦${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`;
};

export function FestiveReceiptCard({ data, themeId, message, onMessage, innerRef }) {
  const t = useT();
  const theme = RECEIPT_THEMES[themeId];
  const [editing, setEditing] = useState(false);
  if (!theme) return null;
  const p = festiveParts(data);
  const headline = p.senderName ? t("festive.transferFrom", { name: p.senderName }) : data.title;
  const row = (label, value) => value ? (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: "rgba(255,255,255,.72)", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#fff", fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  ) : null;

  return (
    <div ref={innerRef} style={{
      borderRadius: 26, overflow: "hidden", color: "#fff", fontFamily: "'DM Sans', system-ui, sans-serif",
      background: `linear-gradient(180deg, ${theme.bg[0]} 0%, ${theme.bg[1]} 100%)`, padding: "22px 14px 14px",
    }}>
      <p style={{ margin: 0, textAlign: "center", fontSize: 14.5, fontWeight: 500, color: "rgba(255,255,255,.92)" }}>{headline}</p>
      <p style={{ margin: "6px 0 0", textAlign: "center", fontSize: 34, fontWeight: 800, letterSpacing: "-0.5px" }}>{fmtAmount(data.amount)}</p>
      <div style={{ textAlign: "center", margin: "6px 0 2px" }}>
        <img src={theme.art} alt="" crossOrigin="anonymous" style={{ width: "82%", maxWidth: 320, height: "auto", display: "inline-block" }} />
      </div>
      <div style={{ borderRadius: 20, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.18)", padding: "16px 16px 10px" }}>
        {p.recipientName && <p style={{ margin: 0, fontSize: 14.5, color: "rgba(255,255,255,.92)" }}>{t("festive.dear", { name: p.recipientName })}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          {editing ? (
            <input autoFocus value={message} maxLength={80} onChange={(e) => onMessage?.(e.target.value)}
              onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
              style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.35)", borderRadius: 10,
                color: "#fff", fontSize: 18, fontWeight: 700, padding: "6px 10px", outline: "none" }} />
          ) : (
            <p style={{ margin: 0, flex: 1, fontSize: 21, fontWeight: 800, lineHeight: 1.2, color: "#fff" }}>{message}</p>
          )}
          {onMessage && !editing && (
            <button type="button" data-private onClick={() => setEditing(true)} aria-label={t("festive.editMessage")}
              style={{ background: "none", border: 0, padding: 4, color: theme.accent, cursor: "pointer", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.7-10.2a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
            </button>
          )}
        </div>
        <div style={{ borderTop: "1.5px dashed rgba(255,255,255,.4)", margin: "12px 0 6px" }} />
        {row(t("festive.recipient"), p.recipientLine)}
        {row(t("festive.date"), data.datetime)}
        {row(t("festive.reference"), p.reference)}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, fontSize: 10.5, color: "rgba(255,255,255,.7)" }}>
        <img src="/logo-tp.png" alt="" crossOrigin="anonymous" style={{ width: 16, height: 16, borderRadius: 4, background: "#fff" }} />
        <span>KudiAI Track{data.hasRef ? ` · ${t("festive.verifyAt")} kudiai.app/verify` : ""}</span>
      </div>
    </div>
  );
}

/** "Default" + every live theme, as tiles (OPay-style), under the receipt. */
export function ThemeStrip({ themes, value, onChange }) {
  const t = useT();
  const tile = (id, label, inner, bg) => (
    <button key={id} type="button" onClick={() => onChange(id)}
      className={`flex-shrink-0 w-[76px] rounded-2xl p-1.5 border-2 transition-colors ${value === id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-transparent"}`}>
      <span className="block w-full aspect-square rounded-xl overflow-hidden flex items-center justify-center" style={{ background: bg }}>{inner}</span>
      <span className={`block mt-1 text-[11px] font-semibold truncate ${value === id ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400"}`}>{label}</span>
    </button>
  );
  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-2 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex-shrink-0" style={{ scrollbarWidth: "none" }}>
      {tile("default", t("festive.default"), <img src="/logo-tp.png" alt="" className="w-9 h-9" />, "#F1F5F9")}
      {themes.map((th) => {
        const th2 = RECEIPT_THEMES[th.id];
        return tile(th.id, t(`festive.theme.${th.id}`), <img src={th2.art} alt="" className="w-full h-full object-cover" />,
          `linear-gradient(180deg, ${th2.bg[0]}, ${th2.bg[1]})`);
      })}
    </div>
  );
}
