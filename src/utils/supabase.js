import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnon = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnon
    ? createClient(supabaseUrl, supabaseAnon, {
        auth: {
          flowType: "implicit",
          detectSessionInUrl: false,
          persistSession: true,
          storage: window.localStorage,
        },
      })
    : null;

export const supabaseConfigured = Boolean(supabase);
