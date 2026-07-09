import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";

const CACHE_KEY = "kt_campaigns_cache_v2";
const CACHE_TTL = 60 * 1000; // 60 seconds

const API_BASE = Capacitor.isNativePlatform() ? "https://kudiai.app" : "";

function getPlatform() {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

async function fetchCampaigns(slots) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const platform = getPlatform();
  const qs       = slots?.length ? `&slots=${slots.join(",")}` : "";
  const res       = await fetch(`${API_BASE}/api/campaigns?platform=${platform}${qs}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function useCampaigns(requestedSlots) {
  const [slotMap,  setSlotMap]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const cacheRef               = useRef(null);

  const load = useCallback(async () => {
    // Try memory cache first
    if (cacheRef.current && Date.now() - cacheRef.current.ts < CACHE_TTL) {
      setSlotMap(cacheRef.current.data);
      setLoading(false);
      return;
    }
    // Try localStorage offline cache
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (Date.now() - stored.ts < CACHE_TTL) {
          setSlotMap(stored.data);
          setLoading(false);
          cacheRef.current = stored;
          // Still refresh in background
        }
      }
    } catch {}

    try {
      const result = await fetchCampaigns(requestedSlots);
      if (result?.slots) {
        const entry = { data: result.slots, ts: Date.now() };
        cacheRef.current = entry;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch {}
        setSlotMap(result.slots);
      }
    } catch {
      // Fail silently; show cached or nothing
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const recordEvent = useCallback(async (campaignId, eventType) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      fetch(`${API_BASE}/api/campaigns`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ campaign_id: campaignId, event_type: eventType, platform: getPlatform() }),
      });
    } catch {}
  }, []);

  return { slotMap, loading, recordEvent };
}
