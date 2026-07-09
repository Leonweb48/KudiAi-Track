import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const seenKey     = (id) => `kt_promo_seen_${id}`;
const sessionKey  = (id) => `kt_promo_sess_${id}`;

export function usePromotions(placement, plan = "") {
  const [promotions, setPromotions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const now = new Date().toISOString();
        const { data } = await supabase
          .from("promotions")
          .select("*")
          .eq("is_active", true)
          .or(`start_at.is.null,start_at.lte.${now}`)
          .or(`end_at.is.null,end_at.gte.${now}`)
          .order("sort_order", { ascending: true });

        if (cancelled || !data) return;

        const today = new Date().toDateString();

        const filtered = data.filter(p => {
          const placements = Array.isArray(p.placement) ? p.placement : [];
          if (!placements.includes("all") && !placements.includes(placement)) return false;

          const targets = Array.isArray(p.target_plans) ? p.target_plans : [];
          if (targets.length > 0 && plan && !targets.includes(plan)) return false;

          if (p.display_freq === "once_per_day") {
            try { if (localStorage.getItem(seenKey(p.id)) === today) return false; } catch {}
          } else if (p.display_freq === "once_per_session") {
            try { if (sessionStorage.getItem(sessionKey(p.id))) return false; } catch {}
          }

          return true;
        });

        setPromotions(filtered);
      } catch {
        // Promotions are non-critical — fail silently
      }
    };
    load();
    return () => { cancelled = true; };
  }, [placement, plan]);

  const markSeen = useCallback((id, freq) => {
    if (freq === "once_per_day") {
      try { localStorage.setItem(seenKey(id), new Date().toDateString()); } catch {}
    } else if (freq === "once_per_session") {
      try { sessionStorage.setItem(sessionKey(id), "1"); } catch {}
    }
    setPromotions(prev => prev.filter(p => p.id !== id));
  }, []);

  const popups       = promotions.filter(p => p.layout === "popup");
  const banners      = promotions.filter(p => p.layout === "banner");
  const carouselItems = promotions.filter(p => p.layout === "carousel_item");

  return { popups, banners, carouselItems, markSeen };
}
