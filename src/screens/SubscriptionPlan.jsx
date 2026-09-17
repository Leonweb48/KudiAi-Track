import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";
import { fetchAndCachePlans, getActivePlans, normalizeSlug, ALL_FEATURE_LIST } from "../utils/plans";
import { sendEmailTrigger } from "../utils/emailTrigger";
import { useWallet } from "../hooks/useWallet";
import { usePlatformConfig } from "../hooks/usePlatformConfig";

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

// A plan that costs nothing — activates instantly, no wallet debit.
function isFreePlanSlug(slug, plans = []) {
  if (!slug) return true;
  if (/^(kobo|starter|free)$/i.test(slug) || /starter/i.test(slug)) return true;
  const p = plans.find(pl => pl.slug === slug);
  return p ? Number(p.price_monthly || 0) === 0 : false;
}

// Paid plans are charged instantly from the owner's KudiAI wallet — one RPC
// call does the debit and the plan activation atomically, so there's no
// redirect/verify/approve pipeline to manage here.
function PaidButton({ plan, wallet, walletReady, disabled, yearly = false, appliedCoupon, onSuccess, buttonLabel }) {
  const chargeAmount = yearly && plan.price_yearly > 0 ? plan.price_yearly : plan.price_monthly;
  const billingCycle = yearly ? "yearly" : "monthly";
  const { applies: couponApplies, final: finalAmount } =
    computeCouponDiscount(appliedCoupon, plan.slug, billingCycle, chargeAmount);

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");

  const color = planColor(plan.sort_order);
  const cls = color === "violet"
    ? "w-full py-2.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
    : "w-full py-2.5 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors";

  const walletShort = walletReady && wallet.balanceKobo < Math.round(finalAmount * 100);
  const blocked = finalAmount > 0 && (!walletReady || walletShort);

  const handleClick = async () => {
    if (blocked) return;
    setBusy(true); setErr("");
    try {
      const { data, error: rpcErr } = await supabase.rpc("wallet_pay_subscription", {
        p_plan_slug:     plan.slug,
        p_billing_cycle: billingCycle,
        p_coupon_code:   couponApplies && appliedCoupon ? appliedCoupon.code : null,
      });
      if (rpcErr) throw rpcErr;
      onSuccess?.(data);
    } catch (e) {
      setErr(/insufficient/i.test(e.message || "")
        ? "Insufficient wallet balance. Please top up your wallet and try again."
        : (e.message || "Payment failed. Please try again."));
      setBusy(false);
    }
  };

  const defaultLabel = busy ? "Activating…"
    : finalAmount === 0 && couponApplies
      ? "Activate Free — Coupon Applied"
      : `Subscribe — ₦${finalAmount.toLocaleString()}/${billingCycle === "yearly" ? "yr" : "mo"}`;

  return (
    <div className="space-y-1.5">
      {couponApplies && (
        <div className="text-center">
          <span className="text-xs text-gray-400 line-through mr-1.5">₦{chargeAmount.toLocaleString()}</span>
          <span className="text-sm font-bold text-green-600 dark:text-green-400">
            {finalAmount === 0 ? "FREE" : `₦${finalAmount.toLocaleString()}`}
          </span>
          {finalAmount > 0 && <span className="text-xs text-gray-400 ml-1">/{billingCycle === "yearly" ? "yr" : "mo"}</span>}
        </div>
      )}
      {finalAmount > 0 && !walletReady && (
        <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 text-center">Activate your KudiAI Wallet to subscribe</p>
      )}
      {finalAmount > 0 && walletReady && walletShort && (
        <p className="text-[11px] font-bold text-red-500 text-center">
          Balance too low — ₦{wallet.balanceNaira.toLocaleString()} available, ₦{finalAmount.toLocaleString()} needed
        </p>
      )}
      <button disabled={disabled || busy || blocked} onClick={handleClick} className={cls}>
        {buttonLabel && !busy ? buttonLabel : defaultLabel}
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

  const { walletEnabled } = usePlatformConfig();
  const wallet = useWallet(session?.user?.id || null, walletEnabled);
  const walletReady = walletEnabled && wallet.hasAccount;

  // A subscription payment made before this deploy may still be sitting in
  // the admin-approval queue — keep showing/resolving that, even though the
  // owner-facing flow no longer creates new ones.
  const [pendingApproval, setPendingApproval] = useState(null);

  // Current subscription details
  const [currentBillingCycle, setCurrentBillingCycle] = useState(null);
  const [subExpiry,            setSubExpiry]            = useState(null);

  // Highlight a card (scroll-to + pulse ring)
  const cardRefs        = useRef({});
  const [highlighted,    setHighlighted]    = useState(null);

  // Coupon state
  const [couponCode,    setCouponCode]    = useState(() => {
    try { return sessionStorage.getItem("kt_auto_promo") || ""; } catch { return ""; }
  });
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponMsg,     setCouponMsg]     = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    setLoadingPlans(true);
    fetchAndCachePlans(supabase)
      .then(() => { setPlans(getActivePlans()); })
      .catch(() => {})
      .finally(() => setLoadingPlans(false));
  }, []);

  // Fetch current subscription billing cycle + expiry
  useEffect(() => {
    if (!session?.user?.id || !isUpgrade) return;
    supabase
      .from("subscriptions")
      .select("billing_cycle, expires_at")
      .eq("user_id", session.user.id)
      .eq("status", "active")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCurrentBillingCycle(data.billing_cycle || "monthly");
          setSubExpiry(data.expires_at || null);
        }
      });
  }, [session?.user?.id, isUpgrade]);

  const scrollToAndHighlight = useCallback((slug) => {
    setHighlighted(slug);
    cardRefs.current[slug]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlighted(null), 2200);
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

  // Auto-apply promo code passed in via slot CTA (stored in sessionStorage)
  useEffect(() => {
    const stored = couponCode.trim();
    if (!stored) return;
    try { sessionStorage.removeItem("kt_auto_promo"); } catch {}
    applyCoupon();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Genuinely-free plan slugs only — paid plans (including a coupon that
  // brings one to ₦0) go through PaidButton → wallet_pay_subscription instead.
  const saveSub = useCallback(async (planSlug) => {
    setSaving(true); setError("");
    try {
      const { data: profile } = await supabase
        .from("profiles").select("full_name, business_name").eq("id", session.user.id).maybeSingle();
      const userName = profile?.full_name || session.user.email;
      const bizName  = profile?.business_name || "";

      const { error: freeErr } = await supabase.rpc("activate_free_subscription", { p_plan_slug: planSlug });
      if (freeErr) throw freeErr;
      sendEmailTrigger("business_welcome", { user_email: session.user.email, user_name: userName, business_name: bizName, current_plan: planSlug });

      setAppliedCoupon(null); setCouponCode(""); setCouponMsg(null);
      onComplete(planSlug);
    } catch (e) {
      setError(e.message || "Could not save plan. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [session, onComplete]);

  // Fires after wallet_pay_subscription succeeds — confirmation emails, then
  // hand control back to the app the same way the free path does.
  const handlePaidSuccess = useCallback(async (planSlug, cycle, rpcResult) => {
    setAppliedCoupon(null); setCouponCode(""); setCouponMsg(null);
    setError("");
    try {
      const { data: profile } = await supabase
        .from("profiles").select("full_name, business_name").eq("id", session.user.id).maybeSingle();
      const userName  = profile?.full_name || session.user.email;
      const bizName   = profile?.business_name || "";
      const planData  = plans.find(p => p.slug === planSlug);
      const features  = planData ? getDisplayFeatures(planData) : [];
      const amount    = rpcResult?.amount_charged ?? 0;
      const reference = rpcResult?.wallet_ledger_id || "";
      sendEmailTrigger("subscription_welcome", {
        user_email: session.user.email, user_name: userName, business_name: bizName,
        plan_name: planData?.name || planSlug, plan_slug: planSlug, plan_price: amount,
        plan_features: features, billing_cycle: cycle, reference, is_first_time: !isUpgrade,
      });
      sendEmailTrigger("plan_purchased", {
        user_email: session.user.email, user_name: userName, business_name: bizName,
        plan_name: planData?.name || planSlug, plan_slug: planSlug, plan_price: amount,
        reference, is_first_time: !isUpgrade,
      });
    } catch { /* confirmation emails are best-effort */ }
    onComplete(planSlug);
  }, [session, plans, onComplete, isUpgrade]);

  // Already have a subscription payment awaiting admin confirmation (a
  // pre-cutover bank-transfer request)? Show the waiting screen, and react
  // when the admin decides.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    let chan;
    (async () => {
      const { data } = await supabase
        .from("admin_approval_requests")
        .select("id, status, payload, decision_note")
        .eq("requester", uid)
        .eq("request_type", "subscription_upgrade")
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.status === "pending") {
        setPendingApproval({ plan: data.payload?.plan_slug || "your new plan", cycle: data.payload?.billing_cycle || "monthly" });
      }
      chan = supabase
        .channel(`sub_approval_${uid}`)
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "admin_approval_requests", filter: `requester=eq.${uid}` },
          (p) => {
            const row = p.new;
            if (row.request_type !== "subscription_upgrade") return;
            if (row.status === "approved") {
              setPendingApproval(null);
              onComplete(row.payload?.plan_slug || currentPlan);
            } else if (row.status === "rejected") {
              setPendingApproval(null);
              setError(`Your subscription payment could not be approved.${row.decision_note ? ` Reason: ${row.decision_note}.` : ""} A full refund has been issued to your bank account (allow up to 10 working days).`);
            }
          })
        .subscribe();
    })();
    return () => { if (chan) supabase.removeChannel(chan); };
  }, [session?.user?.id, onComplete, currentPlan]);

  const currentNormalized = normalizeSlug(currentPlan);
  const currentPlanData   = plans.find(p => p.slug === currentNormalized);
  const currentSortOrder  = currentPlanData?.sort_order ?? 0;

  const handleFree = () => saveSub("kobo");

  const handleDowngrade = async (targetPlan) => {
    setSaving(true);
    setError("");
    try {
      if (isFreePlanSlug(targetPlan.slug, plans)) {
        // Downgrade to a free plan takes effect immediately.
        const { error } = await supabase.rpc("activate_free_subscription", { p_plan_slug: targetPlan.slug });
        if (error) throw error;
        onComplete(targetPlan.slug);
        return;
      }
      // Moving between paid tiers — no payment, but still needs an admin to approve.
      const { error } = await supabase.rpc("submit_subscription_upgrade_request", {
        p_plan_slug:     targetPlan.slug,
        p_billing_cycle: yearly ? "yearly" : "monthly",
        p_amount:        0,
        p_reference:     "",
        p_coupon:        null,
      });
      if (error && !/awaiting approval|already been submitted/i.test(error.message || "")) throw error;
      setSaving(false);
      setPendingApproval({ plan: targetPlan.name || targetPlan.slug, cycle: yearly ? "yearly" : "monthly" });
    } catch (e) {
      setError(e.message || "Could not change plan. Please try again.");
      setSaving(false);
    }
  };

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

  // Bank transfer received (pre-cutover request) — waiting for an admin.
  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-green-100 dark:border-slate-700 px-6 py-9">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Payment received</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 leading-relaxed">
            Your transfer for <span className="font-bold text-gray-700 dark:text-slate-200">{pendingApproval.plan}</span>{" "}
            ({pendingApproval.cycle}) is being confirmed by our team. Your plan upgrades automatically once it&apos;s approved — usually within a few hours. We&apos;ll email you.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Awaiting admin approval
          </div>
          {onClose && (
            <button onClick={onClose} className="mt-6 w-full py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-br from-blue-950 to-blue-800 active:scale-[0.98] transition-transform">
              Continue to app
            </button>
          )}
          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    );
  }

  const savingsPercent = (plan) =>
    plan.price_yearly > 0
      ? Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)
      : 0;

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
            {isUpgrade ? "Manage your plan" : "Choose your plan"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            {isUpgrade ? "Change billing cycle, upgrade, or switch plans." : "Start free. Upgrade anytime. Cancel anytime."}
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
              <span className="ml-1.5 text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Save 5–10%</span>
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

        {error && (
          <div className="mb-4 max-w-sm mx-auto text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-center">
            {error}
          </div>
        )}

        {/* Plan cards — extra top padding so the -top-4 badges don't clip */}
        <div className={`grid grid-cols-1 gap-6 pt-5 ${plans.length <= 2 ? "md:grid-cols-2 max-w-2xl mx-auto" : plans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
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

            // Next higher plan (for upgrade button on current plan card)
            const nextPlan = isCurrent
              ? plans.find(p => (p.sort_order ?? 0) === (plan.sort_order ?? 0) + 1) || null
              : null;

            const isHighlighted = highlighted === plan.slug;

            const ringCls = isHighlighted
              ? "ring-4 ring-green-400 scale-[1.01] shadow-xl"
              : isCurrent
                ? "ring-2 ring-emerald-500 shadow-md"
                : isPopular
                  ? "ring-2 ring-green-500"
                  : isBestValue
                    ? "ring-2 ring-violet-400"
                    : "shadow-sm";

            return (
              <div
                key={plan.slug}
                ref={el => { cardRefs.current[plan.slug] = el; }}
                className={`relative bg-white dark:bg-slate-800 rounded-2xl p-5 flex flex-col transition-all duration-300 ${ringCls}`}
              >

                {/* Top badge */}
                {isCurrent && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow whitespace-nowrap">✓ Your Plan</span>
                  </div>
                )}
                {!isCurrent && isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow whitespace-nowrap">Most Popular</span>
                  </div>
                )}
                {!isCurrent && isBestValue && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-violet-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow whitespace-nowrap">Best Value</span>
                  </div>
                )}

                {/* Plan name + price */}
                <div className="mb-4">
                  <h2 className="text-base font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide">{plan.name}</h2>
                  {plan.description && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{plan.description}</p>}

                  <div className="mt-2 flex items-baseline gap-1 flex-wrap">
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
                        <span className="text-sm text-gray-400">/mo</span>
                      </>
                    ) : yearly && plan.price_yearly > 0 ? (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{Math.round(plan.price_yearly / 12).toLocaleString()}</span>
                        <span className="text-sm text-gray-400">/mo</span>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-gray-800 dark:text-white">₦{plan.price_monthly.toLocaleString()}</span>
                        <span className="text-sm text-gray-400">/mo</span>
                      </>
                    )}
                  </div>

                  {plan.price_monthly === 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">Free forever</p>
                  )}
                  {couponApplies && plan.price_monthly > 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5 font-medium">
                      Coupon saves ₦{couponDiscount.toLocaleString()}
                      {yearly && plan.price_yearly > 0 ? ` — billed ₦${couponFinal.toLocaleString()}/yr` : ""}
                    </p>
                  )}
                  {!couponApplies && plan.price_yearly > 0 && yearly && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5 font-medium">
                      Billed ₦{plan.price_yearly.toLocaleString()}/yr
                      <span className="ml-1 text-gray-400">(save {savingsPercent(plan)}%)</span>
                    </p>
                  )}
                  {!couponApplies && plan.price_yearly > 0 && !yearly && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                      Switch to yearly → save {savingsPercent(plan)}%
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2 flex-1 mb-5">
                  {displayFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-300">
                      <CheckIcon color={color} />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                  {missingFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-400 line-through">
                      <XIcon />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>

                {/* ── CTA area ───────────────────────────────────────── */}
                {isCurrent ? (
                  <div className="space-y-2.5">

                    {/* Active status indicator */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0 animate-pulse" />
                          <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-300 truncate">
                            Active subscription
                          </span>
                        </div>
                        {currentBillingCycle && (
                          <span className={`flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                            currentBillingCycle === "yearly"
                              ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
                              : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          }`}>
                            {currentBillingCycle === "yearly" ? "📅 Yearly" : "🗓 Monthly"}
                          </span>
                        )}
                      </div>
                      {subExpiry && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1.5">
                          Renews {new Date(subExpiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>

                    {/* Switch to yearly (only if currently monthly and plan has yearly pricing) */}
                    {plan.price_monthly > 0 && currentBillingCycle === "monthly" && plan.price_yearly > 0 && (
                      <PaidButton
                        plan={plan}
                        wallet={wallet}
                        walletReady={walletReady}
                        disabled={saving}
                        yearly={true}
                        appliedCoupon={appliedCoupon}
                        onSuccess={(data) => handlePaidSuccess(plan.slug, "yearly", data)}
                        buttonLabel={`Switch to Yearly — Save ${savingsPercent(plan)}%`}
                      />
                    )}

                    {/* Upgrade to next plan */}
                    {nextPlan && (
                      <button
                        onClick={() => scrollToAndHighlight(nextPlan.slug)}
                        className="w-full py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-sm active:scale-95 transition-all"
                      >
                        Upgrade to {nextPlan.name} →
                      </button>
                    )}
                  </div>

                ) : isDowngrade ? (
                  <button
                    onClick={plan.price_monthly === 0 ? handleFree : () => handleDowngrade(plan)}
                    disabled={saving}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 transition-colors">
                    {saving ? "Changing…" : plan.price_monthly === 0 ? "Downgrade to Free" : `Downgrade to ${plan.name}`}
                  </button>

                ) : plan.price_monthly === 0 ? (
                  <button onClick={handleFree} disabled={saving}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    {saving ? "Activating…" : "Start for Free"}
                  </button>

                ) : (
                  <PaidButton
                    plan={plan}
                    wallet={wallet}
                    walletReady={walletReady}
                    disabled={saving}
                    yearly={yearly}
                    appliedCoupon={appliedCoupon}
                    onSuccess={(data) => handlePaidSuccess(plan.slug, billingCycle, data)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-slate-500 mt-8">
          Paid plans are charged instantly from your KudiAI Wallet balance · Cancel anytime
        </p>
      </div>
    </div>
  );
}
