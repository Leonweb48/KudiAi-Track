import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabase";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS = {
  unverified:    { label: "Not verified",              color: "#9ca3af", bg: "#f9fafb",  icon: "○"  },
  tier1_failed:  { label: "Verification failed",       color: "#ef4444", bg: "#fef2f2",  icon: "✕"  },
  tier1_pending: { label: "NIN under review",          color: "#2563eb", bg: "#eff6ff",  icon: "⏳" },
  tier1_verified:{ label: "Identity verified",         color: "#16a34a", bg: "#f0fdf4",  icon: "✓"  },
  tier2_required:{ label: "Enhanced verification required", color: "#d97706", bg: "#fffbeb", icon: "⚠" },
  tier2_pending: { label: "Under admin review",        color: "#2563eb", bg: "#eff6ff",  icon: "⏳" },
  tier2_verified:{ label: "Fully verified",            color: "#16a34a", bg: "#f0fdf4",  icon: "✓✓" },
  tier2_rejected:{ label: "Documents rejected",        color: "#ef4444", bg: "#fef2f2",  icon: "✕"  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function inp(dark) {
  return {
    width: "100%", padding: "11px 13px", fontSize: 14, borderRadius: 10, boxSizing: "border-box",
    border: `1.5px solid ${dark ? "#3a3a3a" : "#e5e7eb"}`,
    background: dark ? "#1a1a1a" : "#f9fafb",
    color: dark ? "#f3f4f6" : "#111827",
    outline: "none", fontFamily: "inherit",
  };
}

function Label({ children, dark, optional }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: dark ? "#9ca3af" : "#6b7280", marginBottom: 4 }}>
      {children}{optional && <span style={{ fontWeight: 400, marginLeft: 4, opacity: 0.7 }}>(optional)</span>}
    </div>
  );
}

function Card({ children, dark, style }) {
  return (
    <div style={{
      background: dark ? "#111" : "#fff",
      border: `1.5px solid ${dark ? "#252525" : "#e5e7eb"}`,
      borderRadius: 14, padding: 18,
      ...style,
    }}>
      {children}
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, loading, dark }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
        background: disabled || loading ? (dark ? "#292929" : "#e5e7eb") : "linear-gradient(135deg,#FF6B35,#FF8C42)",
        color: disabled || loading ? (dark ? "#555" : "#aaa") : "#fff",
        fontWeight: 700, fontSize: 14, cursor: disabled || loading ? "not-allowed" : "pointer",
      }}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

// ── Guarantor fields ──────────────────────────────────────────────────────────

function GuarantorGroup({ num, value, onChange, dark }) {
  const f = (k) => (
    <input
      value={value[k] || ""}
      onChange={e => onChange({ ...value, [k]: e.target.value })}
      style={inp(dark)}
    />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: dark ? "#d1d5db" : "#374151" }}>
        Guarantor {num}
      </div>
      <div><Label dark={dark}>Full legal name</Label>{f("name")}</div>
      <div>
        <Label dark={dark}>Phone number</Label>
        <input value={value.phone || ""} onChange={e => onChange({ ...value, phone: e.target.value })}
          placeholder="08012345678" inputMode="tel" style={inp(dark)} />
      </div>
      <div><Label dark={dark} optional>Email address</Label>{f("email")}</div>
      <div><Label dark={dark}>Home / business address</Label>{f("address")}</div>
      <div><Label dark={dark} optional>NIN (11 digits)</Label>
        <input value={value.nin || ""} onChange={e => onChange({ ...value, nin: e.target.value.replace(/\D/g, "") })}
          maxLength={11} inputMode="numeric" placeholder="12345678901" style={inp(dark)} />
      </div>
    </div>
  );
}

// ── Tier 1 form ───────────────────────────────────────────────────────────────

function Tier1Form({ dark, status, profile, onSuccess }) {
  const [nin,     setNin]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubmit() {
    if (nin.length !== 11) { setError("NIN must be exactly 11 digits."); return; }
    setSubmitting(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("verify-identity", {
        body: { action: "tier1_submit", nin },
      });
      if (fnErr) throw fnErr;
      if (!data.success && data.error) { setError(data.error); return; }
      onSuccess(data);
    } catch (e) {
      setError(e.message || "Verification failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canRetry = status === "tier1_failed" || status === "unverified";

  return (
    <Card dark={dark}>
      <div style={{ fontWeight: 700, fontSize: 15, color: dark ? "#f3f4f6" : "#111827", marginBottom: 4 }}>
        Step 1 — Verify your identity
      </div>
      <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
        Your NIN is matched against your settlement account name. This is instant and automated — no human sees your NIN.
      </div>

      {canRetry && status === "tier1_failed" && (
        <div style={{
          background: dark ? "#2a1111" : "#fef2f2", borderRadius: 8,
          padding: "10px 12px", marginBottom: 14, fontSize: 12,
          color: dark ? "#fca5a5" : "#b91c1c", lineHeight: 1.5,
        }}>
          <strong>Previous attempt failed:</strong> {profile.verification_rejected_reason}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Label dark={dark}>National Identification Number (NIN)</Label>
        <input
          value={nin}
          onChange={e => setNin(e.target.value.replace(/\D/g, ""))}
          maxLength={11}
          inputMode="numeric"
          placeholder="12345678901"
          style={inp(dark)}
        />
        <div style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", marginTop: 4 }}>
          11 digits · as printed on your National ID card
        </div>
      </div>

      {error && (
        <div style={{ background: dark ? "#2a1111" : "#fef2f2", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      <PrimaryBtn onClick={handleSubmit} loading={submitting} dark={dark}>
        Verify Identity
      </PrimaryBtn>

      <div style={{ marginTop: 10, fontSize: 11, color: dark ? "#4b5563" : "#9ca3af", textAlign: "center", lineHeight: 1.5 }}>
        🔒 Your NIN is transmitted securely and never stored in plain text.
        {" "}Face/liveness verification coming soon (Dojah / Prembly integration).
      </div>
    </Card>
  );
}

// ── Tier 1 result ─────────────────────────────────────────────────────────────

function Tier1Result({ dark, status, profile }) {
  const ok = status === "tier1_verified" || status === "tier2_required" || status === "tier2_pending" || status === "tier2_verified";
  return (
    <Card dark={dark} style={{ background: ok ? (dark ? "#0f2a0f" : "#f0fdf4") : (dark ? "#2a1111" : "#fef2f2") }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }}>{ok ? "✅" : "❌"}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: ok ? "#16a34a" : "#ef4444" }}>
            {ok ? "NIN verified" : "NIN verification failed"}
          </div>
          {profile.verified_name && (
            <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginTop: 2 }}>
              Verified as: <strong>{profile.verified_name}</strong>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Tier 2 form ───────────────────────────────────────────────────────────────

function Tier2Form({ dark, userId, profile, onSuccess }) {
  const [docFile,    setDocFile]    = useState(null);
  const [docName,    setDocName]    = useState(profile.reg_doc_url ? "Previously uploaded" : "");
  const [docUrl,     setDocUrl]     = useState(profile.reg_doc_url || "");
  const [g1,         setG1]         = useState({ name: "", phone: "", email: "", address: "", nin: "" });
  const [g2,         setG2]         = useState({ name: "", phone: "", email: "", address: "", nin: "" });
  const [uploading,  setUploading]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  async function uploadDoc(file) {
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      const path = `${userId}/tier2_doc.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      return publicUrl;
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    setError("");
    if (!docUrl && !docFile) { setError("Please upload your business document."); return; }
    if (!g1.name || !g1.phone) { setError("Guarantor 1 requires at least a name and phone number."); return; }
    if (!g2.name || !g2.phone) { setError("Guarantor 2 requires at least a name and phone number."); return; }

    setSubmitting(true);
    try {
      let finalDocUrl = docUrl;
      if (docFile) {
        finalDocUrl = await uploadDoc(docFile);
        setDocUrl(finalDocUrl);
      }
      const { data, error: fnErr } = await supabase.functions.invoke("verify-identity", {
        body: {
          action: "tier2_submit",
          doc_url: finalDocUrl,
          guarantor1_name:    g1.name,    guarantor1_phone: g1.phone,
          guarantor1_email:   g1.email,   guarantor1_address: g1.address, guarantor1_nin: g1.nin,
          guarantor2_name:    g2.name,    guarantor2_phone: g2.phone,
          guarantor2_email:   g2.email,   guarantor2_address: g2.address, guarantor2_nin: g2.nin,
        },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      onSuccess({ status: "tier2_pending" });
    } catch (e) {
      setError(e.message || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card dark={dark}>
      <div style={{ fontWeight: 700, fontSize: 15, color: dark ? "#f3f4f6" : "#111827", marginBottom: 4 }}>
        Step 2 — Enhanced verification
      </div>
      <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginBottom: 6, lineHeight: 1.6 }}>
        Required because {profile.tier2_trigger_detail || "your account requires additional due diligence."} A KudiTrack admin will review your documents within 2–3 business days.
      </div>

      {/* Why required — context-sensitive */}
      <div style={{
        background: dark ? "#1a1a00" : "#fffbeb", border: `1px solid ${dark ? "#3a3a00" : "#fde68a"}`,
        borderRadius: 8, padding: "8px 12px", marginBottom: 16,
        fontSize: 12, color: dark ? "#fde68a" : "#92400e", lineHeight: 1.5,
      }}>
        ⚠ {profile.tier2_trigger === "savings_threshold"
          ? "Your Ajo account holds over ₦500,000 in client savings. This threshold requires a guarantor review."
          : "Your account has been flagged for additional review."}
      </div>

      {/* Document upload */}
      <div style={{ marginBottom: 16 }}>
        <Label dark={dark}>Business document</Label>
        <div style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 6, lineHeight: 1.5 }}>
          CAC certificate, business name certificate, or government-issued registration document. PDF or image.
        </div>
        <label style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", borderRadius: 10, cursor: "pointer",
          border: `1.5px dashed ${dark ? "#3a3a3a" : "#d1d5db"}`,
          color: dark ? "#9ca3af" : "#6b7280", fontSize: 13,
          background: dark ? "#111" : "#f9fafb",
        }}>
          <span style={{ fontSize: 20 }}>📎</span>
          <span style={{ flex: 1 }}>{uploading ? "Uploading…" : (docName || "Choose file…")}</span>
          <input type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setDocFile(f);
              setDocName(f.name);
            }} />
        </label>
      </div>

      {/* Guarantors */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ height: 1, background: dark ? "#252525" : "#f0f0f0" }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#9ca3af" : "#6b7280" }}>
          Two guarantors — each independently verified
        </div>
        <div style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", lineHeight: 1.5, marginTop: -8 }}>
          Guarantors must be individuals (not companies) who can vouch for your business identity. They do not need to have a KudiTrack account.
        </div>
        <GuarantorGroup num={1} value={g1} onChange={setG1} dark={dark} />
        <div style={{ height: 1, background: dark ? "#252525" : "#f0f0f0" }} />
        <GuarantorGroup num={2} value={g2} onChange={setG2} dark={dark} />
      </div>

      {error && (
        <div style={{ background: dark ? "#2a1111" : "#fef2f2", borderRadius: 8, padding: "10px 12px", marginTop: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <PrimaryBtn onClick={handleSubmit} loading={submitting || uploading} dark={dark}>
          Submit for Review
        </PrimaryBtn>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: dark ? "#4b5563" : "#9ca3af", textAlign: "center", lineHeight: 1.5 }}>
        After submission you continue using KudiTrack fully. No features are locked while under review.
      </div>
    </Card>
  );
}

// ── Pending / approved / rejected statuses ────────────────────────────────────

function StatusCard({ dark, status, profile, submission }) {
  const cfg = STATUS[status] || STATUS.unverified;
  const dark_bg = dark ? "#111" : cfg.bg;

  return (
    <Card dark={dark} style={{ background: dark_bg }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: cfg.color + "22",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, flexShrink: 0,
        }}>
          {cfg.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: cfg.color }}>
            {cfg.label}
          </div>
          {status === "tier1_pending" && (
            <div style={{ fontSize: 12, color: dark ? "#93c5fd" : "#1d4ed8", marginTop: 4, lineHeight: 1.5 }}>
              Your NIN has been received and is being reviewed. Expect a decision within 1–2 business days. You will be notified when approved.
            </div>
          )}
          {status === "tier2_pending" && (
            <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
              Your documents are being reviewed. Expect a decision within 2–3 business days. You will be notified when done.
            </div>
          )}
          {status === "tier2_verified" && (
            <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4, lineHeight: 1.5 }}>
              Your business is fully verified. A verified badge is now shown to your clients.
            </div>
          )}
          {status === "tier2_rejected" && submission?.rejection_reason && (
            <div style={{ fontSize: 12, color: dark ? "#fca5a5" : "#b91c1c", marginTop: 4, lineHeight: 1.5 }}>
              <strong>Reason:</strong> {submission.rejection_reason}
              <div style={{ marginTop: 6, color: dark ? "#9ca3af" : "#6b7280" }}>
                Please address the issue above and resubmit.
              </div>
            </div>
          )}
          {profile.verified_name && (status === "tier1_verified" || status === "tier2_verified") && (
            <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", marginTop: 4 }}>
              Verified name: <strong>{profile.verified_name}</strong>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function Verification({ store }) {
  const navigate = useNavigate();
  const profile  = store.profile || {};
  const dark     = profile.dark_mode ?? false;
  const userId   = profile.id;

  const [status,     setStatus]     = useState(profile.verification_status || "unverified");
  const [submission, setSubmission] = useState(null);
  const [loading,    setLoading]    = useState(true);

  // Load live status from edge function on mount
  useEffect(() => {
    if (!userId) return;
    supabase.functions.invoke("verify-identity", { body: { action: "get_status" } })
      .then(({ data }) => {
        if (data?.status?.verification_status) setStatus(data.status.verification_status);
        if (data?.submission) setSubmission(data.submission);
      })
      .catch(() => {
        // Use store value as fallback
        setStatus(profile.verification_status || "unverified");
      })
      .finally(() => setLoading(false));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTier1Success(data) {
    setStatus(data.status);
    store.setProfile(prev => ({
      ...prev,
      verification_status: data.status,
      ...(data.verifiedName ? { verified_name: data.verifiedName } : {}),
    }));
  }

  function handleTier2Success(data) {
    setStatus(data.status);
    store.setProfile(prev => ({ ...prev, verification_status: data.status }));
  }

  const showTier1Form    = status === "unverified" || status === "tier1_failed";
  const showTier1Result  = ["tier1_verified","tier2_required","tier2_pending","tier2_verified","tier2_rejected"].includes(status);
  const showTier1Pending = status === "tier1_pending";
  const showTier2Form    = (status === "tier2_required" || status === "tier2_rejected") && status !== "tier2_pending" && status !== "tier2_verified";
  const showTier2Status  = ["tier2_pending","tier2_verified","tier2_rejected"].includes(status);

  return (
    <div style={{ minHeight: "100dvh", background: dark ? "#0a0a0a" : "#f9fafb" }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 14,
        background: dark ? "#0a0a0a" : "#fff",
        borderBottom: `1px solid ${dark ? "#1f1f1f" : "#e5e7eb"}`,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: dark ? "#9ca3af" : "#6b7280" }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, color: dark ? "#f3f4f6" : "#111827" }}>
            Business Verification
          </div>
          <div style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", marginTop: 1 }}>
            Required for paid plan upgrades and withdrawal approval
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #FF6B35", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : (
        <div style={{ padding: "20px 16px 48px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 480, margin: "0 auto" }}>

          {/* Top status banner */}
          <StatusCard dark={dark} status={status} profile={profile} submission={submission} />

          {/* What verification enables */}
          <Card dark={dark} style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: dark ? "#9ca3af" : "#6b7280", lineHeight: 1.6 }}>
              <strong style={{ color: dark ? "#d1d5db" : "#374151" }}>Why verify?</strong>{" "}
              Verification is required to upgrade to a paid plan and to enable withdrawal to your settlement account.
              It also unlocks a Verified badge visible to your clients. Verification never blocks current features.
            </div>
          </Card>

          {/* Tier 1 form or result */}
          {showTier1Result && (
            <Tier1Result dark={dark} status={status} profile={profile} />
          )}
          {showTier1Pending && (
            <Card dark={dark} style={{ background: dark ? "#0f1a2a" : "#eff6ff", border: `1.5px solid ${dark ? "#1a2a3a" : "#bfdbfe"}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#93c5fd" : "#1d4ed8", marginBottom: 6 }}>
                ⏳ NIN submitted — under review
              </div>
              <div style={{ fontSize: 12, color: dark ? "#93c5fd" : "#3b82f6", lineHeight: 1.6 }}>
                Your NIN has been securely received. A KudiTrack admin will review and approve your identity within 1–2 business days. You will be notified by app notification when the decision is made.
              </div>
            </Card>
          )}
          {showTier1Form && (
            <Tier1Form dark={dark} status={status} profile={profile} onSuccess={handleTier1Success} />
          )}

          {/* Tier 2 form */}
          {showTier2Form && (
            <Tier2Form dark={dark} userId={userId} profile={profile} onSuccess={handleTier2Success} />
          )}

          {/* Tier 2 pending/approved/rejected banner */}
          {showTier2Status && (
            <Card dark={dark} style={{ background: dark ? "#0f1a2a" : "#eff6ff", border: `1.5px solid ${dark ? "#1a2a3a" : "#bfdbfe"}` }}>
              <div style={{ fontSize: 12, color: dark ? "#93c5fd" : "#1d4ed8", lineHeight: 1.6 }}>
                {status === "tier2_pending" && "⏳ Your documents are under review. You will receive a notification when a decision is made (typically 2–3 business days)."}
                {status === "tier2_verified" && "✅ Your account is fully verified. A verified badge is shown on your business profile."}
                {status === "tier2_rejected" && "↩ Please fix the issue described above and resubmit your documents."}
              </div>
            </Card>
          )}

          {/* Admin workload note — visible to business owner */}
          <Card dark={dark} style={{ background: dark ? "#0a0a0a" : "#f8fafc", padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: dark ? "#4b5563" : "#9ca3af", lineHeight: 1.7 }}>
              <strong style={{ color: dark ? "#6b7280" : "#6b7280" }}>About review times:</strong>{" "}
              Step 1 (NIN) is reviewed manually within 1–2 business days.
              Step 2 (documents + guarantors) also requires admin review — typically 2–3 business days.
              Reviews happen Monday–Friday during business hours.
            </div>
          </Card>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
