import { useState, useEffect, useRef, useCallback } from "react";
import { usePaystackPayment } from "react-paystack";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";
import { PLAN_ORDER } from "../utils/plans";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

const isNative = Capacitor.isNativePlatform();

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 0,
    label: "Free forever",
    color: "gray",
    popular: false,
    features: [
      "Up to 100 transactions/month",
      "Basic profit & loss reports",
      "Credit sales tracking",
      "Customer records",
      "1 user account",
    ],
    missing: [
      "Aso savings management",
      "PDF export",
      "AI-powered insights",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: 2500,
    label: "/month",
    color: "green",
    popular: true,
    features: [
      "Unlimited transactions",
      "All Starter features",
      "Aso savings management",
      "PDF report export",
      "Advanced analytics dashboard",
      "Email support",
    ],
    missing: ["AI-powered insights"],
  },
  {
    id: "premium",
    name: "Premium",
    price: 5000,
    label: "/month",
    color: "purple",
    popular: false,
    features: [
      "Everything in Business",
      "AI-powered business insights",
      "WhatsApp payment reminders",
      "Priority customer support",
      "Multi-device access",
      "Custom business branding",
    ],
    missing: [],
  },
];

function CheckIcon({ color = "green" }) {
  return (
    <svg className={`w-4 h-4 shrink-0 ${color === "green" ? "text-green-500" : color === "purple" ? "text-purple-500" : "text-gray-400"}`}
      viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

// PaidButton must always call usePaystackPayment (React Hook rules),
// so it renders for any plan — callers decide whether to render it.
function PaidButton({ plan, session, onSuccess, disabled }) {
  const [ref] = useState(`kt-${plan.id}-${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [nativeErr, setNativeErr] = useState("");

  const config = {
    reference: ref,
    email:     session.user.email,
    amount:    plan.price * 100,
    publicKey: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || "",
    metadata: {
      custom_fields: [{ display_name: "Plan", variable_name: "plan", value: plan.name }],
    },
  };

  const initPayment = usePaystackPayment(config);

  const cls = plan.id === "premium"
    ? "w-full py-2.5 rounded-xl font-semibold text-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors"
    : "w-full py-2.5 rounded-xl font-semibold text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors";

  const handleClick = async () => {
    if (isNative) {
      setBusy(true);
      setNativeErr("");
      try {
        const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL  || "";
        const supabaseAnon = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

        const res = await fetch(
          `${supabaseUrl}/functions/v1/initialize-payment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnon}`,
              "apikey": supabaseAnon,
            },
            body: JSON.stringify({
              email: session.user.email,
              amount: plan.price * 100,
              reference: ref,
              planId: plan.id,
            }),
          }
        );

        const data = await res.json();

        if (!res.ok || !data.authorization_url) {
          throw new Error(data.error || `Server error ${res.status}`);
        }

        localStorage.setItem(
          "pendingPayment",
          JSON.stringify({ planId: plan.id, reference: data.reference || ref })
        );
        await Browser.open({ url: data.authorization_url });
      } catch (err) {
        setNativeErr(err.message);
      } finally {
        setBusy(false);
      }
    } else {
      initPayment({ onSuccess, onClose: () => {} });
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        disabled={disabled || busy}
        onClick={handleClick}
        className={cls}
      >
        {busy ? "Opening Paystack…" : `Subscribe — ₦${plan.price.toLocaleString()}/mo`}
      </button>
      {nativeErr && (
        <p className="text-[10px] text-red-500 text-center">{nativeErr}</p>
      )}
    </div>
  );
}

export default function SubscriptionPlan({ session, onComplete, onClose, isUpgrade = false, currentPlan = "starter" }) {
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  // Shown when user returns from browser without the deep link firing
  const [pendingPayment, setPendingPayment] = useState(
    () => JSON.parse(localStorage.getItem("pendingPayment") || "null")
  );

  const saveSubRef = useRef(null);

  const saveSub = useCallback(async (planId, reference) => {
    setSaving(true);
    setError("");
    try {
      const expiresAt = planId === "starter"
        ? null
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Upsert: update existing subscription if one exists, else insert
      const { data: existing } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      let err;
      if (existing) {
        ({ error: err } = await supabase.from("subscriptions").update({
          plan:               planId,
          status:             "active",
          paystack_reference: reference || null,
          expires_at:         expiresAt,
        }).eq("id", existing.id));
      } else {
        ({ error: err } = await supabase.from("subscriptions").insert({
          user_id:            session.user.id,
          plan:               planId,
          status:             "active",
          paystack_reference: reference || null,
          expires_at:         expiresAt,
        }));
      }

      if (err) throw err;
      setPendingPayment(null);
      localStorage.removeItem("pendingPayment");
      onComplete(planId);
    } catch (e) {
      setError(e.message || "Could not save plan. Please try again.");
      setSaving(false);
    }
  }, [session, onComplete]);

  saveSubRef.current = saveSub;

  // Listen for deep-link callback from Paystack (dispatched by useAuth)
  useEffect(() => {
    const handler = () => {
      const pending = JSON.parse(localStorage.getItem("pendingPayment") || "null");
      if (!pending) return;
      setPendingPayment(null);
      localStorage.removeItem("pendingPayment");
      saveSubRef.current(pending.planId, pending.reference);
    };
    window.addEventListener("paymentCallback", handler);
    return () => window.removeEventListener("paymentCallback", handler);
  }, []);

  const handleFree = () => saveSub("starter", null);
  const handlePaid = (planId) => (ref) => saveSub(planId, ref.reference);

  const currentIdx = PLAN_ORDER.indexOf(currentPlan);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="relative text-center mb-8">
          {isUpgrade && onClose && (
            <button onClick={onClose}
              className="absolute left-0 top-0 w-9 h-9 flex items-center justify-center rounded-full bg-white/70 dark:bg-slate-700/70 text-slate-500 dark:text-slate-300 hover:bg-white transition-colors shadow">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <AppLogo className="h-14 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
            {isUpgrade ? "Upgrade your plan" : "Choose your plan"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            {isUpgrade ? "Unlock more features for your business." : "Start free. Upgrade anytime. Cancel anytime."}
          </p>
        </div>

        {pendingPayment && (
          <div className="mb-4 max-w-sm mx-auto bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-green-800 mb-2">Payment completed?</p>
            <button
              onClick={() => {
                const p = pendingPayment;
                setPendingPayment(null);
                localStorage.removeItem("pendingPayment");
                saveSub(p.planId, p.reference);
              }}
              disabled={saving}
              className="text-sm font-bold text-white bg-green-600 hover:bg-green-700 px-5 py-2 rounded-lg disabled:opacity-50"
            >
              Activate My Plan
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 max-w-sm mx-auto text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-center">
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent  = isUpgrade && plan.id === currentPlan;
            const planIdx    = PLAN_ORDER.indexOf(plan.id);
            const isDowngrade = isUpgrade && planIdx < currentIdx;

            return (
              <div key={plan.id}
                className={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-md p-6 flex flex-col
                  ${plan.popular && !isCurrent ? "ring-2 ring-green-500" : ""}
                  ${plan.id === "premium" && !isCurrent ? "ring-2 ring-purple-400" : ""}
                  ${isCurrent ? "ring-2 ring-blue-400 opacity-75" : ""}`}>

                {isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                      Current Plan
                    </span>
                  </div>
                )}
                {!isCurrent && plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                      Most Popular
                    </span>
                  </div>
                )}
                {!isCurrent && plan.id === "premium" && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                      Best Value
                    </span>
                  </div>
                )}

                {/* Price */}
                <div className="mb-5">
                  <h2 className="text-base font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide">{plan.name}</h2>
                  <div className="mt-2 flex items-end gap-1">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-extrabold text-gray-800 dark:text-white">Free</span>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{plan.price.toLocaleString()}</span>
                        <span className="text-sm text-gray-400 mb-1">{plan.label}</span>
                      </>
                    )}
                  </div>
                  {plan.price === 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">{plan.label}</p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-300">
                      <CheckIcon color={plan.id === "premium" ? "purple" : plan.id === "business" ? "green" : "gray"} />
                      <span>{f}</span>
                    </li>
                  ))}
                  {plan.missing.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-400 line-through">
                      <XIcon />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <button disabled className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-blue-300 text-blue-400 cursor-default opacity-60">
                    ✓ Active Plan
                  </button>
                ) : isDowngrade ? (
                  <button onClick={plan.id === "starter" ? handleFree : undefined} disabled={saving || plan.id !== "starter"}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 transition-colors text-xs">
                    {plan.id === "starter" ? "Downgrade to Free" : "Not available"}
                  </button>
                ) : plan.id === "starter" ? (
                  <button onClick={handleFree} disabled={saving}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    Get Started Free
                  </button>
                ) : (
                  <PaidButton plan={plan} session={session} disabled={saving} onSuccess={handlePaid(plan.id)} />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-slate-500 mt-6">
          Secure payment via Paystack · Paid plans renew monthly · Cancel anytime
        </p>
      </div>
    </div>
  );
}
