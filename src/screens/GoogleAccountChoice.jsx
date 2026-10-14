// A brand-new Google account that signed in from the Sign in tab hasn't said what it's for. Instead of starting business
// setup, ask: register a business, or open a KudiAI Wallet (save with a business — the client portal). useAuth sends
// such accounts here (status "choose_account"); onDone re-runs the routing once a choice is recorded.
import { useState, Fragment } from "react";
import { supabase } from "../utils/supabase";
import { useT } from "../contexts/LanguageContext";
import { AuthShell } from "../components/AuthShell";
import AppLogo from "../components/AppLogo";
import LegalScreen from "./LegalScreen";
import { AccountTypeOptions, WalletDetailsFields, useSavingBusinesses } from "../components/auth/SignupParts";
import { finishGoogleWalletSignup, markSignupChoice } from "../utils/googleWalletSignup";

// Fill {name}-style slots in translated text with elements (the bold email); the rest stays plain text.
function withNodes(text, nodes) {
  return String(text).split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] !== undefined ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
}

export default function GoogleAccountChoice({ session, onDone }) {
  const t = useT();
  const [step, setStep]       = useState("choose");   // "choose" | "wallet"
  const [phone, setPhone]     = useState("");
  const [agreed, setAgreed]   = useState(false);
  const [legalView, setLegal] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const { businesses, loading, businessId, setBusinessId } = useSavingBusinesses(step === "wallet");

  const meta = session?.user?.user_metadata || {};
  const firstName = String(meta.full_name || meta.name || "").trim().split(/\s+/)[0];
  const email = session?.user?.email || "";

  const asBusiness = async () => {
    setError(""); setBusy(true);
    if (!(await markSignupChoice(supabase, "business"))) {
      setError(t("circles.g.errSave"));
      setBusy(false);
      return;
    }
    onDone();
  };

  const asWallet = async () => {
    setError("");
    if (!businessId) { setError(t("circles.g.errBusiness")); return; }
    if (!agreed)     { setError(t("circles.g.errAgree")); return; }
    setBusy(true);
    const out = await finishGoogleWalletSignup(supabase, session, { business_id: businessId, phone, at: Date.now() });
    if (out.status === "failed") { setError(out.message); setBusy(false); return; }
    onDone();
  };

  return (
    <AuthShell variant="page">
      <div className="w-full max-w-md flex flex-col min-h-[100dvh] mx-auto">
        <div className="px-5 pb-7 flex flex-col items-center text-center"
          style={{ paddingTop: "max(40px, env(safe-area-inset-top, 40px))", background: "linear-gradient(135deg, #0f1c45 0%, #1e3a8a 100%)" }}>
          <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-4 py-2 shadow-sm mb-4">
            <AppLogo portal="public" className="h-8 w-auto" />
          </div>
          <h1 className="text-xl font-extrabold text-white">{firstName ? t("circles.g.welcomeName", { name: firstName }) : t("circles.g.welcome")}</h1>
          <p className="text-xs text-white/80 mt-1.5 leading-relaxed">
            {email
              ? withNodes(t("circles.g.signedInAs"), { email: <span className="font-semibold text-white">{email}</span> })
              : t("circles.g.signedIn")}
            <br />{t("circles.g.whatOpen")}
          </p>
        </div>

        <div className="flex-1 px-5 py-6">
          {step === "choose" ? (
            <AccountTypeOptions onBusiness={asBusiness} onWallet={() => { setError(""); setStep("wallet"); }} disabled={busy} />
          ) : (
            <div className="space-y-3.5">
              <button type="button" onClick={() => { setError(""); setStep("choose"); }} disabled={busy}
                className="text-sm text-emerald-600 font-medium flex items-center gap-1 hover:underline">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t("common.back")}
              </button>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("circles.g.openWallet")}</h2>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t("circles.g.walletIntro")}</p>
              </div>
              <WalletDetailsFields phone={phone} onPhone={setPhone}
                businesses={businesses} loading={loading} businessId={businessId} onBusinessId={setBusinessId}
                agreed={agreed} onToggleAgreed={() => setAgreed(v => !v)} onOpenLegal={setLegal} />
              <button type="button" onClick={asWallet} disabled={busy || loading || !businessId || !agreed}
                className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors shadow-sm">
                {busy ? t("circles.g.opening") : t("circles.g.openMine")}
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
              {error}
            </div>
          )}

          <button type="button" onClick={() => supabase.auth.signOut()} disabled={busy}
            className="w-full mt-6 py-2.5 text-sm font-semibold text-gray-500 dark:text-slate-400">
            {t("circles.g.notYou")}
          </button>
        </div>
      </div>
      {legalView && <LegalScreen type={legalView} onBack={() => setLegal(null)} />}
    </AuthShell>
  );
}
