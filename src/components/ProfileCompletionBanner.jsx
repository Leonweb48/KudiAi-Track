import React, { useState, useEffect } from "react";
import {
  computeCompletion,
  isProfileComplete,
  bannerDismissKey,
  BANNER_SNOOZE_MS,
} from "../utils/profileCompletion";

export default function ProfileCompletionBanner({ profile, onOpen }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    if (isProfileComplete(profile)) { setVisible(false); return; }
    const key  = bannerDismissKey(profile.id);
    const raw  = localStorage.getItem(key);
    if (raw) {
      try {
        const { dismissedAt } = JSON.parse(raw);
        if (Date.now() - dismissedAt < BANNER_SNOOZE_MS) { setVisible(false); return; }
      } catch { /* malformed — ignore, show banner */ }
    }
    setVisible(true);
  }, [profile]);

  function handleDismiss(e) {
    e.stopPropagation();
    if (!profile?.id) return;
    localStorage.setItem(
      bannerDismissKey(profile.id),
      JSON.stringify({ dismissedAt: Date.now() })
    );
    setVisible(false);
  }

  if (!visible) return null;

  const { pct, filled, total } = computeCompletion(profile);
  const remaining = total - filled;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left"
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)",
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background arc decoration */}
        <div
          style={{
            position: "absolute",
            right: -20,
            top: -20,
            width: 90,
            height: 90,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            pointerEvents: "none",
          }}
        />

        {/* Progress ring */}
        <RingProgress pct={pct} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
            {pct < 40
              ? "Your profile is just getting started"
              : pct < 70
              ? "Good progress — keep going!"
              : "Almost there — finish your profile"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>
            {remaining} {remaining === 1 ? "field" : "fields"} left · Tap to complete
          </div>
        </div>

        <button
          onClick={handleDismiss}
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            borderRadius: "50%",
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            color: "#fff",
            fontSize: 12,
            lineHeight: 1,
          }}
          aria-label="Dismiss for 3 days"
        >
          ✕
        </button>
      </div>
    </button>
  );
}

function RingProgress({ pct }) {
  const r  = 18;
  const cx = 24;
  const cy = 24;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;

  return (
    <svg width={48} height={48} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={4} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#fff"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontSize={10}
        fontWeight={700}
      >
        {pct}%
      </text>
    </svg>
  );
}
