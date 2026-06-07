import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnon = process.env.REACT_APP_SUPABASE_ANON_KEY;

// window.Capacitor is injected by the native bridge at runtime
const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform() === true;

export const supabase =
  supabaseUrl && supabaseAnon
    ? createClient(supabaseUrl, supabaseAnon, {
        auth: {
          flowType: "implicit",
          detectSessionInUrl: !isNative,
          persistSession: true,
          storage: window.localStorage,
        },
      })
    : null;

export const supabaseConfigured = Boolean(supabase);
