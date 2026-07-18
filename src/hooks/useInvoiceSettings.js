import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const DEFAULTS = {
  logo_url:       "",
  reg_number:     "",
  contact_email:  "",
  contact_phone:  "",
  address:        "",
  bank_name:      "",
  bank_code:      "",
  account_number: "",
  account_name:   "",
  thank_you_note: "Thank you for your business. We truly value your patronage.",
};

export function useInvoiceSettings(userId) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }
    const { data } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    setSettings(data ? { ...DEFAULTS, ...data } : DEFAULTS);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = async (values) => {
    // Only persist columns that exist in the DB schema
    const DB_COLS = ["logo_url", "reg_number", "contact_email", "contact_phone",
                     "address", "bank_name", "bank_code", "account_number", "account_name", "thank_you_note"];
    const dbValues = Object.fromEntries(DB_COLS.filter(k => k in values).map(k => [k, values[k]]));
    const payload = { user_id: userId, ...dbValues, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from("invoice_settings")
      .upsert(payload, { onConflict: "user_id" });
    if (!error) setSettings(prev => ({ ...prev, ...values }));
    return { error };
  };

  return { settings, loading, save, reload: load };
}
