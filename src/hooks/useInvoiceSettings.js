import { useState, useEffect, useCallback, useRef } from "react";
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

// profile is used to seed empty invoice settings on first load — eliminates
// duplicate data entry. The user only needs to set their info once (in their
// profile); invoice settings inherits it and they can override per-invoice.
export function useInvoiceSettings(userId, profile) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading,  setLoading]  = useState(true);
  // Capture profile at mount time so the load callback doesn't need it as a dep
  const profileRef = useRef(profile);

  const load = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }
    const { data } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      setSettings({ ...DEFAULTS, ...data });
    } else {
      // No invoice settings yet — seed from profile so the owner doesn't have
      // to re-enter data they already provided during registration.
      const p = profileRef.current || {};
      setSettings({
        ...DEFAULTS,
        contact_email:  p.email                              || "",
        contact_phone:  p.phone                             || "",
        address:        p.business_address || p.address     || "",
        reg_number:     p.business_registration_number      || "",
        logo_url:       p.store_image_url                   || "",
      });
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = async (values) => {
    // Only persist columns that exist in the DB schema
    const DB_COLS = ["logo_url", "reg_number", "contact_email", "contact_phone",
                     "address", "bank_name", "bank_code", "account_number", "account_name", "thank_you_note"];
    const dbValues = Object.fromEntries(DB_COLS.filter(k => k in values).map(k => [k, values[k]]));
    const now = new Date().toISOString();

    // Avoid upsert — PostgREST evaluates INSERT and UPDATE WITH CHECK simultaneously
    // which triggers an RLS violation even when both individual policies are valid.
    const { data: existing } = await supabase
      .from("invoice_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("invoice_settings")
          .update({ ...dbValues, updated_at: now })
          .eq("user_id", userId)
      : await supabase
          .from("invoice_settings")
          .insert({ user_id: userId, ...dbValues, updated_at: now });

    if (!error) setSettings(prev => ({ ...prev, ...values }));
    return { error };
  };

  return { settings, loading, save, reload: load };
}
