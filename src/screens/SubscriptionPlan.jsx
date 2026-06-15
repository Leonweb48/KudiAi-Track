import { useState, useEffect, useRef, useCallback } from "react";
import { usePaystackPayment } from "react-paystack";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";
import { fetchAndCachePlans, getActivePlans, normalizeSlug, ALL_FEATURE_LIST } from "../utils/plans";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";

const isNative = Capacitor.isNativePlatform();

function CheckIcon({ color = "green" }) {
  const cls = color === "violet" ? "text-violet-500" : color === "amber" ? "text-amber-500" : color === "blue" ? "text-blue-500" : color === "gray" ? "text-gray-400" : "text-green-500";
  return (
    <svg className={`w-4 h-4 shrink-0 ${cls}`} viewBox="0 0 20 20" fill="currentColor">
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

// Derive a color from sort_order
function planColor(sortOrder) {
  return ["gray", "blue", "violet", "amber"][sortOrder] || "blue";
}

// Build the "missing" features list: features in ALL_FEATURE_LIST not in this plan's feature_keys
function getMissingFeatures(plan, allPlans) {
  const keys = Array.isArray(plan.feature_keys) ? plan.feature_keys : [];
  // Only show as missing if a higher-tier plan has it
  const higherKeys = new Set();
  allPlans.forEach(p => {
    if ((p.sort_order ?? 0) > (plan.sort_order ?? 0)) {
      (Array.isArray(p.feature_keys) ? p.feature_keys : []).forEach(k => higherKeys.add(k));
    }
  });
  return ALL_FEATURE_LIST
    .filter(f => !keys.includes(f.key) && higherKeys.has(f.key))
    .map(f => f.label);
}

// Derives display feature list from DB features array or feature_keys
function getDisplayFeatures(plan) {
  const arr = Array.isArray(plan.features) ? plan.features : [];
  if (arr.length > 0) return arr;
  // Fallback: build from feature_keys
  const keys = Array.isArray(plan.feature_keys) ? plan.feature_keys : [];
  const list = [];
  if (plan.price_monthly === 0) list.push(`${plan.max_transactions} transactions/mo`);
  else if (plan.max_transactions >= 999999) list.push("Unlimited transactions");
  else list.push(`${plan.max_transactions.toLocaleString()} transactions/mo`);
  if (plan.max_organizations > 1) list.push(`${plan.max_organizations} organizations`);
  if (plan.max_org_members > 5) list.push(`${plan.max_org_members} members`);
  ALL_FEATURE_LIST.forEach(f => { if (keys.includes(f.key)) list.push(f.label); });
  return list;
}

// PaidButton must always call usePaystackPayment (React Hook rules)
function PaidButton({ plan, session, onSuccess, disabled }) {
  const [ref] = useState(`kt-${plan.slug}-${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [nativeErr, setNativeErr] = useState("");

  const config = {
    reference: ref,
    email:     session.user.email,
    amount:    plan.price_monthly * 100,
    publicKey: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || "",
    metadata: {
      custom_fields: [{ display_name: "Plan", variable_name: "plan", value: plan.name }],
    },
  };
  const initPayment = usePaystackPayment(config);

  const color = planColor(plan.sort_order);
  const cls = color === "violet" || color === "amber"
    ? "w-full py-2.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
    : "w-full py-2.5 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors";

  const handleClick = async () => {
    if (isNative) {
      setBusy(true); setNativeErr("");
      try {
        const baseUrl = supabase.supabaseUrl;
        const anonKey = supabase.supabaseKey;
        const res = await fetch(`${baseUrl}/functions/v1/initialize-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}`, "apikey": anonKey },
          body: JSON.stringify({ email: session.user.email, amount: plan.price_monthly * 100, reference: ref, planId: plan.slug }),
        });
        const data = await res.json();
        if (!res.ok || !data.authorization_url) throw new Error(data.error || `Server error ${res.status}`);
        localStorage.setItem("pendingPayment", JSON.stringify({ planId: plan.slug, reference: data.reference || ref }));
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
      <button disabled={disabled || busy} onClick={handleClick} className={cls}>
        {busy ? "Opening Paystack…" : `Subscribe — ₦${plan.price_monthly.toLocaleString()}/mo`}
      </button>
      {nativeErr && <p className="text-[10px] text-red-500 text-center">{nativeErr}</p>}
    </div>
  );
}

export default function SubscriptionPlan({ session, onComplete, onClose, isUpgrade = false, currentPlan = "starter" }) {
  const [plans, setPlans] = useState(() => getActivePlans());
  const [loadingPlans, setLoadingPlans] = useState(plans.length === 0);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [pendingPayment, setPendingPayment] = useState(
    () => JSON.parse(localStorage.getItem("pendingPayment") || "null")
  );

  const saveSubRef = useRef(null);

  // Load/refresh plans from DB
  useEffect(() => {
    setLoadingPlans(true);
    fetchAndCachePlans(supabase)
      .then(() => { setPlans(getActivePlans()); })
      .catch(() => {})
      .finally(() => setLoadingPlans(false));
  }, []);

  const saveSub = useCallback(async (planSlug, reference) => {
    setSaving(true); setError("");
    try {
      const expiresAt = planSlug === "starter"
        ? null
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: existing } = await supabase
        .from("subscriptions").select("id, plan").eq("user_id", session.user.id).maybeSingle();

      // First-time paid: no prior subscription, or prior was free starter
      const isFirstTimePaid = planSlug !== "starter" && (!existing || existing.plan === "starter" || !existing.plan);

      let err;
      if (existing) {
        ({ error: err } = await supabase.from("subscriptions").update({
          plan: planSlug, status: "active",
          paystack_reference: reference || null, expires_at: expiresAt,
        }).eq("id", existing.id));
      } else {
        ({ error: err } = await supabase.from("subscriptions").insert({
          user_id: session.user.id, plan: planSlug, status: "active",
          paystack_reference: reference || null, expires_at: expiresAt,
        }));
      }

      if (err) throw err;
      // Mark any upgrade prompts as seen
      await supabase.from("plan_upgrade_prompts").update({ seen: true }).eq("user_id", session.user.id).eq("seen", false);

      // Fire email notifications for all paid plan purchases (non-blocking)
      if (planSlug !== "starter") {
        const planData = plans.find(p => p.slug === planSlug);
        const features = planData ? getDisplayFeatures(planData) : [];
        const { data: profile } = await supabase
          .from("profiles").select("full_name, business_name").eq("id", session.user.id).maybeSingle();
        const userName = profile?.full_name || session.user.email;
        const bizName  = profile?.business_name || "";

        // Welcome email to the subscribing user (first-time only)
        if (isFirstTimePaid) {
          fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
            body: JSON.stringify({
              event: "subscription_welcome",
              data: {
                user_email:    session.user.email,
                user_name:     userName,
                plan_name:     planData?.name || planSlug,
                plan_slug:     planSlug,
                plan_price:    planData?.price_monthly || 0,
                plan_features: features,
              },
            }),
          }).catch(() => null);
        }

        // Admin alert — every paid plan purchase (new subscription or upgrade/renewal)
        fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({
            event: "plan_purchased",
            data: {
              user_email:    session.user.email,
              user_name:     userName,
              business_name: bizName,
              plan_name:     planData?.name || planSlug,
              plan_slug:     planSlug,
              plan_price:    planData?.price_monthly || 0,
              reference:     reference || "",
              is_first_time: isFirstTimePaid,
            },
          }),
        }).catch(() => null);
      }

      setPendingPayment(null);
      localStorage.removeItem("pendingPayment");
      onComplete(planSlug);
    } catch (e) {
      setError(e.message || "Could not save plan. Please try again.");
      setSaving(false);
    }
  }, [session, onComplete, plans]);

  saveSubRef.current = saveSub;

  const recheckPending = useCallback(() => {
    const pending = JSON.parse(localStorage.getItem("pendingPayment") || "null");
    if (pending) setPendingPayment(pending);
  }, []);

  useEffect(() => {
    const handleDeepLink = () => {
      const pending = JSON.parse(localStorage.getItem("pendingPayment") || "null");
      if (!pending) return;
      localStorage.removeItem("pendingPayment");
      setPendingPayment(null);
      saveSubRef.current(pending.planId, pending.reference);
    };
    window.addEventListener("paymentCallback", handleDeepLink);
    let resumeListener;
    if (isNative) {
      App.addListener("appStateChange", ({ isActive }) => { if (isActive) recheckPending(); })
        .then((l) => { resumeListener = l; });
    }
    return () => {
      window.removeEventListener("paymentCallback", handleDeepLink);
      resumeListener?.remove();
    };
  }, [recheckPending]);

  const currentNormalized = normalizeSlug(currentPlan);
  const currentPlanData   = plans.find(p => p.slug === currentNormalized);
  const currentSortOrder  = currentPlanData?.sort_order ?? 0;

  const handleFree = () => saveSub("starter", null);
  const handlePaid = (slug) => (ref) => saveSub(slug, ref.reference);

  if (loadingPlans && plans.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-slate-400">Loading plans…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800 px-4 py-10">
      <div className="max-w-4xl mx-auto">

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
              onClick={() => { const p = pendingPayment; setPendingPayment(null); localStorage.removeItem("pendingPayment"); saveSub(p.planId, p.reference); }}
              disabled={saving}
              className="text-sm font-bold text-white bg-green-600 hover:bg-green-700 px-5 py-2 rounded-lg disabled:opacity-50">
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
        <div className={`grid grid-cols-1 gap-5 ${plans.length <= 2 ? "md:grid-cols-2 max-w-2xl mx-auto" : plans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
          {plans.map((plan) => {
            const isCurrent   = isUpgrade && plan.slug === currentNormalized;
            const isDowngrade = isUpgrade && (plan.sort_order ?? 0) < currentSortOrder;
            const color       = planColor(plan.sort_order);
            const isPopular   = !isCurrent && (plan.sort_order === 1 || (plans.length === 2 && plan.sort_order > 0));
            const isBestValue = !isCurrent && plan.sort_order === plans.length - 1 && plans.length > 2;
            const displayFeatures = getDisplayFeatures(plan);
            const missingFeatures = getMissingFeatures(plan, plans);

            const ringCls = isCurrent ? "ring-2 ring-blue-400 opacity-75"
              : isPopular ? "ring-2 ring-green-500"
              : isBestValue ? "ring-2 ring-violet-400"
              : "";

            return (
              <div key={plan.slug}
                className={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-md p-6 flex flex-col ${ringCls}`}>

                {isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">Current Plan</span>
                  </div>
                )}
                {!isCurrent && isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">Most Popular</span>
                  </div>
                )}
                {!isCurrent && isBestValue && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-violet-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">Best Value</span>
                  </div>
                )}

                {/* Price */}
                <div className="mb-5">
                  <h2 className="text-base font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide">{plan.name}</h2>
                  {plan.description && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{plan.description}</p>}
                  <div className="mt-2 flex items-end gap-1">
                    {plan.price_monthly === 0 ? (
                      <span className="text-3xl font-extrabold text-gray-800 dark:text-white">Free</span>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{plan.price_monthly.toLocaleString()}</span>
                        <span className="text-sm text-gray-400 mb-1">/month</span>
                      </>
                    )}
                  </div>
                  {plan.price_monthly === 0 && <p className="text-xs text-gray-400 mt-0.5">Free forever</p>}
                  {plan.price_yearly > 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                      ₦{plan.price_yearly.toLocaleString()}/year <span className="text-gray-400">(save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%)</span>
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2.5 flex-1 mb-6">
                  {displayFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-300">
                      <CheckIcon color={color} />
                      <span>{f}</span>
                    </li>
                  ))}
                  {missingFeatures.map((f) => (
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
                  <button onClick={plan.slug === "starter" ? handleFree : undefined}
                    disabled={saving || plan.slug !== "starter"}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 transition-colors text-xs">
                    {plan.slug === "starter" ? "Downgrade to Free" : "Not available"}
                  </button>
                ) : plan.price_monthly === 0 ? (
                  <button onClick={handleFree} disabled={saving}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    Get Started Free
                  </button>
                ) : (
                  <PaidButton plan={plan} session={session} disabled={saving} onSuccess={handlePaid(plan.slug)} />
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
