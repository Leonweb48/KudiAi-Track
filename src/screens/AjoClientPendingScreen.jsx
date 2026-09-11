import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";

export default function AjoClientPendingScreen({ ajoClient }) {
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
        <p className="text-slate-400 text-sm">KudiAI Ajo Portal</p>
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
              <p className="text-white font-semibold text-sm">{rejected ? "Registration Declined" : "Registration Submitted"}</p>
              <p className="text-slate-400 text-xs">{rejected ? "Not approved" : "Awaiting review"}</p>
            </div>
          </div>
          {ajoClient?.full_name && (
            <p className="text-slate-300 text-sm leading-relaxed">
              Hi <span className="font-semibold text-white">{ajoClient.full_name}</span>,{" "}
              {rejected ? (
                <>your registration with <span className="font-semibold text-white">{businessName || "this business"}</span> was declined. Contact them directly if you believe this is a mistake.</>
              ) : (
                <>your registration with <span className="font-semibold text-white">{businessName || "your savings collector"}</span> is being reviewed. You'll get in once they set your contribution terms and approve — usually quick.</>
              )}
            </p>
          )}
        </div>

        <button onClick={signOut} className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-medium">
          Sign Out
        </button>
      </div>
    </div>
  );
}
