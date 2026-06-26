import { useState, useEffect, useRef, useCallback } from "react";
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

function planColor(sortOrder) {
  return ["gray", "blue", "violet", "amber"][sortOrder] || "blue";
}

function getMissingFeatures(plan, allPlans) {
  const keys = Array.isArray(plan.feature_keys) ? plan.feature_keys : [];
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

function getDisplayFeatures(plan) {
  const arr = Array.isArray(plan.features) ? plan.features : [];
  if (arr.length > 0) return arr;
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

function computeCouponDiscount(appliedCoupon, planSlug, billingCycle, chargeAmount) {
  if (!appliedCoupon) return { applies: false, discount: 0, final: chargeAmount };
  const planMatch   = appliedCoupon.applies_to.length === 0 || appliedCoupon.applies_to.includes(planSlug);
  const cycleMatch  = appliedCoupon.billing_cycles.length === 0 || appliedCoupon.billing_cycles.includes(billingCycle);
  const amountMatch = chargeAmount >= (appliedCoupon.min_amount || 0);
  if (!planMatch || !cycleMatch || !amountMatch) return { applies: false, discount: 0, final: chargeAmount };
  const discount = appliedCoupon.type === "percentage"
    ? Math.round(chargeAmount * appliedCoupon.value / 100 * 100) / 100
    : Math.min(appliedCoupon.value, chargeAmount);
  return { applies: true, discount, final: Math.max(0, chargeAmount - discount) };
}

const SUB_PENDING_PREFIX = "sub_pending_";

function PaidButton({ plan, session, disabled, yearly = false, onPaymentStart, appliedCoupon }) {
  const chargeAmount = yearly && plan.price_yearly > 0 ? plan.price_yearly : plan.price_monthly;
  const billingCycle = yearly ? "yearly" : "monthly";
  const { applies: couponApplies, discount: discountAmount, final: finalAmount } =
    computeCouponDiscount(appliedCoupon, plan.slug, billingCycle, chargeAmount);

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");

  const color = planColor(plan.sort_order);
  const cls = color === "violet"
    ? "w-full py-2.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
    : "w-full py-2.5 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors";

  const handleClick = async () => {
    setBusy(true); setErr("");
    const ref = `kt-sub-${plan.slug}-${Date.now()}`;
    const couponMeta = couponApplies && appliedCoupon ? {
      couponCode: appliedCoupon.code, originalAmount: chargeAmount, discountAmount, finalAmount,
    } : {};

    try {
      if (isNative) {
        const baseUrl = supabase.supabaseUrl;
        const anonKey = supabase.supabaseKey;
        const res = await fetch(`${baseUrl}/functions/v1/initialize-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}`, "apikey": anonKey },
          body: JSON.stringify({ email: session.user.email, amount: finalAmount * 100, reference: ref, planId: plan.slug }),
        });
        const data = await res.json();
        if (!res.ok || !data.authorization_url) throw new Error(data.error || `Server error ${res.status}`);
        localStorage.setItem("pendingPayment", JSON.stringify({ planId: plan.slug, reference: data.reference || ref, yearly, ...couponMeta }));
        await Browser.open({ url: data.authorization_url });
      } else {
        const callbackUrl = `${window.location.origin}/?sub_ref=${ref}`;
        const customFields = [
          { display_name: "Plan",    variable_name: "plan",          value: plan.name },
          { display_name: "Billing", variable_name: "billing_cycle", value: billingCycle },
        ];
        if (couponApplies && appliedCoupon) {
          customFields.push({ display_name: "Coupon", variable_name: "coupon_code", value: appliedCoupon.code });
        }
        const { data, error } = await supabase.functions.invoke("paystack", {
          body: { action: "initialize", email: session.user.email, amount: finalAmount, reference: ref, callback_url: callbackUrl, metadata: { custom_fields: customFields } },
        });
        if (error || !data?.data?.authorization_url) {
          throw new Error(data?.message || error?.message || "Could not start payment");
        }
        localStorage.setItem(`${SUB_PENDING_PREFIX}${ref}`, JSON.stringify({ planId: plan.slug, yearly, ...couponMeta }));
        onPaymentStart?.();
        window.location.href = data.data.authorization_url;
      }
    } catch (e) {
      setErr(e.message || "Payment failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {couponApplies && (
        <div className="text-center">
          <span className="text-xs text-gray-400 line-through mr-1.5">₦{chargeAmount.toLocaleString()}</span>
          <span className="text-sm font-bold text-green-600 dark:text-green-400">₦{finalAmount.toLocaleString()}</span>
          <span className="text-xs text-gray-400 ml-1">/{billingCycle === "yearly" ? "yr" : "mo"}</span>
        </div>
      )}
      <button disabled={disabled || busy} onClick={handleClick} className={cls}>
        {busy ? "Opening Paystack…" : `Subscribe — ₦${finalAmount.toLocaleString()}/${billingCycle === "yearly" ? "yr" : "mo"}`}
      </button>
      {err && <p className="text-[10px] text-red-500 text-center">{err}</p>}
    </div>
  );
}

export default function SubscriptionPlan({ session, onComplete, onClose, isUpgrade = false, currentPlan = "kobo" }) {
  const [plans, setPlans] = useState(() => getActivePlans());
  const [loadingPlans, setLoadingPlans] = useState(plans.length === 0);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [yearly,  setYearly]  = useState(false);
  const [pendingPayment, setPendingPayment] = useState(
    () => JSON.parse(localStorage.getItem("pendingPayment") || "null")
  );

  // Coupon state
  const [couponCode,    setCouponCode]    = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponMsg,     setCouponMsg]     = useState(null); // { text, ok }
  const [couponLoading, setCouponLoading] = useState(false);

  const saveSubRef = useRef(null);
  const savingRef  = useRef(false);
  savingRef.current = saving;

  useEffect(() => {
    setLoadingPlans(true);
    fetchAndCachePlans(supabase)
      .then(() => { setPlans(getActivePlans()); })
      .catch(() => {})
      .finally(() => setLoadingPlans(false));
  }, []);

  const applyCoupon = useCallback(async () => {
    const code = couponCode.trim();
    if (!code) return;
    setCouponLoading(true); setCouponMsg(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("check_coupon", { p_code: code });
      if (rpcErr) throw rpcErr;
      if (!data?.valid) {
        setCouponMsg({ text: data?.message || "Invalid coupon", ok: false });
        setAppliedCoupon(null);
      } else {
        setAppliedCoupon({
          code:           data.code || code.toUpperCase(),
          type:           data.type,
          value:          data.value,
          applies_to:     data.applies_to  || [],
          billing_cycles: data.billing_cycles || [],
          min_amount:     data.min_amount  || 0,
        });
        setCouponMsg({ text: data.message || "Coupon applied!", ok: true });
      }
    } catch (e) {
      setCouponMsg({ text: e.message || "Failed to apply coupon", ok: false });
      setAppliedCoupon(null);
    } finally {
      setCouponLoading(false);
    }
  }, [couponCode]);

  const saveSub = useCallback(async (planSlug, reference, isYearly = false, couponInfo = null) => {
    setSaving(true); setError("");
    try {
      const isFree = planSlug === "kobo" || planSlug === "starter";

      if (!isFree && reference) {
        const { data: vd } = await supabase.functions.invoke("paystack", {
          body: { action: "verify", reference },
        });
        const psStatus = vd?.data?.status;
        if (psStatus !== "success") {
          const gwResp = (vd?.data?.gateway_response || "").toLowerCase();
          const isCancelled = psStatus === "abandoned" || gwResp.includes("abandon") || gwResp.includes("cancel");
          throw new Error(
            isCancelled
              ? "Payment was cancelled. Your plan was not changed. Please try again."
              : `Payment not confirmed (${vd?.data?.gateway_response || psStatus || "not verified"}). Please contact support if you were charged.`
          );
        }
      }

      // Redeem coupon after confirmed payment (non-blocking)
      if (!isFree && couponInfo?.couponCode && (couponInfo.discountAmount ?? 0) > 0) {
        supabase.rpc("redeem_coupon", {
          p_code:            couponInfo.couponCode,
          p_plan_slug:       planSlug,
          p_billing_cycle:   isYearly ? "yearly" : "monthly",
          p_original_amount: couponInfo.originalAmount,
          p_discount_amount: couponInfo.discountAmount,
          p_final_amount:    couponInfo.finalAmount,
          p_reference:       reference || "",
        }).catch(() => null);
      }

      const expiresAt = isFree
        ? null
        : new Date(Date.now() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

      const { data: existing } = await supabase
        .from("subscriptions").select("id, plan").eq("user_id", session.user.id).maybeSingle();

      const isFirstTimePaid = !isFree && (!existing || existing.plan === "kobo" || existing.plan === "starter" || !existing.plan);

      let err;
      if (existing) {
        ({ error: err } = await supabase.from("subscriptions").update({
          plan: planSlug, status: "active",
          paystack_reference: reference || null, expires_at: expiresAt,
          billing_cycle: isFree ? "monthly" : (isYearly ? "yearly" : "monthly"),
        }).eq("id", existing.id));
      } else {
        ({ error: err } = await supabase.from("subscriptions").insert({
          user_id: session.user.id, plan: planSlug, status: "active",
          paystack_reference: reference || null, expires_at: expiresAt,
          billing_cycle: isFree ? "monthly" : (isYearly ? "yearly" : "monthly"),
        }));
      }

      if (err) throw err;
      await supabase.from("plan_upgrade_prompts").update({ seen: true }).eq("user_id", session.user.id).eq("seen", false);

      const planData = plans.find(p => p.slug === planSlug);
      const { data: profile } = await supabase
        .from("profiles").select("full_name, business_name").eq("id", session.user.id).maybeSingle();
      const userName = profile?.full_name || session.user.email;
      const bizName  = profile?.business_name || "";

      if (isFree) {
        const upgradePlans = plans
          .filter(p => p.price_monthly > 0)
          .map(p => ({ name: p.name, slug: p.slug, price: p.price_monthly, features: getDisplayFeatures(p).slice(0, 4) }));
        fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({ event: "kobo_welcome", data: { user_email: session.user.email, user_name: userName, business_name: bizName, upgrade_plans: upgradePlans } }),
        }).catch(() => null);
      }

      if (!isFree) {
        const features = planData ? getDisplayFeatures(planData) : [];
        fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({
            event: "subscription_welcome",
            data: { user_email: session.user.email, user_name: userName, business_name: bizName, plan_name: planData?.name || planSlug, plan_slug: planSlug, plan_price: planData?.price_monthly || 0, plan_features: features, billing_cycle: isYearly ? "yearly" : "monthly", reference: reference || "", is_first_time: isFirstTimePaid },
          }),
        }).catch(() => null);
        fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({
            event: "plan_purchased",
            data: { user_email: session.user.email, user_name: userName, business_name: bizName, plan_name: planData?.name || planSlug, plan_slug: planSlug, plan_price: planData?.price_monthly || 0, reference: reference || "", is_first_time: isFirstTimePaid },
          }),
        }).catch(() => null);
      }

      setPendingPayment(null);
      localStorage.removeItem("pendingPayment");
      Object.keys(localStorage).filter(k => k.startsWith(SUB_PENDING_PREFIX)).forEach(k => localStorage.removeItem(k));
      setAppliedCoupon(null); setCouponCode(""); setCouponMsg(null);
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
      const { planId, reference, yearly: isYearly = false, couponCode: cc, originalAmount, discountAmount, finalAmount } = pending;
      saveSubRef.current(planId, reference, isYearly, cc ? { couponCode: cc, originalAmount, discountAmount, finalAmount } : null);
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

  const handleFree = () => saveSub("kobo", null, false, null);

  // Detect return from Paystack web redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subRef = params.get("sub_ref");
    if (!subRef) return;
    const pendingKey = `${SUB_PENDING_PREFIX}${subRef}`;
    const stored = localStorage.getItem(pendingKey);
    if (!stored) return;
    const { planId, yearly: isYearly = false, couponCode: cc, originalAmount, discountAmount, finalAmount } = JSON.parse(stored);
    window.history.replaceState({}, "", window.location.pathname);
    localStorage.removeItem(pendingKey);
    saveSub(planId, subRef, isYearly, cc ? { couponCode: cc, originalAmount, discountAmount, finalAmount } : null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect cancellation via bfcache restore or in-app browser close
  useEffect(() => {
    const showDisrupted = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("sub_ref")) return;
      const keys = Object.keys(localStorage).filter(k => k.startsWith(SUB_PENDING_PREFIX));
      if (keys.length === 0 && !savingRef.current) return;
      keys.forEach(k => localStorage.removeItem(k));
      setSaving(false);
      setError("Your payment was not completed. Please try again.");
    };
    const onPageShow = (e) => { if (e.persisted) showDisrupted(); };
    const onVisible  = () => { if (document.visibilityState === "visible" && savingRef.current) showDisrupted(); };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <span className={`text-sm font-medium ${!yearly ? "text-gray-800 dark:text-white" : "text-gray-400 dark:text-slate-500"}`}>Monthly</span>
            <button
              onClick={() => setYearly(v => !v)}
              className={`relative w-12 h-6 rounded-full transition-colors ${yearly ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${yearly ? "translate-x-6" : "translate-x-0"}`} />
            </button>
            <span className={`text-sm font-medium ${yearly ? "text-gray-800 dark:text-white" : "text-gray-400 dark:text-slate-500"}`}>
              Yearly
              <span className="ml-1.5 text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Save up to 10%</span>
            </span>
          </div>

          {/* Coupon input */}
          <div className="max-w-sm mx-auto mt-5">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Have a coupon code?"
                value={couponCode}
                onChange={e => {
                  setCouponCode(e.target.value);
                  setCouponMsg(null);
                  if (!e.target.value.trim()) setAppliedCoupon(null);
                }}
                onKeyDown={e => e.key === "Enter" && applyCoupon()}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={applyCoupon}
                disabled={!couponCode.trim() || couponLoading}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors min-w-[70px]"
              >
                {couponLoading ? "…" : appliedCoupon ? "Applied ✓" : "Apply"}
              </button>
            </div>
            {couponMsg && (
              <p className={`mt-1.5 text-xs font-medium text-left ${couponMsg.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {couponMsg.text}
              </p>
            )}
          </div>
        </div>

        {pendingPayment && (
          <div className="mb-4 max-w-sm mx-auto bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-green-800 mb-2">Payment completed?</p>
            <button
              onClick={() => {
                const p = pendingPayment;
                setPendingPayment(null);
                localStorage.removeItem("pendingPayment");
                saveSub(p.planId, p.reference, p.yearly || false,
                  p.couponCode ? { couponCode: p.couponCode, originalAmount: p.originalAmount, discountAmount: p.discountAmount, finalAmount: p.finalAmount } : null);
              }}
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
            const billingCycle = yearly ? "yearly" : "monthly";
            const baseCharge = yearly && plan.price_yearly > 0 ? plan.price_yearly : plan.price_monthly;
            const { applies: couponApplies, discount: couponDiscount, final: couponFinal } =
              computeCouponDiscount(appliedCoupon, plan.slug, billingCycle, baseCharge);

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
                  <div className="mt-2 flex items-end gap-1 flex-wrap">
                    {plan.price_monthly === 0 ? (
                      <span className="text-3xl font-extrabold text-gray-800 dark:text-white">Free</span>
                    ) : couponApplies ? (
                      <>
                        <span className="text-lg font-bold text-gray-400 dark:text-slate-500 line-through">
                          ₦{(yearly && plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12) : plan.price_monthly).toLocaleString()}
                        </span>
                        <span className="text-3xl font-extrabold text-green-600 dark:text-green-400">
                          ₦{(yearly ? Math.round(couponFinal / 12) : couponFinal).toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-400 mb-1">/month</span>
                      </>
                    ) : yearly && plan.price_yearly > 0 ? (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{Math.round(plan.price_yearly / 12).toLocaleString()}</span>
                        <span className="text-sm text-gray-400 mb-1">/month</span>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{plan.price_monthly.toLocaleString()}</span>
                        <span className="text-sm text-gray-400 mb-1">/month</span>
                      </>
                    )}
                  </div>
                  {plan.price_monthly === 0 && <p className="text-xs text-gray-400 mt-0.5">Free forever</p>}
                  {couponApplies && plan.price_monthly > 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5 font-medium">
                      Coupon saves ₦{couponDiscount.toLocaleString()}
                      {yearly && plan.price_yearly > 0
                        ? ` — billed ₦${couponFinal.toLocaleString()}/year`
                        : ""}
                    </p>
                  )}
                  {!couponApplies && plan.price_yearly > 0 && yearly && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5 font-medium">
                      Billed ₦{plan.price_yearly.toLocaleString()}/year
                      <span className="ml-1 text-gray-400">(save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%)</span>
                    </p>
                  )}
                  {!couponApplies && plan.price_yearly > 0 && !yearly && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                      Switch to yearly → save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%
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
                  <button onClick={plan.slug === "kobo" || plan.slug === "starter" ? handleFree : undefined}
                    disabled={saving || (plan.slug !== "kobo" && plan.slug !== "starter")}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 transition-colors text-xs">
                    {plan.slug === "kobo" || plan.slug === "starter" ? "Downgrade to Free" : "Not available"}
                  </button>
                ) : plan.price_monthly === 0 ? (
                  <button onClick={handleFree} disabled={saving}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    {saving ? "Activating…" : "Start for Free"}
                  </button>
                ) : (
                  <PaidButton plan={plan} session={session} disabled={saving} yearly={yearly} onPaymentStart={() => setSaving(true)} appliedCoupon={appliedCoupon} />
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
