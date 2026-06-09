import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function rndChars(n) {
  return Array.from({ length: n }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}

function genLoyaltyId(existing) {
  let id;
  do { id = "KT-" + rndChars(4); } while (existing.includes(id));
  return id;
}

function genReferralCode(existing) {
  let code;
  do { code = rndChars(6); } while (existing.includes(code));
  return code;
}

const DEFAULT_SETTINGS = {
  is_active:             true,
  points_per_100_naira:  1,
  cashback_percentage:   0,
  referral_bonus_points: 50,
  min_purchase_amount:   0,
};

export function useLoyalty(userId) {
  const [customers, setCustomers] = useState([]);
  const [settings,  setSettings]  = useState(DEFAULT_SETTINGS);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let active = true;
    async function load() {
      setLoading(true);
      const [{ data: custs }, { data: sett }] = await Promise.all([
        supabase.from("customer_loyalty").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("loyalty_settings").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (!active) return;
      if (custs) setCustomers(custs);
      if (sett)  setSettings(sett);
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [userId]);

  const addCustomer = useCallback(async (data) => {
    const loyaltyId    = genLoyaltyId(customers.map(c => c.loyalty_id));
    const referralCode = genReferralCode(customers.map(c => c.referral_code));

    let referredBy = null;
    if (data.referral_code_used && data.referral_code_used.trim()) {
      const code = data.referral_code_used.trim().toUpperCase();
      const { data: referrer } = await supabase
        .from("customer_loyalty")
        .select("id, points_balance, total_points_earned, total_referrals")
        .eq("user_id", userId)
        .eq("referral_code", code)
        .maybeSingle();

      if (referrer) {
        referredBy = code;
        const bonus = settings.referral_bonus_points || 0;
        await supabase.from("customer_loyalty").update({
          points_balance:      referrer.points_balance      + bonus,
          total_points_earned: referrer.total_points_earned + bonus,
          total_referrals:     referrer.total_referrals     + 1,
        }).eq("id", referrer.id);

        if (bonus > 0) {
          await supabase.from("loyalty_transactions").insert({
            user_id:      userId,
            customer_id:  referrer.id,
            type:         "referral_bonus",
            points_delta: bonus,
            description:  `Referral bonus for introducing ${data.customer_name.trim()}`,
          });
        }
        setCustomers(prev => prev.map(c => c.id === referrer.id ? {
          ...c,
          points_balance:      c.points_balance      + bonus,
          total_points_earned: c.total_points_earned + bonus,
          total_referrals:     c.total_referrals     + 1,
        } : c));
      }
    }

    const { data: newC, error } = await supabase.from("customer_loyalty").insert({
      user_id:       userId,
      customer_name: data.customer_name.trim(),
      phone:         data.phone?.trim()  || null,
      email:         data.email?.trim()  || null,
      loyalty_id:    loyaltyId,
      referral_code: referralCode,
      referred_by:   referredBy,
    }).select().single();

    if (!error && newC) {
      setCustomers(prev => [newC, ...prev]);
      return newC;
    }
    return null;
  }, [customers, userId, settings.referral_bonus_points]);

  const awardPoints = useCallback(async (customerId, purchaseAmount, txRef = null) => {
    if (!settings.is_active) return;
    const cust = customers.find(c => c.id === customerId);
    if (!cust) return;
    if (purchaseAmount < (settings.min_purchase_amount || 0)) return;

    const pts  = settings.points_per_100_naira > 0
      ? Math.floor((purchaseAmount / 100) * settings.points_per_100_naira) : 0;
    const cash = settings.cashback_percentage > 0
      ? Math.round(purchaseAmount * settings.cashback_percentage / 100 * 100) / 100 : 0;
    if (pts === 0 && cash === 0) return;

    await supabase.from("customer_loyalty").update({
      points_balance:        cust.points_balance        + pts,
      total_points_earned:   cust.total_points_earned   + pts,
      cashback_balance:      Number(cust.cashback_balance)      + cash,
      total_cashback_earned: Number(cust.total_cashback_earned) + cash,
    }).eq("id", customerId);

    const logs = [];
    if (pts > 0) logs.push({
      user_id: userId, customer_id: customerId, type: "points_earned",
      points_delta: pts,
      description: `${pts} pts earned for ₦${purchaseAmount.toLocaleString()} purchase`,
      transaction_ref: txRef,
    });
    if (cash > 0) logs.push({
      user_id: userId, customer_id: customerId, type: "cashback_earned",
      cashback_delta: cash,
      description: `${settings.cashback_percentage}% cashback on ₦${purchaseAmount.toLocaleString()}`,
      transaction_ref: txRef,
    });
    if (logs.length) await supabase.from("loyalty_transactions").insert(logs);

    setCustomers(prev => prev.map(c => c.id === customerId ? {
      ...c,
      points_balance:        c.points_balance        + pts,
      total_points_earned:   c.total_points_earned   + pts,
      cashback_balance:      Number(c.cashback_balance)      + cash,
      total_cashback_earned: Number(c.total_cashback_earned) + cash,
    } : c));
  }, [customers, userId, settings]);

  const awardByName = useCallback(async (customerName, purchaseAmount) => {
    if (!customerName || !purchaseAmount) return;
    const cust = customers.find(c =>
      c.customer_name.toLowerCase().trim() === customerName.toLowerCase().trim()
    );
    if (cust) await awardPoints(cust.id, purchaseAmount);
  }, [customers, awardPoints]);

  const redeemPoints = useCallback(async (customerId, points, desc = "Points redeemed") => {
    const cust = customers.find(c => c.id === customerId);
    if (!cust || cust.points_balance < points) return false;

    await supabase.from("customer_loyalty").update({
      points_balance: cust.points_balance - points,
    }).eq("id", customerId);

    await supabase.from("loyalty_transactions").insert({
      user_id: userId, customer_id: customerId, type: "points_redeemed",
      points_delta: -points, description: desc,
    });

    setCustomers(prev => prev.map(c => c.id === customerId
      ? { ...c, points_balance: c.points_balance - points } : c));
    return true;
  }, [customers, userId]);

  const saveSettings = useCallback(async (newSettings) => {
    const { data, error } = await supabase.from("loyalty_settings")
      .upsert({ user_id: userId, ...newSettings, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .select().single();
    if (!error && data) setSettings(data);
    return !error;
  }, [userId]);

  const getHistory = useCallback(async (customerId) => {
    const { data } = await supabase.from("loyalty_transactions")
      .select("*").eq("customer_id", customerId)
      .order("created_at", { ascending: false }).limit(50);
    return data || [];
  }, []);

  const deleteCustomer = useCallback(async (id) => {
    await supabase.from("customer_loyalty").delete().eq("id", id);
    setCustomers(prev => prev.filter(c => c.id !== id));
  }, []);

  return {
    customers, settings, loading,
    addCustomer, awardPoints, awardByName,
    redeemPoints, saveSettings, getHistory, deleteCustomer,
  };
}
