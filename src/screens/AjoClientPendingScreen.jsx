import { useState, useEffect, Fragment } from "react";
import { supabase } from "../utils/supabase";
import { registrationFeeNotice } from "../utils/registrationFee";
import { useT } from "../contexts/LanguageContext";

// Fill {name}-style slots in translated text with elements (bold names); the rest stays plain text.
function withNodes(text, nodes) {
  return String(text).split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] !== undefined ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
}

const naira = (n) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

export default function AjoClientPendingScreen({ ajoClient }) {
  const t = useT();
  const [businessName, setBusinessName] = useState("");
  const rejected = ajoClient?.status === "rejected";

  useEffect(() => {
    if (!ajoClient?.owner_id) return;
    supabase.functions.invoke("ajo-portal", { body: { action: "list-businesses" } })
      .then(({ data }) => {
        const match = (data?.businesses || []).find(b => b.id === ajoClient.owner_id);
        if (match) setBusinessName(match.business_name);
      })
      .catch(() => {});
  }, [ajoClient?.owner_id]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-black text-2xl">K</span>
        </div>
        <p className="text-slate-400 text-sm">{t("circles.ajoPortal")}</p>
      </div>

      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${rejected ? "bg-red-500/15" : "bg-amber-500/15"}`}>
              {rejected ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                </svg>
              )}
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{rejected ? t("circles.regDeclined") : t("circles.regSubmitted")}</p>
              <p className="text-slate-400 text-xs">{rejected ? t("circles.notApproved") : t("circles.awaitingReview")}</p>
            </div>
          </div>
          {ajoClient?.full_name && (
            <p className="text-slate-300 text-sm leading-relaxed">
              {withNodes(t(rejected ? "circles.declinedBody" : "circles.reviewBody"), {
                name: <span className="font-semibold text-white">{ajoClient.full_name}</span>,
                business: <span className="font-semibold text-white">{businessName || (rejected ? t("circles.thisBusiness") : t("circles.yourCollector"))}</span>,
              })}
            </p>
          )}
        </div>

        {!rejected && (() => {
          const n = registrationFeeNotice(ajoClient?.registration_charge, businessName);
          // the notice's wording, in the chosen language (registrationFeeNotice decides whether there is a fee and how much)
          const who = (businessName || "").trim() || t("circles.theBusiness");
          const headline = n.hasFee ? t("circles.regFee", { amount: naira(n.amount) }) : t("circles.noRegFee");
          const detail = n.hasFee ? t("circles.regFeeDetail", { who }) : t("circles.regNoFeeDetail", { who });
          return (
            <div className={`rounded-2xl px-4 py-3.5 mb-5 border ${n.hasFee ? "bg-amber-500/10 border-amber-500/30" : "bg-slate-900 border-slate-800"}`}>
              <p className={`text-sm font-semibold ${n.hasFee ? "text-amber-300" : "text-slate-300"}`}>{headline}</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{detail}</p>
            </div>
          );
        })()}

        <button onClick={signOut} className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-medium">
          {t("circles.signOut")}
        </button>
      </div>
    </div>
  );
}
