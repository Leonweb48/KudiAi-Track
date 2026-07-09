import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";

const CACHE_KEY = "kt_campaigns_v3";
const CACHE_TTL = 60 * 1000; // 60 seconds

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

async function fetchCampaigns(requestedSlots) {
  // Get user profile for targeting context
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

  // Fetch directly from Supabase — no cross-origin Vercel call needed
  let query = supabase
    .from("ad_campaigns")
    .select("*")
    .in("status", ["active", "live"])
    .order("priority", { ascending: false });

  if (requestedSlots?.length) {
    query = query.in("slot", requestedSlots);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[useCampaigns] fetch error:", error.message);
    return null;
  }

  // Filter by schedule and targeting in JS
  const filtered = (data || []).filter(
    c => isWithinSchedule(c) && matchesTargeting(c.targeting, ctx)
  );

  // Group by slot with density limits
  const limits = { home_banner: 5, popup: 1, announcement_bar: 1, feed_card: 1, upsell_inline: 3 };
  const slots = {};
  for (const c of filtered) {
    if (!slots[c.slot]) slots[c.slot] = [];
    if (slots[c.slot].length < (limits[c.slot] ?? 5)) slots[c.slot].push(c);
  }

  return slots;
}

export function useCampaigns(requestedSlots) {
  const [slotMap,  setSlotMap]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const cacheRef               = useRef(null);

  const load = useCallback(async () => {
    // Serve from memory cache if fresh
    if (cacheRef.current && Date.now() - cacheRef.current.ts < CACHE_TTL) {
      setSlotMap(cacheRef.current.data);
      setLoading(false);
      return;
    }

    // Show stale localStorage cache immediately while refreshing
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        setSlotMap(stored.data || {});
        setLoading(false);
        cacheRef.current = stored;
      }
    } catch {}

    // Fetch fresh data
    try {
      const slots = await fetchCampaigns(requestedSlots);
      if (slots) {
        const entry = { data: slots, ts: Date.now() };
        cacheRef.current = entry;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch {}
        setSlotMap(slots);
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
