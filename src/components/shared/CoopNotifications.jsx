import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../utils/supabase";

// ── Notification chime (Web Audio API, no file needed) ────────
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1100, 0.13]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0,    ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + delay + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.38);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.4);
    });
  } catch { /* audio unavailable */ }
}

// ── Type/category maps ────────────────────────────────────────
const TYPE = {
  success: { dot: "bg-green-500",  badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",  borderL: "border-l-green-500",  ring: "ring-green-200" },
  error:   { dot: "bg-red-500",    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",          borderL: "border-l-red-500",    ring: "ring-red-200"   },
  alert:   { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",  borderL: "border-l-amber-500",  ring: "ring-amber-200" },
  warning: { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", borderL: "border-l-orange-500", ring: "ring-orange-200" },
  info:    { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",      borderL: "border-l-blue-500",   ring: "ring-blue-200"  },
};
const CAT_ICON = {
  loan:      "M12 2v20|M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  broadcast: "M4.5 9.5a9 9 0 0115 0|M1.5 6.5a13.5 13.5 0 0121 0|M7.5 12.5a4.5 4.5 0 019 0",
  program:   "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 12h6|M9 16h4",
  finance:   "M2 8a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V8z|M2 11h20|M6 15h3",
  member:    "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8z",
  system:    "M12 15a3 3 0 100-6 3 3 0 000 6z|M12 2v2|M12 20v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M2 12h2|M20 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42",
};
const BELL_ICON = "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 01-3.46 0";

function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Hook ─────────────────────────────────────────────────────
export function useCoopNotifications({ orgId, recipientId, recipientType }) {
  const [notifications, setNotifications] = useState([]);
  const [toasts,        setToasts]        = useState([]);
  const [panelOpen,     setPanelOpen]     = useState(false);
  const initialized = useRef(false);

  const addNew = useCallback((notif) => {
    setNotifications(prev => {
      if (prev.some(n => n.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 60);
    });
    setToasts(prev => [
      { ...notif, _tid: notif.id + "_t" + Date.now() },
      ...prev,
    ].slice(0, 3));
    playChime();
  }, []);

  const dismissToast = useCallback((tid) => {
    setToasts(prev => prev.filter(t => t._tid !== tid));
  }, []);

  const markRead = useCallback(async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    if (supabase) await supabase.from("coop_notifications").update({ is_read: true }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    if (!supabase) return;
    let q = supabase.from("coop_notifications").update({ is_read: true }).eq("org_id", orgId);
    if (recipientType === "member" && recipientId) q = q.eq("recipient_id", recipientId);
    else q = q.eq("recipient_type", "org");
    await q;
  }, [orgId, recipientId, recipientType]);

  useEffect(() => {
    if (!orgId || !supabase || initialized.current) return;
    initialized.current = true;

    // Initial fetch
    let q = supabase.from("coop_notifications")
      .select("*").eq("org_id", orgId)
      .order("created_at", { ascending: false }).limit(60);
    if (recipientType === "member" && recipientId) q = q.eq("recipient_id", recipientId);
    else q = q.eq("recipient_type", "org");
    q.then(({ data }) => { if (data) setNotifications(data); });

    // Realtime — RLS ensures only permitted rows arrive
    const channel = supabase
      .channel(`coop_notifs_${orgId}_${recipientId || "org"}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "coop_notifications",
        filter: `org_id=eq.${orgId}`,
      }, ({ new: n }) => {
        if (!n) return;
        if (recipientType === "member") { if (n.recipient_id !== recipientId) return; }
        else { if (n.recipient_type !== "org") return; }
        addNew(n);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId, recipientId, recipientType, addNew]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return {
    notifications, toasts, panelOpen, setPanelOpen,
    unreadCount, markRead, markAllRead, dismissToast,
  };
}

// ── Toast card (auto-dismisses, slides in from top) ──────────
function CoopToast({ notif, onAction, onDismiss }) {
  const t = TYPE[notif.type] || TYPE.info;

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl bg-white dark:bg-slate-800 shadow-2xl flex items-start gap-3 p-3.5 border-l-4 ${t.borderL}`}
      style={{ animation: "coopSlideDown 0.28s cubic-bezier(.22,.68,0,1.2) both", boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${t.badge}`}>
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {(CAT_ICON[notif.category] || BELL_ICON).split("|").map((p, i) => <path key={i} d={p} />)}
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-extrabold text-slate-800 dark:text-white leading-snug truncate">{notif.title}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{notif.body}</p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
        {notif.action_tab && (
          <button onClick={onAction}
            className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2.5 py-1 rounded-full whitespace-nowrap active:scale-95 transition-transform">
            View →
          </button>
        )}
        <button onClick={onDismiss}
          className="text-[11px] text-slate-300 dark:text-slate-600 leading-none px-0.5 active:scale-90">✕</button>
      </div>
    </div>
  );
}

// ── Notification row in panel ─────────────────────────────────
function NotifRow({ notif, onAction }) {
  const t = TYPE[notif.type] || TYPE.info;
  return (
    <button onClick={onAction}
      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-l-[3px] ${t.borderL} transition-colors active:scale-[0.98] ${notif.is_read ? "bg-transparent" : "bg-blue-50/40 dark:bg-blue-900/10"}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${notif.is_read ? "bg-slate-100 dark:bg-slate-700" : t.badge}`}>
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {(CAT_ICON[notif.category] || BELL_ICON).split("|").map((p, i) => <path key={i} d={p} />)}
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[13px] font-bold leading-snug truncate ${notif.is_read ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-white"}`}>
            {notif.title}
          </p>
          {!notif.is_read && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.dot}`} />}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{notif.body}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">{relTime(notif.created_at)}</p>
      </div>
    </button>
  );
}

// ── Chat chime (short 700→900 Hz pop, distinct from notification chime) ─
function playChatChime() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(700, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.28);
  } catch { /* audio unavailable */ }
}

// ── Deterministic avatar colour for chat senders ─────────────
const CHAT_AV_COLORS = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#F7DC6F","#DDA0DD","#98D8C8","#BB8FCE","#85C1E9","#E59866"];
function avatarColorChat(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xFFFFFFFF;
  return CHAT_AV_COLORS[Math.abs(h) % CHAT_AV_COLORS.length];
}

// ── Group chat unread hook ────────────────────────────────────
export function useChatUnread({ orgId, isActive }) {
  const [chatUnread, setChatUnread] = useState(0);
  const [chatToasts, setChatToasts] = useState([]);
  const [myId,       setMyId]       = useState(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Resolve auth UID once
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setMyId(session.user.id);
    });
  }, []);

  // Clear when user enters chat tab
  useEffect(() => {
    if (isActive) { setChatUnread(0); setChatToasts([]); }
  }, [isActive]);

  const dismissChatToast = useCallback((tid) => {
    setChatToasts(prev => prev.filter(t => t._tid !== tid));
  }, []);

  useEffect(() => {
    if (!orgId || !myId || !supabase) return;

    // Initial unread count (messages since last read, not mine, not deleted)
    supabase.from("org_chat_reads")
      .select("last_read_at").eq("org_id", orgId).eq("user_id", myId).maybeSingle()
      .then(({ data }) => {
        const lastRead = data?.last_read_at || null;
        let q = supabase.from("org_group_messages")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId).neq("sender_id", myId).eq("is_deleted", false);
        if (lastRead) q = q.gt("created_at", lastRead);
        q.then(({ count }) => { if (count) setChatUnread(count); });
      });

    // Realtime: new messages from others
    const ch = supabase
      .channel(`chat_unread_${orgId}_${myId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "org_group_messages",
        filter: `org_id=eq.${orgId}`,
      }, ({ new: msg }) => {
        if (!msg || msg.sender_id === myId || msg.is_deleted) return;
        if (isActiveRef.current) return;
        setChatUnread(prev => prev + 1);
        playChatChime();
        setChatToasts(prev => [{
          id: msg.id,
          sender_name: msg.sender_name || "Someone",
          content: msg.content || "",
          type: msg.type || "text",
          created_at: msg.created_at,
          _tid: msg.id + "_ct_" + Date.now(),
        }, ...prev].slice(0, 3));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [orgId, myId]);

  return { chatUnread, chatToasts, dismissChatToast };
}

// ── WhatsApp-style chat drop-in toast ─────────────────────────
export function ChatToast({ toast, orgName, onNavigate, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const preview = toast.type === "voice"    ? "🎤 Voice message"
    : toast.type === "image"                ? "📷 Photo"
    : toast.type === "document"             ? "📎 Document"
    : (toast.content || "").slice(0, 80)  || "New message";

  const initials = (toast.sender_name || "?")
    .split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  const avColor = avatarColorChat(toast.sender_name || "");

  return (
    <>
      <style>{`@keyframes coopSlideDown{from{transform:translateY(-16px) scale(.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}`}</style>
      <div
        className="pointer-events-auto w-full rounded-2xl bg-white dark:bg-slate-800 shadow-2xl overflow-hidden"
        style={{ animation: "coopSlideDown 0.28s cubic-bezier(.22,.68,0,1.2) both", boxShadow: "0 8px 40px rgba(0,0,0,.18)" }}
      >
        {/* WhatsApp-style green header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-600">
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span className="text-[10px] font-bold text-white/90 flex-1 truncate">{orgName || "Group Chat"}</span>
          <button onClick={onDismiss} className="text-white/70 text-[11px] leading-none px-0.5 active:scale-90">✕</button>
        </div>
        {/* Body — tap to open chat */}
        <button
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors"
          onClick={onNavigate}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
            style={{ backgroundColor: avColor }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-extrabold text-slate-800 dark:text-white leading-tight truncate">{toast.sender_name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{preview}</p>
          </div>
          <span className="text-[9px] text-slate-400 dark:text-slate-600 flex-shrink-0 self-start pt-0.5">{relTime(toast.created_at)}</span>
        </button>
      </div>
    </>
  );
}

// ── Main bell component — drop this into any portal header ────
export function CoopNotificationBell({ orgId, recipientId, recipientType, onNavigate }) {
  const {
    notifications, toasts, panelOpen, setPanelOpen,
    unreadCount, markRead, markAllRead, dismissToast,
  } = useCoopNotifications({ orgId, recipientId, recipientType });

  const handleAction = useCallback((notif, tid) => {
    markRead(notif.id);
    if (tid) dismissToast(tid);
    setPanelOpen(false);
    if (notif.action_tab && onNavigate) onNavigate(notif.action_tab);
  }, [markRead, dismissToast, setPanelOpen, onNavigate]);

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes coopSlideDown {
          from { transform: translateY(-16px) scale(0.95); opacity: 0; }
          to   { transform: translateY(0)     scale(1);    opacity: 1; }
        }
      `}</style>

      {/* Bell button */}
      <button
        onClick={() => setPanelOpen(p => !p)}
        className="relative w-9 h-9 flex items-center justify-center rounded-xl active:scale-90 transition-transform focus-visible:outline-none"
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-[22px] h-[22px] text-slate-600 dark:text-slate-300"
          stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5 shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Toast stack — renders below header */}
      <div className="fixed top-[60px] inset-x-0 z-toast flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <CoopToast
            key={t._tid}
            notif={t}
            onAction={() => handleAction(t, t._tid)}
            onDismiss={() => dismissToast(t._tid)}
          />
        ))}
      </div>

      {/* Notification panel — bottom sheet */}
      {panelOpen && (
        <div className="fixed inset-0 z-modal flex items-end justify-center"
          onClick={() => setPanelOpen(false)}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
          <div
            className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl flex flex-col"
            style={{ maxHeight: "88dvh", animation: "coopSlideDown 0.22s ease-out both" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mt-3 mb-0 flex-shrink-0" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-800 dark:text-white leading-tight">Notifications</h3>
                {unreadCount > 0 && (
                  <p className="text-[11px] text-slate-400 mt-0.5">{unreadCount} unread</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead}
                    className="text-[11px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1.5 rounded-full active:scale-95 transition-transform">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setPanelOpen(false)}
                  className="w-7 h-7 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center active:scale-90 transition-transform">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center text-3xl mb-4">🔔</div>
                  <p className="text-[13px] font-bold text-slate-500 dark:text-slate-400">No notifications yet</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-1">Activity updates will appear here</p>
                </div>
              ) : (
                notifications.map(n => (
                  <NotifRow key={n.id} notif={n} onAction={() => handleAction(n, null)} />
                ))
              )}
            </div>
            <div style={{ height: "max(12px, env(safe-area-inset-bottom))" }} className="flex-shrink-0" />
          </div>
        </div>
      )}
    </>
  );
}
