import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";

const CACHE_KEY = "kt_campaigns_v4"; // v4: always fetches all slots to prevent cache pollution
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

function matchesTargeting(targeting, ctx) {
  if (!targeting || typeof targeting !== "object") return true;
  const { plans, roles, platforms } = targeting;
  if (plans?.length     && !plans.includes(ctx.plan))         return false;
  if (roles?.length     && !roles.includes(ctx.role))         return false;
  if (platforms?.length && !platforms.includes(ctx.platform)) return false;
  return true;
}

// Always fetches ALL active campaigns — never filtered by slot at DB level.
// Filtering by slot at DB level causes the shared cache to only contain a subset
// of slots, breaking other screens that need different slots from the same cache.
async function fetchAllCampaigns() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, plan, subscription_plan")
    .eq("id", user.id)
    .single();

  const ctx = {
    plan:     profile?.plan || profile?.subscription_plan || "starter",
    role:     profile?.role || "owner",
    platform: getPlatform(),
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

  const filtered = (data || []).filter(
    c => isWithinSchedule(c) && matchesTargeting(c.targeting, ctx)
  );

  const limits = { home_banner: 5, popup: 1, announcement_bar: 1, feed_card: 1, upsell_inline: 3 };
  const slots = {};
  for (const c of filtered) {
    if (!slots[c.slot]) slots[c.slot] = [];
    if (slots[c.slot].length < (limits[c.slot] ?? 5)) slots[c.slot].push(c);
  }
  return slots;
}

function pickSlots(allSlots, requestedSlots) {
  if (!requestedSlots?.length) return allSlots;
  const result = {};
  for (const slot of requestedSlots) {
    if (allSlots[slot]) result[slot] = allSlots[slot];
  }
  return result;
}

export function useCampaigns(requestedSlots) {
  const [slotMap,  setSlotMap]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const cacheRef               = useRef(null); // holds full all-slot data

  const load = useCallback(async () => {
    // In-memory cache hit
    if (cacheRef.current && Date.now() - cacheRef.current.ts < CACHE_TTL) {
      setSlotMap(pickSlots(cacheRef.current.data, requestedSlots));
      setLoading(false);
      return;
    }

    // Show stale localStorage cache immediately while fetching fresh
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        const allSlots = stored.data || {};
        setSlotMap(pickSlots(allSlots, requestedSlots));
        setLoading(false);
        cacheRef.current = stored;
      }
    } catch {}

    // Fetch fresh — always ALL slots, store full result in cache
    try {
      const allSlots = await fetchAllCampaigns();
      if (allSlots) {
        const entry = { data: allSlots, ts: Date.now() };
        cacheRef.current = entry;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch {}
        setSlotMap(pickSlots(allSlots, requestedSlots));
      }
    } catch (err) {
      console.error("[useCampaigns] error:", err);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const recordEvent = useCallback(async (campaignId, eventType) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("ad_campaign_events").insert({
        campaign_id: campaignId,
        user_id: user.id,
        event_type: eventType,
        platform: getPlatform(),
      });
    } catch {}
  }, []);

  return { slotMap, loading, recordEvent };
}
