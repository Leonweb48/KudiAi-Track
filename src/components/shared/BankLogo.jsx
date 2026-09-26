/**
 * A bank's logo in a small white tile — or, for a bank that has no logo in public/logos/banks/, a tile with its initials
 * (never a wrong logo). Renders nothing when there is no bank to show.
 *
 * Props: code (bank-list code, optional) · name (any spelling the bank goes by) · size (px) · radius (px)
 * The receipt card has its own inline-styled version (html2canvas can't see Tailwind classes).
 */
import { useState } from "react";
import { describeBank } from "../../utils/bankLogos";

export default function BankLogo({ code, name, size = 40, radius = 12, className = "" }) {
  const bank = describeBank({ code, name });
  const [badUrl, setBadUrl] = useState(null);
  if (!bank) return null;
  const showImg = bank.logoUrl && badUrl !== bank.logoUrl;
  const pad = Math.max(3, Math.round(size * 0.14));
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-200 dark:border-slate-600 ${className}`}
      style={{ width: size, height: size, borderRadius: radius, background: showImg ? "#fff" : "#e2e8f0", padding: showImg ? pad : 0 }}
      title={bank.name}
    >
      {showImg ? (
        <img src={bank.logoUrl} alt={bank.name} draggable={false}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
          onError={() => setBadUrl(bank.logoUrl)} />
      ) : (
        <span className="font-extrabold text-slate-600" style={{ fontSize: Math.round(size * 0.36), letterSpacing: "-0.02em" }}>{bank.initials}</span>
      )}
    </span>
  );
}
