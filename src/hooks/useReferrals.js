import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n = 7) {
  return Array.from({ length: n }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}

export function useReferrals() {
  const [myCode,    setMyCode]    = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [config,    setConfig]    = useState(null);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    setLoading(true);
    const [codeRes, referralsRes, configRes] = await Promise.all([
      supabase.from("referral_codes")
        .select("id, code, created_at")
        .eq("referrer_user_id", user.id)
        .maybeSingle(),
      supabase.from("referrals")
        .select("id, referred_user_id, txn_count, qualified_at, reward_type, reward_value, paid_out, created_at")
        .eq("referrer_user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("referral_config")
        .select("*")
        .limit(1)
        .maybeSingle(),
    ]);

    let code = codeRes.data;
    if (!code) {
      const { data: inserted } = await supabase
        .from("referral_codes")
        .insert({ referrer_user_id: user.id, code: genCode() })
        .select("id, code, created_at")
        .single();
      code = inserted;
    }

    setMyCode(code);
    setReferrals(referralsRes.data ?? []);
    setConfig(configRes.data ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { myCode, referrals, config, loading };
}
