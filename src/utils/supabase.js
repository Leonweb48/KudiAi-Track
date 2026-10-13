import { createClient } from "@supabase/supabase-js";

// In production, route all HTTP calls through the Vercel proxy so users see
// kudiai.app in their network tab instead of the raw Supabase project address.
// Vercel Hobby doesn't proxy WebSockets, so realtime gets a custom transport
// that redirects the WS connection directly to Supabase.
const SUPABASE_DIRECT = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON   = process.env.REACT_APP_SUPABASE_ANON_KEY;

const isProd = process.env.NODE_ENV === "production";
const SUPABASE_URL = isProd ? "https://kudiai.app/sb" : SUPABASE_DIRECT;

// Realtime WebSocket must bypass the Vercel proxy — redirect wss://kudiai.app/sb → wss://supabase
const DIRECT_WS = (SUPABASE_DIRECT || "").replace(/^https/, "wss");
class DirectRealtimeWs extends WebSocket {
  constructor(url, protocols) {
    super(url.replace(/^wss:\/\/kudiai\.app\/sb/, DIRECT_WS), protocols);
  }
}

// Every request gets a time limit (2026-10-14). Without one, a stalled connection (weak signal, a request stuck in the
// proxy) never errors, so the app sat on its loading spinner forever and only a refresh / reopen got past it. Data and
// sign-in calls: 20 s. Uploads and edge functions (transfers, AI, reports): 90 s. A caller's own abort signal still works.
const LONG_MS = 90000, SHORT_MS = 20000;
export function fetchWithTimeout(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url || "";
  const ms = /\/(functions|storage)\/v1\//.test(url) ? LONG_MS : SHORT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export const supabase =
  SUPABASE_URL && SUPABASE_ANON
    ? createClient(SUPABASE_URL, SUPABASE_ANON, {
        realtime: { transport: DirectRealtimeWs },
        global: { fetch: (...args) => fetchWithTimeout(...args) },
      })
    : null;

export const supabaseConfigured = Boolean(supabase);

// The raw Supabase project URL (bypasses Vercel proxy).
// Used to construct OAuth authorize URLs directly so Vercel's proxy
// does not interfere with the 302 redirect chain to Google/providers.
export const SUPABASE_DIRECT_URL = SUPABASE_DIRECT || "";
export const SUPABASE_PROXY_URL  = isProd ? "https://kudiai.app/sb" : "";
