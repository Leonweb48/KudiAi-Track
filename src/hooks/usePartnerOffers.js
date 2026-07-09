// Fetches active partner offers for a given portal type.
// Enforces: permitted_portals tag, live status, partner kill-switch, schedule.
// Generates opaque attribution tokens — no user PII in outbound URLs.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";

const CACHE_TTL = 90 * 1000; // 90 seconds

function getPlatform() {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

function isWithinSchedule(o) {
  const now = new Date();
  if (o.starts_at && new Date(o.starts_at) > now) return false;
  if (o.ends_at   && new Date(o.ends_at)   < now) return false;
  return true;
}

// Generate opaque token (no user info)
function genToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function fetchOffers(portalType) {
  // Live offers whose permitted_portals includes this portal type.
  // The @> (contains) operator checks if permitted_portals array includes portalType.
  const { data, error } = await supabase
    .from("partner_offers")
    .select("*, partner:partner_id(name, logo_url, category, kill_switch_active)")
    .eq("status", "live")
    .contains("permitted_portals", [portalType])
    .order("priority", { ascending: false });

  if (error) {
    console.error("[usePartnerOffers] fetch error:", error.message);
    return [];
  }

  return (data || [])
    .filter(o =>
      isWithinSchedule(o) &&
      !o.partner?.kill_switch_active   // partner kill-switch enforced client-side
    );
}

async function storeToken(offerId, token, portalType, userHash) {
  try {
    await supabase.from("attribution_tokens").insert({
      token, offer_id: offerId, portal_type: portalType, user_hash: userHash,
    });
  } catch {}
}

export function usePartnerOffers(portalType) {
  const [offers,   setOffers]   = useState([]);
  const [tokens,   setTokens]   = useState({}); // offerId → token
  const [loading,  setLoading]  = useState(true);
  const cacheRef = useRef(null);

  const load = useCallback(async () => {
    if (cacheRef.current && Date.now() - cacheRef.current.ts < CACHE_TTL) {
      setOffers(cacheRef.current.offers);
      setTokens(cacheRef.current.tokens);
      setLoading(false);
      return;
    }
    try {
      const raw = await fetchOffers(portalType);
      // Generate tokens for each offer (opaque, no PII)
      const { data: { user } } = await supabase.auth.getUser();
      const userHash = user?.id ? btoa(user.id.slice(-6)).replace(/=/g, "") : "anon";
      const tokenMap = {};
      for (const o of raw) {
        const t = genToken();
        tokenMap[o.id] = t;
        storeToken(o.id, t, portalType, userHash); // fire-and-forget
      }
      cacheRef.current = { offers: raw, tokens: tokenMap, ts: Date.now() };
      setOffers(raw);
      setTokens(tokenMap);
    } catch (err) {
      console.error("[usePartnerOffers] error:", err);
    } finally {
      setLoading(false);
    }
  }, [portalType]);

  useEffect(() => { load(); }, [load]);

  const recordEvent = useCallback(async (offerId, eventType) => {
    const token = tokens[offerId];
    if (!token) return;
    try {
      await supabase.from("partner_offer_events").insert({
        offer_id: offerId,
        attribution_token: token,
        portal_type: portalType,
        event_type: eventType,
        platform: getPlatform(),
      });
    } catch {}
  }, [tokens, portalType]);

  // Returns the CTA URL with opaque ref token appended — no user PII
  const ctaUrl = useCallback((offer) => {
    const token = tokens[offer.id];
    if (!token) return offer.cta_url;
    try {
      const url = new URL(offer.cta_url);
      url.searchParams.set("ref", token);
      return url.toString();
    } catch {
      return offer.cta_url + (offer.cta_url.includes("?") ? "&" : "?") + "ref=" + token;
    }
  }, [tokens]);

  return { offers, loading, recordEvent, ctaUrl };
}
