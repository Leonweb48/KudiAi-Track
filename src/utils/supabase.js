import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";

const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnon = process.env.REACT_APP_SUPABASE_ANON_KEY;

const isNative = Capacitor.isNativePlatform();

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
