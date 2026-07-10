import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";
import { isSlotAllowed, isClientPortal, CLIENT_PORTAL_FORBIDDEN_SLOTS } from "../components/slots/SlotRegistry";

const CACHE_KEY = "kt_campaigns_v6"; // v6: page-level targeting
const CACHE_TTL = 60 * 1000;

function getPlatform() {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

function isWithinSchedule(c) {
  const now = new Date();
  if (c.starts_at && new Date(c.starts_at) > now) return false;
  if (c.ends_at   && new Date(c.ends_at)   < now) return false;
  return true;
}

function matchesTargeting(c, ctx) {
  const { targeting, target_portals } = c;

  // Portal targeting: campaign must explicitly include this portal.
  // Empty target_portals = unconfigured = show to nobody.
  const portals = target_portals ?? [];
  if (!portals.includes(ctx.portalType)) return false;

  // Structural slot enforcement: client portals can NEVER receive forbidden slots.
  if (isClientPortal(ctx.portalType) && CLIENT_PORTAL_FORBIDDEN_SLOTS.has(c.slot)) return false;

  // Slot must be registered for this portal type
  if (!isSlotAllowed(c.slot, ctx.portalType)) return false;

  // Standard targeting dimensions (plans, roles, platforms)
  if (!targeting || typeof targeting !== "object") return true;
  const { plans, roles, platforms } = targeting;
  if (plans?.length     && !plans.includes(ctx.plan))         return false;
  if (roles?.length     && !roles.includes(ctx.role))         return false;
  if (platforms?.length && !platforms.includes(ctx.platform)) return false;
  return true;
}

async function fetchAllCampaigns(portalType) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, plan, subscription_plan")
    .eq("id", user.id)
    .single();

  const ctx = {
    plan:       profile?.plan || profile?.subscription_plan || "starter",
    role:       profile?.role || "owner",
    platform:   getPlatform(),
    portalType: portalType || "business",
  };

  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("*")
    .in("status", ["active", "live"])
    .order("priority", { ascending: false });

  if (error) {
    console.error("[useCampaigns] fetch error:", error.message);
    return null;
  }

  const filtered = (data || []).filter(c => isWithinSchedule(c) && matchesTargeting(c, ctx));

  // Store ALL matching campaigns per slot — limits applied in pickSlots after page filter
  const slots = {};
  for (const c of filtered) {
    if (!slots[c.slot]) slots[c.slot] = [];
    slots[c.slot].push(c);
  }
  return slots;
}

const SLOT_LIMITS = {
  home_banner: 5, popup: 5, announcement_bar: 5, feed_card: 1,
  upsell_inline: 5, offers_section: 5, tab_card_quad: 1, tab_card_duo: 1,
};

function pickSlots(allSlots, requestedSlots, currentPage) {
  const result = {};
  const slots = requestedSlots?.length ? requestedSlots : Object.keys(allSlots);
  for (const slot of slots) {
    let campaigns = allSlots[slot] ?? [];
    // Page filter: empty target_pages = all pages (backward compat), otherwise must match
    if (currentPage) {
      campaigns = campaigns.filter(c => !c.target_pages?.length || c.target_pages.includes(currentPage));
    }
    if (campaigns.length) result[slot] = campaigns.slice(0, SLOT_LIMITS[slot] ?? 5);
  }
  return result;
}

// portalType: "business" | "staff" | "organisation" | "ajo_client" | "org_member"
// currentPage: stable page key from PageRegistry, e.g. "business.home" (optional)
export function useCampaigns(requestedSlots, portalType = "business", currentPage = null) {
  const [slotMap,  setSlotMap]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const cacheRef               = useRef(null);

  const cacheKey = `${CACHE_KEY}_${portalType}`;

  const load = useCallback(async () => {
    if (cacheRef.current && Date.now() - cacheRef.current.ts < CACHE_TTL) {
      setSlotMap(pickSlots(cacheRef.current.data, requestedSlots, currentPage));
      setLoading(false);
      return;
    }
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const stored = JSON.parse(raw);
        setSlotMap(pickSlots(stored.data || {}, requestedSlots, currentPage));
        setLoading(false);
        cacheRef.current = stored;
      }
    } catch {}
    try {
      const allSlots = await fetchAllCampaigns(portalType);
      if (allSlots) {
        const entry = { data: allSlots, ts: Date.now() };
        cacheRef.current = entry;
        try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch {}
        setSlotMap(pickSlots(allSlots, requestedSlots, currentPage));
      }
    } catch (err) {
      console.error("[useCampaigns] error:", err);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // options: { pageKey?: string, tileIndex?: number }
  const recordEvent = useCallback(async (campaignId, eventType, options = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("ad_campaign_events").insert({
        campaign_id: campaignId,
        user_id:     user.id,
        event_type:  eventType,
        page_key:    options.pageKey  ?? currentPage ?? null,
        tile_index:  options.tileIndex != null ? options.tileIndex : null,
        platform:    getPlatform(),
      });
    } catch {}
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  return { slotMap, loading, recordEvent };
}
