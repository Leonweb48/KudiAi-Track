import React from "react";
import { getMissingPaidFields, getPaidGraceInfo } from "../utils/paidCompliance";
import { useT } from "../contexts/LanguageContext";

// The missing-item groups (English names from utils/paidCompliance.js) → translation keys; others show as given
const GROUP_KEY = {
  "Personal details":   "home.groupPersonal",
  "Business details":   "home.groupBusiness",
  "Business location":  "home.groupLocation",
  "Settlement account": "home.groupSettlement",
  "Verification":       "home.groupVerification",
};

// Non-dismissible compliance banner for paid-plan owners.
// Unlike the free-plan nudge (ProfileCompletionBanner), this banner cannot be
// dismissed — it stays until every required item is satisfied.
// walletSettled: false while we don't yet know whether the owner has a wallet
// (platform flag / wallet query still loading). Until then `walletActive` is
// just "false because unknown", and rendering would flash a "wallet missing"
// banner on every open/refresh that vanishes a moment later — so render nothing.
export default function PaidProfileBanner({ profile, walletActive = false, walletSettled = true, onOpen, onGoVerification, onGoSettings }) {
  const t = useT();
  if (!profile?.id) return null;
  if (!walletSettled) return null;

  const missing = getMissingPaidFields(profile, walletActive);
  if (missing.length === 0) return null;

  const { graceDaysLeft, inGrace } = getPaidGraceInfo(profile.id);

  // Group the missing items so the banner shows category chips, not a full list
  const missingGroups = [...new Set(missing.map(f => f.group))];
  const hasVerification = missing.some(f => f.group === "Verification");
  const hasSettlement   = missing.some(f => f.group === "Settlement account");

  const isUrgent = !inGrace;

  const bannerBg = isUrgent
    ? "linear-gradient(135deg,#b91c1c 0%,#991b1b 100%)"
    : "linear-gradient(135deg,#b45309 0%,#92400e 100%)";

  return (
    <div style={{ borderRadius: 14, overflow: "hidden", background: bannerBg }}>

      {/* ── Top row: heading + status chip ─────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 14px 6px" }}>
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.35 }}>
            {t("home.paidTitle")}
          </div>
        </div>
        {inGrace ? (
          <span style={{
            background: "rgba(255,255,255,0.2)", color: "#fff",
            fontSize: 10, fontWeight: 800,
            padding: "3px 8px", borderRadius: 20, flexShrink: 0, letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}>
            {t("home.daysLeftShort", { n: graceDaysLeft })}
          </span>
        ) : (
          <span style={{
            background: "rgba(255,255,255,0.2)", color: "#fff",
            fontSize: 10, fontWeight: 800,
            padding: "3px 8px", borderRadius: 20, flexShrink: 0, letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}>
            {t("home.featuresRestricted")}
          </span>
        )}
      </div>

      {/* ── Explanation ─────────────────────────────────────────────── */}
      <div style={{ padding: "0 14px 8px" }}>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, lineHeight: 1.55, margin: 0 }}>
          {isUrgent
            ? t("home.paidUrgentBody")
            : t(graceDaysLeft === 1 ? "home.paidGraceOne" : "home.paidGraceMany", { n: graceDaysLeft })}
        </p>
      </div>

      {/* ── Missing group chips ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px" }}>
        {missingGroups.map(g => (
          <span key={g} style={{
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.22)",
            color: "#fff", fontSize: 10, fontWeight: 700,
            padding: "3px 10px", borderRadius: 20,
          }}>
            ✗ {GROUP_KEY[g] ? t(GROUP_KEY[g]) : g}
          </span>
        ))}
      </div>

      {/* ── CTAs ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
        <button
          onClick={onOpen}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.92)",
            color: isUrgent ? "#991b1b" : "#92400e",
            border: "none", borderRadius: 10,
            fontWeight: 700, fontSize: 12,
            padding: "10px 8px", cursor: "pointer",
          }}
        >
          {t("home.completeProfile")}
        </button>
        {hasVerification && (
          <button
            onClick={onGoVerification}
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#fff", borderRadius: 10,
              fontWeight: 700, fontSize: 12,
              padding: "10px 10px", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t("home.verifyId")}
          </button>
        )}
        {hasSettlement && (
          <button
            onClick={onGoSettings}
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#fff", borderRadius: 10,
              fontWeight: 700, fontSize: 12,
              padding: "10px 10px", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t("home.settlement")}
          </button>
        )}
      </div>
    </div>
  );
}
