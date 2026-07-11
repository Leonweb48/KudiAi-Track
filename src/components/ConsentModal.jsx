/* ConsentModal — mandatory full-screen consent gate, cannot be dismissed */
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";

/* ── Inner document viewer (bottom-sheet style) ──────────────────────── */
function LegalViewerModal({ doc, onClose }) {
  if (!doc) return null;
  const title = doc.type === "tnc"
    ? `Terms & Conditions — Version ${doc.version}`
    : `Privacy Policy — Version ${doc.version}`;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/80 flex items-end justify-center">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl flex flex-col max-h-[85dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white flex-1 pr-4 leading-snug">{title}</p>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <style>{`
            .lv-content h2 { color: #16255A; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin: 18px 0 7px; }
            .lv-content h3 { color: #1e293b; font-weight: 700; font-size: 12px; margin: 13px 0 5px; }
            .lv-content p  { color: #64748b; font-size: 12.5px; line-height: 1.65; margin-bottom: 7px; }
            .lv-content ul, .lv-content ol { padding-left: 18px; margin-bottom: 10px; }
            .lv-content li { color: #64748b; font-size: 12.5px; line-height: 1.65; margin-bottom: 3px; }
            .lv-content a  { color: #3DA829; text-decoration: underline; }
            @media (prefers-color-scheme: dark) {
              .lv-content h2 { color: #93c5fd; border-bottom-color: #334155; }
              .lv-content h3 { color: #e2e8f0; }
              .lv-content p, .lv-content li { color: #94a3b8; }
            }
          `}</style>
          <div className="lv-content" dangerouslySetInnerHTML={{ __html: doc.content }} />
        </div>
      </div>
    </div>
  );
}

/* ── Green shield icon ───────────────────────────────────────────────── */
function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9" stroke="#3DA829" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#3DA829" fillOpacity={0.15} />
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

/* ── Custom checkbox ─────────────────────────────────────────────────── */
function Checkbox({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-150 ${
        checked
          ? "bg-green-500 border-green-500 scale-105"
          : "border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800"
      }`}
      aria-checked={checked}
      role="checkbox"
      type="button"
    >
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="white" strokeWidth={3} strokeLinecap="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

/* ── Main export ─────────────────────────────────────────────────────── */
export default function ConsentModal({ userId, onGranted, isReConsent = false, changeSummary = null }) {
  const [tncDoc,      setTncDoc]      = useState(null);
  const [privacyDoc,  setPrivacyDoc]  = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [tncChecked,  setTncChecked]  = useState(false);
  const [privChecked, setPrivChecked] = useState(false);
  const [viewer,      setViewer]      = useState(null);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    async function fetchDocs() {
      const [tncRes, privRes] = await Promise.all([
        supabase
          .from("legal_documents")
          .select("id, version, content, type")
          .eq("type", "tnc")
          .eq("status", "published")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("legal_documents")
          .select("id, version, content, type")
          .eq("type", "privacy")
          .eq("status", "published")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      // If no published documents exist at all, skip consent gracefully
      if (!tncRes.data && !privRes.data) {
        onGranted();
        return;
      }

      setTncDoc(tncRes.data || null);
      setPrivacyDoc(privRes.data || null);
      setLoading(false);
    }
    fetchDocs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canContinue = tncChecked && privChecked;

  const handleAgree = async () => {
    if (!canContinue || saving) return;
    setSaving(true);

    // Try to fetch IP address (3-second timeout, fail silently)
    let ipAddress = null;
    try {
      const ctrl   = new AbortController();
      const timer  = setTimeout(() => ctrl.abort(), 3000);
      const res    = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        ipAddress = data.ip || null;
      }
    } catch (_) { /* fail silently */ }

    await supabase.from("user_consents").insert({
      user_id:         userId,
      tnc_version:     tncDoc?.version     ?? 1,
      privacy_version: privacyDoc?.version ?? 1,
      ip_address:      ipAddress,
    });

    onGranted();
  };

  // Still loading docs — render nothing (avoids flash)
  if (loading) return null;

  return (
    <>
      {/* Full-screen overlay — no click-outside dismiss */}
      <div className="fixed inset-0 z-[90] bg-slate-900/95 flex items-center justify-center px-4">
        <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl p-6 shadow-2xl">

          {/* Icon + title */}
          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-16 h-16 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-3">
              <ShieldCheckIcon />
            </div>

            {isReConsent ? (
              <>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  We've Updated Our Terms
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed max-w-xs">
                  {changeSummary ||
                    "Our Terms & Conditions and Privacy Policy have been updated. Please review and re-accept to continue."}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  One Last Step
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed max-w-xs">
                  Please review and accept our legal documents to continue.
                </p>
              </>
            )}
          </div>

          {/* Checkbox rows */}
          <div className="space-y-3 mb-6">
            {/* Terms & Conditions */}
            {tncDoc && (
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600">
                <Checkbox checked={tncChecked} onChange={() => setTncChecked(v => !v)} />
                <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-snug">
                  I have read and agree to the{" "}
                  <button
                    onClick={() => setViewer(tncDoc)}
                    className="font-semibold text-green-600 dark:text-green-400 underline underline-offset-2"
                    type="button"
                  >
                    Terms & Conditions (v{tncDoc.version})
                  </button>
                </p>
              </div>
            )}

            {/* Privacy Policy */}
            {privacyDoc && (
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600">
                <Checkbox checked={privChecked} onChange={() => setPrivChecked(v => !v)} />
                <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-snug">
                  I have read and understand the{" "}
                  <button
                    onClick={() => setViewer(privacyDoc)}
                    className="font-semibold text-green-600 dark:text-green-400 underline underline-offset-2"
                    type="button"
                  >
                    Privacy Policy (v{privacyDoc.version})
                  </button>
                </p>
              </div>
            )}
          </div>

          {/* CTA */}
          <button
            onClick={handleAgree}
            disabled={!canContinue || saving}
            type="button"
            className={`w-full py-4 rounded-2xl font-bold text-sm text-white transition-all duration-150 ${
              canContinue && !saving
                ? "bg-green-600 hover:bg-green-700 active:scale-[0.98]"
                : "bg-slate-300 dark:bg-slate-600 opacity-40 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving…" : "Agree and Continue"}
          </button>

          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-3">
            You must accept both documents to use KudiAI
          </p>
        </div>
      </div>

      {/* Document viewer — above the consent modal */}
      {viewer && <LegalViewerModal doc={viewer} onClose={() => setViewer(null)} />}
    </>
  );
}
