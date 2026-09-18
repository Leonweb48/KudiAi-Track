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

export function useNotifications(userId, onNewNotification = null) {
  // Each hook instance gets a stable unique suffix so two callers with the
  // same userId never create channels with identical names (Supabase throws
  // if .on() is called on an already-subscribed channel).
  const instanceId = useRef(null);
  if (!instanceId.current) instanceId.current = Math.random().toString(36).slice(2, 8);

  // Keep a ref to the callback so the realtime effect never needs to re-subscribe
  // when the caller re-renders with a new function reference.
  const onNewNotificationRef = useRef(onNewNotification);
  useEffect(() => { onNewNotificationRef.current = onNewNotification; });

  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [hasMore,       setHasMore]       = useState(false);
  const [page,          setPage]          = useState(0);
  const [unreadCount,   setUnreadCount]   = useState(0);

  // ── Unread count: a real COUNT query, not derived from the paged rows ──────
  // (the old approach undercounted once unread passed the current page size).
  const refetchUnreadCount = useCallback(async () => {
    if (!userId) { setUnreadCount(0); return; }
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .is("dismissed_at", null);
    setUnreadCount(count ?? 0);
  }, [userId]);

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
      .select("id,user_id,type,category,title,body,deep_link,priority,read_at,dismissed_at,created_at")
      .eq("user_id", userId)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    setLoading(false);
    if (error) { console.error("fetchPage error:", error.message); return; }
    if (!data) return;
    if (reset) { setNotifications(data); setPage(1); }
    else        { setNotifications(prev => [...prev, ...data]); setPage(p => p + 1); }
    setHasMore(data.length === PAGE_SIZE);
  }, [userId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    fetchPage(true);
    refetchUnreadCount();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications_rt_${userId}_${instanceId.current}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => {
          if (p.new.dismissed_at) return;
          setNotifications(prev => [p.new, ...prev]);
          refetchUnreadCount();
          onNewNotificationRef.current?.(p.new);
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => {
          if (p.new.dismissed_at) {
            setNotifications(prev => prev.filter(n => n.id !== p.new.id));
          } else {
            setNotifications(prev => prev.map(n => n.id === p.new.id ? p.new : n));
          }
          refetchUnreadCount();
        },
      )
      .subscribe((status, err) => {
        if (err || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Realtime subscription failed:", status, err);
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [userId, refetchUnreadCount]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    setUnreadCount(c => Math.max(0, c - 1));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  }, []);

  // Swipe-left: soft dismiss (no DELETE policy exists on notifications by
  // design — it's an audit trail). Also marks read so the badge stays
  // accurate for an unread row the user swiped away without opening.
  const dismiss = useCallback(async (id) => {
    const now = new Date().toISOString();
    let wasUnread = false;
    setNotifications(prev => prev.filter(n => {
      if (n.id === id && !n.read_at) wasUnread = true;
      return n.id !== id;
    }));
    if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    await supabase.from("notifications")
      .update({ dismissed_at: now, read_at: now })
      .eq("id", id)
      .is("dismissed_at", null);
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    await supabase.from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  }, [userId]);

  const loadMore = useCallback(() => { if (!loading && hasMore) fetchPage(false); }, [loading, hasMore, fetchPage]);

  return { notifications, unreadCount, badgeTabs, loading, hasMore, loadMore, markRead, markAllRead, dismiss };
}
