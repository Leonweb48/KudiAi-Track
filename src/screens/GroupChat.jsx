import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏", "😍", "💯"];
const ALL_EMOJIS   = ["👍","👎","❤️","😂","😮","😢","😡","🙏","🔥","👏","😍","💯","✅","🎉","💪","🤝","😊","🥳","🤔","💡","✨","🚀","⭐","💎"];
const PAGE_SIZE    = 60;
const BUCKET       = "chat-media";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateSep(ts) {
  const d    = new Date(ts);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: diff > 365 ? "numeric" : undefined });
}
function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
function fmtDuration(secs = 0) {
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
function avatarColor(name = "") {
  const palette = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// ─── Audio Player (in-bubble) ─────────────────────────────────────────────────
function AudioPlayer({ url, duration, isMe }) {
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const audioRef                 = useRef(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended      = () => { setPlaying(false); setCurrent(0); };
    audio.ontimeupdate = () => setCurrent(audio.currentTime);
    return () => { audio.pause(); audioRef.current = null; };
  }, [url]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else         { audioRef.current.play();  setPlaying(true); }
  };

  const total = duration || 1;
  const pct   = Math.min((current / total) * 100, 100);
  const BARS  = [2,3,5,8,6,4,7,9,5,3,6,8,4,7,5,3,8,6,4,5,7,3,5,2];

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] py-0.5">
      <button onClick={toggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isMe ? "bg-white/20 text-white" : "bg-blue-100 text-blue-600"}`}>
        {playing
          ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          : <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-[2px] h-5">
          {BARS.map((h, i) => {
            const filled = (i / BARS.length) * 100 <= pct;
            return (
              <div key={i} className="w-[2px] rounded-full flex-shrink-0"
                style={{
                  height: `${h * 2}px`,
                  background: filled
                    ? (isMe ? "rgba(255,255,255,0.9)" : "#3b82f6")
                    : (isMe ? "rgba(255,255,255,0.3)" : "#cbd5e1"),
                }} />
            );
          })}
        </div>
        <span className={`text-[10px] ${isMe ? "text-white/60" : "text-slate-400"}`}>
          {fmtDuration(current)} / {fmtDuration(duration)}
        </span>
      </div>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 28 }) {
  return (
    <div className="flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: avatarColor(name) }}>
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, isMe, showAvatar, showName, myId, onLongPress, onReact, onReplyTap }) {
  const pressTimer = useRef(null);
  const moved      = useRef(false);

  const startPress = (e) => {
    moved.current = false;
    pressTimer.current = setTimeout(() => { if (!moved.current) onLongPress(msg); }, 480);
  };
  const endPress   = () => { clearTimeout(pressTimer.current); };
  const onMove     = () => { moved.current = true; clearTimeout(pressTimer.current); };

  const reactions = useMemo(() => {
    const groups = {};
    for (const r of (msg.reactions || [])) {
      if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, count: 0, mine: false, names: [] };
      groups[r.emoji].count++;
      groups[r.emoji].names.push(r.user_name);
      if (r.user_id === myId) groups[r.emoji].mine = true;
    }
    return Object.values(groups);
  }, [msg.reactions, myId]);

  if (msg.type === "system") {
    return (
      <div className="flex justify-center my-2 px-3">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm">
          {msg.content}
        </span>
      </div>
    );
  }

  const deleted = msg.is_deleted;
  const isImg   = msg.type === "image";
  const isAudio = msg.type === "audio";

  return (
    <div className={`flex items-end gap-1.5 px-2 my-0.5 ${isMe ? "flex-row-reverse" : ""}`}>

      {/* Avatar */}
      {!isMe && (
        <div className="mb-1 flex-shrink-0" style={{ width: 28 }}>
          {showAvatar ? <Avatar name={msg.sender_name} size={28} /> : <div style={{ width: 28 }} />}
        </div>
      )}

      <div className={`flex flex-col max-w-[78%] ${isMe ? "items-end" : "items-start"}`}>

        {/* Sender name */}
        {showName && !isMe && (
          <span className="text-[11px] font-bold mb-0.5 ml-0.5"
            style={{ color: avatarColor(msg.sender_name) }}>
            {msg.sender_name}
            {(msg.sender_role === "admin" || msg.sender_role === "org") && (
              <span className="ml-1 text-[9px] font-normal text-slate-400">Admin</span>
            )}
          </span>
        )}

        {/* Bubble */}
        <div
          id={`msg-${msg.id}`}
          onPointerDown={startPress} onPointerUp={endPress} onPointerMove={onMove}
          className={[
            "relative rounded-2xl px-3 py-2 shadow-sm select-none transition-colors",
            isMe ? "bg-blue-600 text-white rounded-br-[4px]" : "bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-bl-[4px]",
            deleted ? "opacity-55" : ""
          ].join(" ")}
          style={{ wordBreak: "break-word" }}>

          {/* Quoted reply */}
          {msg.reply_to_id && !deleted && (
            <button onClick={() => onReplyTap(msg.reply_to_id)}
              className={`mb-2 pl-2 border-l-2 rounded w-full text-left ${isMe ? "border-white/50 bg-white/10" : "border-blue-500 bg-blue-50 dark:bg-slate-600/50"}`}>
              <p className={`text-[10px] font-bold truncate ${isMe ? "text-white/80" : "text-blue-600"}`}>
                {msg.reply_to_sender}
              </p>
              <p className={`text-[11px] truncate ${isMe ? "text-white/65" : "text-slate-500 dark:text-slate-300"}`}>
                {msg.reply_to_content || "Message"}
              </p>
            </button>
          )}

          {/* Content */}
          {deleted ? (
            <p className={`text-sm italic ${isMe ? "text-white/55" : "text-slate-400"}`}>
              🚫 This message was deleted
            </p>
          ) : isImg ? (
            <div>
              <img src={msg.media_url} alt="image" loading="lazy"
                onClick={() => window.open(msg.media_url, "_blank")}
                className="rounded-xl max-w-[220px] max-h-[240px] object-cover cursor-zoom-in mb-1" />
              {msg.content && <p className="text-sm">{msg.content}</p>}
            </div>
          ) : isAudio ? (
            <AudioPlayer url={msg.media_url} duration={msg.duration} isMe={isMe} />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          )}

          {/* Footer: time + edited + ticks */}
          {!deleted && (
            <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : "justify-end"}`}>
              {msg.is_edited && (
                <span className={`text-[9px] ${isMe ? "text-white/45" : "text-slate-400"}`}>edited</span>
              )}
              <span className={`text-[10px] ${isMe ? "text-white/55" : "text-slate-400"}`}>
                {fmtTime(msg.created_at)}
              </span>
              {isMe && (
                <svg viewBox="0 0 18 12" fill="none" className="w-4 h-3">
                  <path d="M1 6l4 4L13 2" stroke="rgba(255,255,255,0.65)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 10l6-8" stroke="rgba(255,255,255,0.65)" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              )}
            </div>
          )}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
            {reactions.map(r => (
              <button key={r.emoji} title={r.names.join(", ")}
                onClick={() => onReact(msg, r.emoji)}
                className={`flex items-center gap-0.5 px-1.5 py-[3px] rounded-full text-xs border transition-all active:scale-95
                  ${r.mine
                    ? "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700"
                    : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600"}`}>
                <span className="text-sm">{r.emoji}</span>
                {r.count > 1 && (
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{r.count}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Context Menu (long-press) ────────────────────────────────────────────────
function ContextMenu({ msg, isMe, isAdmin, onClose, onAction }) {
  const items = [
    { id:"reply",   icon:"↩️",  label:"Reply" },
    !msg.is_deleted && { id:"copy",    icon:"📋",  label:"Copy" },
    !msg.is_deleted && isMe && { id:"edit",    icon:"✏️",  label:"Edit" },
    !msg.is_deleted && (isMe || isAdmin) && { id:"delete",  icon:"🗑️",  label:"Delete for everyone", danger: true },
    isAdmin && { id:"pin",    icon: msg.pinned ? "📌" : "📍", label: msg.pinned ? "Unpin" : "Pin message" },
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[3px]" />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden w-full max-w-[280px]"
        onClick={e => e.stopPropagation()}>

        {/* Quick emoji bar */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-100 dark:border-slate-700">
          {QUICK_EMOJIS.slice(0, 8).map(e => (
            <button key={e} onClick={() => { onAction("react", e); onClose(); }}
              className="text-xl transition-transform active:scale-125">{e}
            </button>
          ))}
        </div>

        {/* Actions */}
        {items.map(a => (
          <button key={a.id} onClick={() => { onAction(a.id); onClose(); }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-700
              ${a.danger ? "text-red-500" : "text-slate-700 dark:text-slate-200"}`}>
            <span className="text-base w-6 text-center">{a.icon}</span>
            <span className="text-sm font-semibold">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Emoji Picker (full grid) ─────────────────────────────────────────────────
function EmojiPickerSheet({ onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-2xl pb-6"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mt-3 mb-3" />
        <div className="grid grid-cols-8 gap-0 px-3">
          {ALL_EMOJIS.map(e => (
            <button key={e} onClick={() => { onPick(e); onClose(); }}
              className="py-2.5 text-2xl active:scale-125 transition-transform text-center">{e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Group Info Sheet ─────────────────────────────────────────────────────────
function GroupInfoSheet({ org, orgName, members, onlineIds, onClose }) {
  const total = members.length + 1;
  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: "80vh" }} onClick={e => e.stopPropagation()}>

        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="flex flex-col items-center py-5 flex-shrink-0">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-extrabold text-white mb-3"
            style={{ background: "linear-gradient(145deg,#2563eb,#1e3a8a)" }}>
            {(orgName || "G").charAt(0).toUpperCase()}
          </div>
          <p className="text-lg font-extrabold text-slate-800 dark:text-white">{orgName} Group</p>
          <p className="text-xs text-slate-400 mt-0.5">{total} participant{total !== 1 ? "s" : ""}</p>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.18em] px-5 pt-3 pb-2">
            {total} Participants
          </p>

          {/* Admin entry */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="relative">
              <Avatar name={org?.owner_name || orgName} size={40} />
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-slate-900" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                {org?.owner_name || orgName}
              </p>
              <p className="text-[10px] text-blue-500 font-semibold">Admin · online</p>
            </div>
          </div>

          {members.map(m => {
            const online = onlineIds.includes(m.user_id);
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="relative">
                  <Avatar name={m.full_name} size={40} />
                  {online && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-slate-900" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{m.full_name}</p>
                  <p className={`text-[10px] font-semibold ${online ? "text-green-500" : "text-slate-400"}`}>
                    {online ? "online" : "member"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-sm font-bold text-slate-600 dark:text-slate-300">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pinned Banner ────────────────────────────────────────────────────────────
function PinnedBanner({ msg, onTap }) {
  if (!msg || msg.is_deleted) return null;
  return (
    <button onClick={() => onTap(msg.id)}
      className="w-full flex items-center gap-2.5 px-4 py-2 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900 text-left">
      <div className="w-0.5 h-8 rounded-full bg-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-extrabold text-blue-500 uppercase tracking-wider">Pinned message</p>
        <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
          {msg.type === "audio" ? "🎤 Voice message" : msg.type === "image" ? "📷 Photo" : msg.content}
        </p>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </button>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────
function TypingIndicator({ users }) {
  if (users.length === 0) return null;
  return (
    <div className="flex items-end gap-1.5 px-3 pb-2">
      <Avatar name={users[0]} size={26} />
      <div className="bg-white dark:bg-slate-700 rounded-2xl rounded-bl-[4px] px-3.5 py-2.5 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
      <span className="text-[10px] text-slate-400 mb-1.5">{users[0]} is typing…</span>
    </div>
  );
}

// ─── Main GroupChat ───────────────────────────────────────────────────────────
export default function GroupChat({ orgId, myName, myRole = "member", orgName, org, onBack }) {
  const [myId,         setMyId]         = useState(null);
  const [messages,     setMessages]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(true);
  const [members,      setMembers]      = useState([]);
  const [onlineIds,    setOnlineIds]    = useState([]);
  const [typingUsers,  setTypingUsers]  = useState([]);
  const [text,         setText]         = useState("");
  const [replyTo,      setReplyTo]      = useState(null);
  const [editMsg,      setEditMsg]      = useState(null);
  const [contextMsg,   setContextMsg]   = useState(null);
  const [showEmojiFor, setShowEmojiFor] = useState(null); // message id
  const [showAllEmoji, setShowAllEmoji] = useState(false);
  const [showGroupInfo,setShowGroupInfo]= useState(false);
  const [showSearch,   setShowSearch]   = useState(false);
  const [searchQ,      setSearchQ]      = useState("");
  const [pinnedMsg,    setPinnedMsg]    = useState(null);
  const [recording,    setRecording]    = useState(false);
  const [recSecs,      setRecSecs]      = useState(0);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [sending,      setSending]      = useState(false);
  const [showScrollBtn,setShowScrollBtn]= useState(false);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const [uploadErr,    setUploadErr]    = useState("");

  const listRef      = useRef(null);
  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const fileRef      = useRef(null);
  const channelRef   = useRef(null);
  const recRef       = useRef(null);
  const audioChunks  = useRef([]);
  const recTimer     = useRef(null);
  const typingTimer  = useRef(null);
  const isAtBottom   = useRef(true);
  const oldestCursor = useRef(null);
  const recDuration  = useRef(0);

  const isAdmin = myRole === "admin" || myRole === "org";

  // ── Get current auth user ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data?.user?.id ?? null));
  }, []);

  // ── Load messages ──────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (before = null) => {
    let q = supabase
      .from("org_group_messages")
      .select("*, reactions:org_message_reactions(*)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (before) q = q.lt("created_at", before);
    const { data } = await q;
    return (data || []).reverse();
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    fetchMessages().then(msgs => {
      setMessages(msgs);
      if (msgs.length > 0) oldestCursor.current = msgs[0].created_at;
      if (msgs.length < PAGE_SIZE) setHasMore(false);
      const pinned = [...msgs].reverse().find(m => m.pinned && !m.is_deleted);
      if (pinned) setPinnedMsg(pinned);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView(), 80);
    });

    supabase.from("org_members")
      .select("id, full_name, user_id, role, status")
      .eq("org_id", orgId).eq("status", "active")
      .then(({ data }) => setMembers(data || []));
  }, [orgId, fetchMessages]);

  // ── Mark as read ──────────────────────────────────────────────────────────
  const markRead = useCallback(() => {
    if (!myId || !orgId) return;
    supabase.from("org_chat_reads")
      .upsert({ user_id: myId, org_id: orgId, last_read_at: new Date().toISOString() }, { onConflict: "user_id,org_id" });
  }, [myId, orgId]);

  useEffect(() => { if (myId) markRead(); }, [myId, markRead]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId || !myId) return;

    const ch = supabase.channel(`org-chat-${orgId}`, { config: { presence: { key: myId } } });
    channelRef.current = ch;

    ch
      .on("postgres_changes", {
        event: "INSERT", schema: "public",
        table: "org_group_messages", filter: `org_id=eq.${orgId}`
      }, ({ new: m }) => {
        const msg = { ...m, reactions: [] };
        setMessages(prev => prev.find(x => x.id === msg.id) ? prev : [...prev, msg]);
        if (isAtBottom.current) {
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
          if (m.sender_id !== myId) markRead();
        } else if (m.sender_id !== myId) {
          setUnreadCount(c => c + 1);
        }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public",
        table: "org_group_messages", filter: `org_id=eq.${orgId}`
      }, ({ new: m }) => {
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...m } : x));
        if (m.pinned && !m.is_deleted) setPinnedMsg(m);
        if (!m.pinned && pinnedMsg?.id === m.id) setPinnedMsg(null);
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public",
        table: "org_message_reactions", filter: `org_id=eq.${orgId}`
      }, ({ new: r }) => {
        setMessages(prev => prev.map(m =>
          m.id === r.message_id
            ? { ...m, reactions: [...(m.reactions || []).filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji)), r] }
            : m
        ));
      })
      .on("postgres_changes", {
        event: "DELETE", schema: "public",
        table: "org_message_reactions"
      }, ({ old: r }) => {
        setMessages(prev => prev.map(m =>
          m.id === r.message_id
            ? { ...m, reactions: (m.reactions || []).filter(x => x.id !== r.id) }
            : m
        ));
      })
      .on("presence", { event: "sync" }, () => {
        const state  = ch.presenceState();
        const users  = Object.values(state).flat();
        setOnlineIds(users.map(u => u.user_id).filter(Boolean));
        setTypingUsers(users.filter(u => u.typing && u.user_id !== myId).map(u => u.user_name));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ user_id: myId, user_name: myName, typing: false, role: myRole });
        }
      });

    return () => { supabase.removeChannel(ch); };
  }, [orgId, myId, myName, myRole, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Typing signal ─────────────────────────────────────────────────────────
  const signalTyping = useCallback((on) => {
    channelRef.current?.track({ user_id: myId, user_name: myName, typing: on, role: myRole });
  }, [myId, myName, myRole]);

  const onTextChange = (e) => {
    setText(e.target.value);
    signalTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => signalTyping(false), 2000);
    // auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 112) + "px";
  };

  // ── Scroll handling ────────────────────────────────────────────────────────
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottom.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) { setUnreadCount(0); markRead(); }
    if (el.scrollTop < 100 && hasMore && !loadingMore) loadMore();
  }, [hasMore, loadingMore, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestCursor.current) return;
    setLoadingMore(true);
    const el       = listRef.current;
    const prevH    = el?.scrollHeight || 0;
    const msgs     = await fetchMessages(oldestCursor.current);
    if (msgs.length < PAGE_SIZE) setHasMore(false);
    if (msgs.length > 0) {
      oldestCursor.current = msgs[0].created_at;
      setMessages(prev => [...msgs, ...prev]);
      setTimeout(() => { if (el) el.scrollTop = el.scrollHeight - prevH; }, 0);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, fetchMessages]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMsg = useCallback(async (overrides = {}) => {
    const content = (overrides.content ?? text).trim();
    if (!content && !overrides.media_url) return;
    setSending(true);
    clearTimeout(typingTimer.current);
    signalTyping(false);
    setText("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    const replySnap = replyTo;
    setReplyTo(null);

    await supabase.from("org_group_messages").insert({
      org_id:           orgId,
      sender_id:        myId,
      sender_name:      myName,
      sender_role:      myRole,
      content:          content || null,
      type:             overrides.type      || "text",
      media_url:        overrides.media_url || null,
      media_name:       overrides.media_name || null,
      media_mime:       overrides.media_mime || null,
      duration:         overrides.duration   || null,
      reply_to_id:      replySnap?.id       || null,
      reply_to_content: replySnap ? (replySnap.type === "audio" ? "[Voice message]" : replySnap.type === "image" ? "[Photo]" : replySnap.content?.slice(0, 100)) : null,
      reply_to_sender:  replySnap?.sender_name || null,
    });
    setSending(false);
  }, [text, replyTo, orgId, myId, myName, myRole, signalTyping]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const upload = useCallback(async (file) => {
    const ext  = file.name.split(".").pop() || "bin";
    const path = `${orgId}/${myId}/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return publicUrl;
  }, [orgId, myId]);

  const onPickImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setMediaPreview({ file, url: URL.createObjectURL(file) });
  };

  const sendImage = async () => {
    if (!mediaPreview) return;
    setSending(true);
    setUploadErr("");
    try {
      const url = await upload(mediaPreview.file);
      await sendMsg({ type: "image", media_url: url, media_name: mediaPreview.file.name, media_mime: mediaPreview.file.type, content: text });
      setMediaPreview(null);
    } catch (e) { setUploadErr(e.message || "Upload failed"); }
    setSending(false);
  };

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec    = new MediaRecorder(stream);
      audioChunks.current  = [];
      recDuration.current  = 0;
      rec.ondataavailable  = e => audioChunks.current.push(e.data);
      rec.onstop           = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        try {
          const url = await upload(file);
          await sendMsg({ type: "audio", media_url: url, media_name: file.name, duration: recDuration.current });
        } catch {}
        setRecSecs(0);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      recTimer.current = setInterval(() => {
        setRecSecs(s => { recDuration.current = s + 1; return s + 1; });
      }, 1000);
    } catch { /* no permission */ }
  };

  const stopRecording = () => {
    clearInterval(recTimer.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    clearInterval(recTimer.current);
    if (recRef.current) { recRef.current.onstop = null; recRef.current.stop(); }
    setRecording(false);
    setRecSecs(0);
  };

  // ── Context menu actions ───────────────────────────────────────────────────
  const doAction = useCallback(async (action, msg, extra) => {
    if (action === "reply") {
      setReplyTo(msg);
      setEditMsg(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (action === "react") {
      const emoji    = extra;
      const existing = (msg.reactions || []).find(r => r.user_id === myId && r.emoji === emoji);
      if (existing) {
        await supabase.from("org_message_reactions").delete().eq("id", existing.id);
      } else {
        await supabase.from("org_message_reactions")
          .insert({ message_id: msg.id, org_id: orgId, user_id: myId, user_name: myName, emoji });
      }
    } else if (action === "copy") {
      navigator.clipboard?.writeText(msg.content || "");
    } else if (action === "edit") {
      setEditMsg(msg);
      setReplyTo(null);
      setText(msg.content || "");
      setTimeout(() => { inputRef.current?.focus(); }, 100);
    } else if (action === "delete") {
      await supabase.from("org_group_messages")
        .update({ is_deleted: true, content: null, media_url: null })
        .eq("id", msg.id);
    } else if (action === "pin") {
      await supabase.from("org_group_messages")
        .update({ pinned: !msg.pinned })
        .eq("id", msg.id);
    }
  }, [orgId, myId, myName]);

  const submitEdit = async () => {
    if (!editMsg || !text.trim()) return;
    await supabase.from("org_group_messages")
      .update({ content: text.trim(), is_edited: true, edited_at: new Date().toISOString() })
      .eq("id", editMsg.id);
    setEditMsg(null);
    setText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  // ── Scroll to message ─────────────────────────────────────────────────────
  const scrollToMsg = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "background 0.2s";
    el.style.background = "#fef9c3";
    setTimeout(() => { el.style.background = ""; }, 1200);
  };

  // ── Filtered messages ─────────────────────────────────────────────────────
  const displayMsgs = useMemo(() => {
    if (!searchQ.trim()) return messages;
    const q = searchQ.toLowerCase();
    return messages.filter(m =>
      m.content?.toLowerCase().includes(q) || m.sender_name?.toLowerCase().includes(q)
    );
  }, [messages, searchQ]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasText  = text.trim().length > 0;
  const canSend  = hasText || !!mediaPreview;

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-slate-100 dark:bg-slate-950">
      <div className="w-full max-w-md flex flex-col h-full bg-white dark:bg-slate-900">

        {/* ── Header ── */}
        <div className="flex-shrink-0 bg-blue-700 text-white px-3 py-2.5 flex items-center gap-3"
          style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}>
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <button onClick={() => setShowGroupInfo(true)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm flex-shrink-0 bg-white/20">
              {(orgName || "G").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold truncate">{orgName} Group</p>
              <p className="text-[10px] text-blue-200 truncate">
                {typingUsers.length > 0
                  ? `${typingUsers.slice(0, 2).join(", ")} ${typingUsers.length === 1 ? "is" : "are"} typing…`
                  : `${members.length + 1} members · ${onlineIds.length} online`}
              </p>
            </div>
          </button>
          <button onClick={() => { setShowSearch(s => !s); setSearchQ(""); }}
            className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
        </div>

        {/* ── Search Bar ── */}
        {showSearch && (
          <div className="flex-shrink-0 px-3 py-2 bg-blue-600 border-b border-blue-500">
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} autoFocus
              placeholder="Search messages…"
              className="w-full bg-blue-500/50 text-white placeholder-blue-200 rounded-xl px-3 py-2 text-sm outline-none" />
          </div>
        )}

        {/* ── Pinned Message ── */}
        {!showSearch && <PinnedBanner msg={pinnedMsg} onTap={scrollToMsg} />}

        {/* ── Messages ── */}
        <div
          ref={listRef} onScroll={onScroll}
          className="flex-1 overflow-y-auto"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h60v60H0z' fill='%23f1f5f9'/%3E%3C/svg%3E\")",
            backgroundColor: "#f0f4f8",
          }}>

          {/* Load more button */}
          {loadingMore && (
            <div className="flex justify-center py-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {hasMore && !loadingMore && (
            <div className="flex justify-center py-2">
              <button onClick={loadMore}
                className="text-xs text-blue-600 font-bold bg-white dark:bg-slate-800 px-4 py-1.5 rounded-full shadow-sm active:bg-blue-50">
                Load earlier messages
              </button>
            </div>
          )}

          {/* Empty state */}
          {displayMsgs.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
              <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-4xl mb-4">💬</div>
              <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                {searchQ ? "No results" : "No messages yet"}
              </p>
              <p className="text-sm text-slate-400">
                {searchQ ? "Try a different term" : `Start the ${orgName} group conversation`}
              </p>
            </div>
          )}

          {/* Bubbles */}
          <div className="pt-3 pb-4">
            {displayMsgs.map((msg, i) => {
              const prev      = displayMsgs[i - 1];
              const next      = displayMsgs[i + 1];
              const dateSep   = !prev || !isSameDay(msg.created_at, prev.created_at);
              const isMe      = msg.sender_id === myId;
              const grouped   = !!prev && prev.sender_id === msg.sender_id && !dateSep
                                && (new Date(msg.created_at) - new Date(prev.created_at)) < 90000;
              const showAvatar = !next || next.sender_id !== msg.sender_id
                                 || !isSameDay(msg.created_at, (next?.created_at || ""));
              return (
                <div key={msg.id}>
                  {dateSep && (
                    <div className="flex justify-center my-3">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-white/90 dark:bg-slate-800/90 px-3 py-1 rounded-full shadow-sm font-semibold">
                        {fmtDateSep(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    msg={msg}
                    isMe={isMe}
                    showAvatar={showAvatar}
                    showName={!grouped}
                    myId={myId}
                    onLongPress={(m) => setContextMsg(m)}
                    onReact={(m, e) => doAction("react", m, e)}
                    onReplyTap={scrollToMsg}
                  />
                </div>
              );
            })}
          </div>

          <TypingIndicator users={typingUsers} />
          <div ref={bottomRef} className="h-2" />
        </div>

        {/* ── Scroll to Bottom FAB ── */}
        {showScrollBtn && (
          <button
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setUnreadCount(0); }}
            className="absolute right-4 bottom-[76px] z-10 w-10 h-10 bg-white dark:bg-slate-800 rounded-full shadow-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4 text-slate-600 dark:text-slate-300">
              <path d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
        )}

        {/* ── Image Preview ── */}
        {mediaPreview && (
          <div className="flex-shrink-0 px-3 pt-2.5 pb-1 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
            {uploadErr && <p className="text-xs text-red-500 mb-2">{uploadErr}</p>}
            <div className="flex items-center gap-3">
              <img src={mediaPreview.url} alt="" className="w-16 h-16 object-cover rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{mediaPreview.file.name}</p>
                <p className="text-[10px] text-slate-400">{(mediaPreview.file.size / 1024).toFixed(0)} KB</p>
                <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a caption…"
                  className="mt-1 w-full bg-slate-100 dark:bg-slate-800 rounded-lg px-2 py-1 text-xs text-slate-800 dark:text-white outline-none" />
              </div>
              <button onClick={() => { setMediaPreview(null); setUploadErr(""); }}
                className="text-slate-400 hover:text-red-500 flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Reply Preview ── */}
        {replyTo && !mediaPreview && (
          <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
            <div className="w-0.5 h-8 rounded-full bg-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-blue-600">{replyTo.sender_name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-300 truncate">
                {replyTo.type === "audio" ? "🎤 Voice message" : replyTo.type === "image" ? "📷 Photo" : replyTo.content?.slice(0, 70)}
              </p>
            </div>
            <button onClick={() => setReplyTo(null)} className="text-slate-400 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}

        {/* ── Edit Banner ── */}
        {editMsg && (
          <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900">
            <div className="w-0.5 h-8 rounded-full bg-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-amber-600">Editing message</p>
              <p className="text-xs text-slate-500 dark:text-slate-300 truncate">{editMsg.content?.slice(0, 70)}</p>
            </div>
            <button onClick={() => { setEditMsg(null); setText(""); if (inputRef.current) inputRef.current.style.height = "auto"; }}
              className="text-slate-400 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}

        {/* ── Input Bar ── */}
        <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2.5 py-2"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>

          {recording ? (
            /* Recording mode */
            <div className="flex items-center gap-2">
              <button onClick={cancelRecording}
                className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-500 flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
              <div className="flex-1 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-2xl px-4 py-2.5">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-sm font-bold text-red-600">{fmtDuration(recSecs)}</span>
                <span className="text-xs text-red-400 ml-1">Recording…</span>
              </div>
              <button onClick={stopRecording}
                className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-md flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              {/* Attach */}
              {!mediaPreview && (
                <button onClick={() => fileRef.current?.click()}
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 flex-shrink-0 mb-0.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*,image/gif" onChange={onPickImage} className="hidden" />

              {/* Text area */}
              <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3.5 py-2.5 flex items-end min-h-[40px]">
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={onTextChange}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editMsg) submitEdit();
                      else if (mediaPreview) sendImage();
                      else sendMsg();
                    }
                  }}
                  placeholder="Message…"
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-slate-800 dark:text-white placeholder-slate-400 outline-none resize-none leading-5 w-full"
                  style={{ minHeight: "20px", maxHeight: "112px" }}
                />
              </div>

              {/* Send / Mic */}
              {canSend || editMsg ? (
                <button
                  onClick={() => editMsg ? submitEdit() : mediaPreview ? sendImage() : sendMsg()}
                  disabled={sending}
                  className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 disabled:opacity-50 active:scale-95 transition-transform">
                  {sending
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : editMsg
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M5 12l5 5L20 7"/></svg>
                    : <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>}
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 active:scale-95 transition-transform">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Context Menu (long-press) ── */}
        {contextMsg && (
          <ContextMenu
            msg={contextMsg}
            isMe={contextMsg.sender_id === myId}
            isAdmin={isAdmin}
            onClose={() => setContextMsg(null)}
            onAction={(action, extra) => doAction(action, contextMsg, extra)}
          />
        )}

        {/* ── Full Emoji Picker ── */}
        {showAllEmoji && (
          <EmojiPickerSheet
            onPick={(e) => { if (showEmojiFor) doAction("react", messages.find(m => m.id === showEmojiFor), e); }}
            onClose={() => { setShowAllEmoji(false); setShowEmojiFor(null); }}
          />
        )}

        {/* ── Group Info Sheet ── */}
        {showGroupInfo && (
          <GroupInfoSheet
            org={org}
            orgName={orgName}
            members={members}
            onlineIds={onlineIds}
            onClose={() => setShowGroupInfo(false)}
          />
        )}
      </div>
    </div>
  );
}
