import React from "react";
import { getMissingPaidFields, getPaidGraceInfo } from "../utils/paidCompliance";

// Non-dismissible compliance banner for paid-plan owners.
// Unlike the free-plan nudge (ProfileCompletionBanner), this banner cannot be
// dismissed — it stays until every required item is satisfied.
export default function PaidProfileBanner({ profile, onOpen, onGoVerification, onGoSettings }) {
  if (!profile?.id) return null;

  const missing = getMissingPaidFields(profile);
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
            Complete your profile to keep your plan active
          </div>
        </div>
        {inGrace ? (
          <span style={{
            background: "rgba(255,255,255,0.2)", color: "#fff",
            fontSize: 10, fontWeight: 800,
            padding: "3px 8px", borderRadius: 20, flexShrink: 0, letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}>
            {graceDaysLeft}d left
          </span>
        ) : (
          <span style={{
            background: "rgba(255,255,255,0.2)", color: "#fff",
            fontSize: 10, fontWeight: 800,
            padding: "3px 8px", borderRadius: 20, flexShrink: 0, letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}>
            Features restricted
          </span>
        )}
      </div>

      {/* ── Explanation ─────────────────────────────────────────────── */}
      <div style={{ padding: "0 14px 8px" }}>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, lineHeight: 1.55, margin: 0 }}>
          {isUrgent
            ? "Some premium features are restricted until your profile is complete. Core transactions, savings, and bills are always available."
            : `You have ${graceDaysLeft} day${graceDaysLeft === 1 ? "" : "s"} to complete your profile. Verified identity is required for your plan and future lending partnerships.`}
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
            ✗ {g}
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
          Complete profile
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
            Verify ID
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
            Settlement
          </button>
        )}
      </div>
    </div>
  );
}
