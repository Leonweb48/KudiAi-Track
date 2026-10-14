import { useState, useEffect, Fragment } from "react";
import { supabase } from "../utils/supabase";
import { useT } from "../contexts/LanguageContext";

// label / desc are translation keys (circles.js)
const STATUS_COPY = {
  pending:        { label: "circles.arch.pending",       color: "text-amber-400",   desc: "circles.arch.pendingDesc" },
  owner_approved: { label: "circles.arch.ownerApproved", color: "text-blue-400",    desc: "circles.arch.ownerApprovedDesc" },
  owner_rejected: { label: "circles.arch.rejected",      color: "text-red-400",     desc: "circles.arch.ownerRejectedDesc" },
  admin_approved: { label: "circles.arch.adminApproved", color: "text-green-400",   desc: "circles.arch.adminApprovedDesc" },
  admin_rejected: { label: "circles.arch.rejected",      color: "text-red-400",     desc: "circles.arch.adminRejectedDesc" },
};

// Fill {name}-style slots in translated text with elements (bold names); the rest stays plain text.
function withNodes(text, nodes) {
  return String(text).split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] !== undefined ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
}

async function ajoPortal(action, body) {
  const { data } = await supabase.functions.invoke("ajo-portal", { body: { action, ...body } });
  return data;
}

export default function AjoClientArchivedScreen({ ajoClient }) {
  const t = useT();
  const [existing, setExisting]   = useState(undefined); // undefined=loading, null=none
  const [reason,   setReason]     = useState("");
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState("");
  const [done,     setDone]       = useState(false);

  const clientId = ajoClient?.id;

  useEffect(() => {
    if (!clientId) return;
    ajoPortal("get-reactivation-status", { client_id: clientId })
      .then(d => setExisting(d?.request ?? null))
      .catch(() => setExisting(null));
  }, [clientId]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setError(t("circles.arch.errReason")); return; }
    setError(""); setLoading(true);
    try {
      const res = await ajoPortal("request-reactivation", { client_id: clientId, reason: reason.trim() });
      if (res?.error) {
        if (res.status === "pending" || res.status === "owner_approved") {
          setExisting({ status: res.status });
        } else {
          setError(res.error);
        }
      } else if (res?.ok) {
        setExisting(res.request);
        setDone(true);
      }
    } catch {
      setError(t("common.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  const statusCfg = existing ? STATUS_COPY[existing.status] : null;
  const canResubmit = existing?.status === "owner_rejected" || existing?.status === "admin_rejected";

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      {/* Logo / brand */}
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-black text-2xl">K</span>
        </div>
        <p className="text-slate-400 text-sm">{t("circles.ajoPortalTrack")}</p>
      </div>

      <div className="w-full max-w-sm">
        {/* Archived notice */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{t("circles.arch.title")}</p>
              <p className="text-slate-400 text-xs">{t("circles.arch.suspended")}</p>
            </div>
          </div>
          {ajoClient?.full_name && (
            <p className="text-slate-300 text-sm">
              {withNodes(t("circles.arch.body"), { name: <span className="font-semibold text-white">{ajoClient.full_name}</span> })}
            </p>
          )}
        </div>

        {/* Existing request status */}
        {existing === undefined && (
          <div className="text-center py-4 text-slate-500 text-sm">{t("circles.arch.checking")}</div>
        )}

        {existing && !canResubmit && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">{t("circles.arch.requestHeading")}</p>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${statusCfg?.color?.replace("text-", "bg-")} flex-shrink-0`} />
              <span className={`font-semibold text-sm ${statusCfg?.color}`}>{statusCfg && t(statusCfg.label)}</span>
            </div>
            <p className="text-slate-400 text-xs">{statusCfg && t(statusCfg.desc)}</p>
            {existing.status === "admin_approved" && (
              <button
                onClick={signOut}
                className="mt-4 w-full py-2.5 rounded-xl bg-green-500 text-white text-sm font-bold"
              >
                {t("circles.arch.signOutBackIn")}
              </button>
            )}
          </div>
        )}

        {/* Reactivation form — show when no request exists or previous was rejected */}
        {(existing === null || canResubmit) && !done && (
          <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
            <p className="text-white font-semibold text-sm mb-1">{t("circles.arch.requestTitle")}</p>
            <p className="text-slate-400 text-xs mb-4">
              {t("circles.arch.requestIntro")}
            </p>
            <label className="block text-xs text-slate-400 mb-1 font-medium">{t("circles.arch.reasonLabel")}</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder={t("circles.arch.reasonPh")}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm resize-none placeholder-slate-500 focus:outline-none focus:border-green-500 mb-3"
            />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-green-500 text-white text-sm font-bold disabled:opacity-50"
            >
              {loading ? t("circles.arch.submitting") : t("circles.arch.submit")}
            </button>
          </form>
        )}

        {done && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 mb-5 text-center">
            <p className="text-green-400 font-semibold text-sm mb-1">{t("circles.arch.pending")}</p>
            <p className="text-slate-400 text-xs">{t("circles.arch.sentBody")}</p>
          </div>
        )}

        <button
          onClick={signOut}
          className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-medium"
        >
          {t("circles.signOut")}
        </button>
      </div>
    </div>
  );
}
