import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";

const PAGE_SIZE = 50;

// Tab targets that earn a BottomNav badge when high-priority unread notifs reference them
const NAV_TAB_ALIASES = {
  aso:          "more",   // aso lives under Finance → "more" pill
  finance:      "more",
  credit:       "more",
  insights:     "more",
  settings:     "more",
  contributions: null,    // member-portal tabs — no BottomNav badge
  loans:         null,
  broadcast:     null,
  transactions: "transactions",
  inventory:    "inventory",
  bills:        "bills",
  home:         "home",
};

export function useNotifications(userId) {
  // Each hook instance gets a stable unique suffix so two callers with the
  // same userId never create channels with identical names (Supabase throws
  // if .on() is called on an already-subscribed channel).
  const instanceId = useRef(null);
  if (!instanceId.current) instanceId.current = Math.random().toString(36).slice(2, 8);

  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [hasMore,       setHasMore]       = useState(false);
  const [page,          setPage]          = useState(0);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read_at).length,
    [notifications],
  );

  // Set of BottomNav tab IDs that have at least one unread high-priority notification
  const badgeTabs = useMemo(() => {
    const s = new Set();
    notifications
      .filter(n => !n.read_at && n.priority === "high")
      .forEach(n => {
        const navTab = NAV_TAB_ALIASES[n.deep_link?.tab];
        if (navTab) s.add(navTab);
      });
    return s;
  }, [notifications]);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (reset = false) => {
    if (!userId) return;
    setLoading(true);
    const from = reset ? 0 : page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("notifications")
      .select("id,user_id,type,title,body,deep_link,priority,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    setLoading(false);
    if (error) { console.error("[Notif] fetchPage error:", error.message); return; }
    if (!data) return;
    if (reset) { setNotifications(data); setPage(1); }
    else        { setNotifications(prev => [...prev, ...data]); setPage(p => p + 1); }
    setHasMore(data.length === PAGE_SIZE);
  }, [userId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId) return;
    fetchPage(true);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications_rt_${userId}_${instanceId.current}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => setNotifications(prev => [p.new, ...prev]),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => setNotifications(prev => prev.map(n => n.id === p.new.id ? p.new : n)),
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("[Notif] Realtime SUBSCRIBED for", userId?.slice(0, 8));
        } else if (err || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[Notif] Realtime subscription failed:", status, err);
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    await supabase.from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  }, [userId]);

  const loadMore = useCallback(() => { if (!loading && hasMore) fetchPage(false); }, [loading, hasMore, fetchPage]);

  return { notifications, unreadCount, badgeTabs, loading, hasMore, loadMore, markRead, markAllRead };
}
