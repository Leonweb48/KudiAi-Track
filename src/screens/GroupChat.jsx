import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ["👍","❤️","😂","😮","😢","🙏","🔥","👏","🎉","💯"];
const ALL_EMOJIS   = ["👍","👎","❤️","😂","😮","😢","😡","🙏","🔥","👏","😍","💯","✅","🎉","💪","🤝","😊","🥳","🤔","💡","✨","🚀","⭐","💎","🫶","🙌","🤩","😎","🥰","😤"];
const PAGE_SIZE    = 60;
const BUCKET       = "chat-media";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = ts =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const fmtDateSep = ts => {
  const d    = new Date(ts);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: diff > 365 ? "numeric" : undefined });
};

const isSameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();

const fmtDuration = (secs = 0) => {
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

const fmtRelTime = ts => {
  if (!ts) return "never";
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)  return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { day:"numeric", month:"short" });
};

const avatarColor = (name = "") => {
  const p = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return p[Math.abs(h) % p.length];
};

// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ url, duration, isMe }) {
  const [playing, setPlaying] = useState(false);
  const [cur,     setCur]     = useState(0);
  const ref                    = useRef(null);

  useEffect(() => {
    const a = new Audio(url);
    ref.current = a;
    a.onended      = () => { setPlaying(false); setCur(0); };
    a.ontimeupdate = () => setCur(a.currentTime);
    return () => { a.pause(); ref.current = null; };
  }, [url]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else         { a.play();  setPlaying(true); }
  };

  const pct  = Math.min(((cur || 0) / (duration || 1)) * 100, 100);
  const BARS = [2,4,7,5,8,3,6,9,4,7,5,3,8,6,4,5,9,3,7,5,4,6,3,5];

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] py-0.5">
      <button onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-90
          ${isMe ? "bg-white/20 hover:bg-white/30" : "bg-blue-100 hover:bg-blue-200"}`}>
        {playing
          ? <svg viewBox="0 0 24 24" fill={isMe ? "white" : "#2563eb"} className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg viewBox="0 0 24 24" fill={isMe ? "white" : "#2563eb"} className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-[2px] h-6">
          {BARS.map((h, i) => {
            const filled = (i / BARS.length) * 100 <= pct;
            return (
              <div key={i} className="w-[2.5px] rounded-full flex-shrink-0 transition-all duration-100"
                style={{ height: `${h * 2.2}px`, background: filled ? (isMe ? "rgba(255,255,255,0.9)" : "#2563eb") : (isMe ? "rgba(255,255,255,0.3)" : "#cbd5e1") }} />
            );
          })}
        </div>
        <span className={`text-[10px] font-medium ${isMe ? "text-white/60" : "text-slate-400"}`}>
          {fmtDuration(cur)} / {fmtDuration(duration)}
        </span>
      </div>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ name = "?", size = 32, online }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center font-bold text-white"
        style={{ fontSize: size * 0.38, background: avatarColor(name) }}>
        {name.charAt(0).toUpperCase()}
      </div>
      {online && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, isMe, showName, showAv, myId, lastSeen, memberCount, onLongPress, onReact, onJumpTo }) {
  const timer = useRef(null);
  const moved = useRef(false);

  const startPress = () => { moved.current = false; timer.current = setTimeout(() => { if (!moved.current) onLongPress(msg); }, 460); };
  const endPress   = () => clearTimeout(timer.current);
  const onMove     = () => { clearTimeout(timer.current); };

  // Group reactions by emoji
  const reactions = useMemo(() => {
    const g = {};
    for (const r of (msg.reactions || [])) {
      if (!g[r.emoji]) g[r.emoji] = { emoji: r.emoji, count: 0, mine: false, names: [] };
      g[r.emoji].count++;
      g[r.emoji].names.push(r.user_name);
      if (r.user_id === myId) g[r.emoji].mine = true;
    }
    return Object.values(g);
  }, [msg.reactions, myId]);

  // Read status for my messages
  const readBy = useMemo(() => {
    if (!isMe || !lastSeen) return 0;
    return Object.entries(lastSeen).filter(([uid, ts]) =>
      uid !== myId && new Date(ts) >= new Date(msg.created_at)
    ).length;
  }, [isMe, lastSeen, myId, msg.created_at]);

  const isDeleted = msg.is_deleted;
  const isPending = msg._pending;

  if (msg.type === "system") {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="text-[11px] text-slate-500 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm font-medium">
          {msg.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-1.5 px-2 my-[2px] ${isMe ? "flex-row-reverse" : ""}`}>

      {/* Avatar slot */}
      {!isMe && (
        <div style={{ width: 30 }} className="flex-shrink-0 mb-1">
          {showAv ? <Av name={msg.sender_name} size={30} /> : null}
        </div>
      )}

      <div className={`flex flex-col max-w-[78%] ${isMe ? "items-end" : "items-start"}`}>

        {showName && !isMe && (
          <span className="text-[11px] font-extrabold mb-0.5 ml-0.5 flex items-center gap-1"
            style={{ color: avatarColor(msg.sender_name) }}>
            {msg.sender_name}
            {(msg.sender_role === "admin" || msg.sender_role === "org") && (
              <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold">ADMIN</span>
            )}
          </span>
        )}

        {/* Bubble */}
        <div
          id={`msg-${msg.id}`}
          onPointerDown={startPress} onPointerUp={endPress} onPointerMove={onMove}
          className={[
            "relative rounded-2xl px-3 py-2 shadow-sm select-none transition-colors",
            isMe
              ? `bg-[#1d4ed8] text-white rounded-br-[5px] ${isPending ? "opacity-70" : ""}`
              : "bg-white text-slate-800 rounded-bl-[5px]",
            isDeleted ? "opacity-50" : "",
          ].join(" ")}
          style={{ wordBreak: "break-word" }}>

          {/* Reply quote */}
          {msg.reply_to_id && !isDeleted && (
            <button onClick={() => onJumpTo(msg.reply_to_id)}
              className={`mb-2 pl-2.5 border-l-[3px] rounded text-left w-full transition-opacity hover:opacity-80
                ${isMe ? "border-white/50 bg-white/10" : "border-blue-500 bg-blue-50"}`}>
              <p className={`text-[10px] font-extrabold truncate ${isMe ? "text-white/80" : "text-blue-600"}`}>
                {msg.reply_to_sender}
              </p>
              <p className={`text-[11px] truncate ${isMe ? "text-white/65" : "text-slate-500"}`}>
                {msg.reply_to_content || "Message"}
              </p>
            </button>
          )}

          {/* Content */}
          {isDeleted ? (
            <p className={`text-sm italic flex items-center gap-1.5 ${isMe ? "text-white/50" : "text-slate-400"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 flex-shrink-0"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 6v4m0 4h.01"/></svg>
              This message was deleted
            </p>
          ) : msg.type === "image" ? (
            <div>
              <img src={msg.media_url} alt={msg.media_name || ""} loading="lazy"
                onClick={() => window.open(msg.media_url, "_blank")}
                className="rounded-xl max-w-[220px] max-h-[240px] object-cover cursor-zoom-in mb-0.5" />
              {msg.content && <p className="text-sm mt-1">{msg.content}</p>}
            </div>
          ) : msg.type === "audio" ? (
            <AudioPlayer url={msg.media_url} duration={msg.duration} isMe={isMe} />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          )}

          {/* Footer */}
          {!isDeleted && (
            <div className={`flex items-center gap-1 mt-0.5 ${isMe ? "justify-end" : "justify-end"}`}>
              {msg.is_edited && (
                <span className={`text-[9px] italic ${isMe ? "text-white/40" : "text-slate-400"}`}>edited</span>
              )}
              <span className={`text-[10px] ${isMe ? "text-white/55" : "text-slate-400"}`}>
                {fmtTime(msg.created_at)}
              </span>
              {isMe && !isPending && (
                <svg viewBox="0 0 18 13" fill="none" className="w-[18px] h-3 flex-shrink-0">
                  {readBy > 0 ? (
                    <>
                      <path d="M1 6.5L5.5 11L15 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 6.5L9.5 11" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round"/>
                    </>
                  ) : (
                    <>
                      <path d="M1 6.5L5.5 11L15 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 6.5L9.5 11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round"/>
                    </>
                  )}
                </svg>
              )}
              {isMe && isPending && (
                <svg viewBox="0 0 18 13" fill="none" className="w-[18px] h-3 flex-shrink-0">
                  <path d="M4 6.5L8.5 11L16 2" stroke="rgba(255,255,255,0.4)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
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
                className={`flex items-center gap-0.5 px-2 py-[3px] rounded-full text-xs border font-medium transition-all active:scale-90
                  ${r.mine ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-slate-200 text-slate-600"}`}>
                <span className="text-sm">{r.emoji}</span>
                {r.count > 1 && <span className="text-[10px]">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function CtxMenu({ msg, isMe, isAdmin, onClose, onAction }) {
  const items = [
    { id:"reply",   emoji:"↩️", label:"Reply" },
    !msg.is_deleted && { id:"copy",    emoji:"📋", label:"Copy text" },
    !msg.is_deleted && isMe && { id:"edit",    emoji:"✏️", label:"Edit" },
    !msg.is_deleted && (isMe || isAdmin) && { id:"delete",  emoji:"🗑️", label:"Delete for everyone", danger:true },
    isAdmin && { id:"pin",    emoji: msg.pinned ? "📌" : "📍", label: msg.pinned ? "Unpin" : "Pin" },
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden mb-0 sm:mb-0"
        onClick={e => e.stopPropagation()}>
        {/* Drag handle */}
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-2 sm:hidden" />
        {/* Quick emojis */}
        <div className="flex justify-around items-center px-4 py-3 border-b border-slate-100">
          {QUICK_EMOJIS.map(e => (
            <button key={e} onClick={() => { onAction("react", e); onClose(); }}
              className="text-2xl transition-transform active:scale-125 leading-none">{e}
            </button>
          ))}
        </div>
        {/* Actions */}
        {items.map(a => (
          <button key={a.id} onClick={() => { onAction(a.id); onClose(); }}
            className={`w-full flex items-center gap-3.5 px-5 py-4 text-left transition-colors active:bg-slate-50
              ${a.danger ? "text-red-500" : "text-slate-700"}`}>
            <span className="text-lg w-7 text-center">{a.emoji}</span>
            <span className="text-[15px] font-semibold">{a.label}</span>
          </button>
        ))}
        <div className="pb-safe h-2" />
      </div>
    </div>
  );
}

// ─── Full emoji grid ──────────────────────────────────────────────────────────
function EmojiGrid({ onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-2" />
        <div className="grid grid-cols-8 px-2 pb-6">
          {ALL_EMOJIS.map(e => (
            <button key={e} onClick={() => { onPick(e); onClose(); }}
              className="py-3 text-2xl active:scale-125 transition-transform text-center">{e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Settings Modal (admin only) ────────────────────────────────────────
function EditSettings({ orgId, settings, myId, onSave, onClose }) {
  const [form, setForm]   = useState({ chat_name: settings?.chat_name || "", description: settings?.description || "", rules: settings?.rules || "", emoji: settings?.emoji || "💬" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    await supabase.from("org_chat_settings").upsert(
      { org_id: orgId, ...form, updated_at: new Date().toISOString(), updated_by: myId },
      { onConflict: "org_id" }
    );
    onSave({ ...settings, ...form });
    setSaving(false);
    onClose();
  };

  const field = "w-full bg-slate-100 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div className="fixed inset-0 z-[130] flex justify-center items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />
        <div className="px-5 pt-2 pb-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">Edit Group Info</h3>
          <button onClick={onClose} className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Group Name</label>
            <input className={field} value={form.chat_name} onChange={e => setForm(p => ({ ...p, chat_name: e.target.value }))} placeholder="e.g. New Hope Savings 2025" />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Description</label>
            <textarea className={field} rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What is this group about?" />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Rules of Communication</label>
            <textarea className={`${field} leading-relaxed`} rows={5} value={form.rules} onChange={e => setForm(p => ({ ...p, rules: e.target.value }))} placeholder={"e.g.\n1. Be respectful\n2. No spam\n3. Finance topics only"} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group Info Sheet ─────────────────────────────────────────────────────────
function GroupInfo({ orgId, orgName, org, settings, members, onlineIds, lastSeen, isAdmin, myId, onClose, onEdit }) {
  const displayName = settings?.chat_name || `${orgName} Group`;
  const total       = members.length + 1;

  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: "88vh" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Group header */}
        <div className="flex flex-col items-center py-5 px-5 flex-shrink-0">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-3 shadow-lg"
            style={{ background: "linear-gradient(145deg,#1d4ed8,#1e3a8a)" }}>
            <span>{settings?.emoji || "💬"}</span>
          </div>
          <p className="text-lg font-extrabold text-slate-800 text-center">{displayName}</p>
          <p className="text-xs text-slate-400 mt-0.5">Group · {total} participant{total !== 1 ? "s" : ""}</p>
          {isAdmin && (
            <button onClick={onEdit}
              className="mt-3 px-4 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold rounded-full active:bg-blue-100">
              ✏️ Edit group info
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Description */}
          {settings?.description && (
            <div className="mx-4 mb-3 p-3.5 bg-slate-50 rounded-2xl">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">About</p>
              <p className="text-sm text-slate-600 leading-relaxed">{settings.description}</p>
            </div>
          )}

          {/* Rules */}
          {settings?.rules && (
            <div className="mx-4 mb-4 p-3.5 bg-amber-50 border border-amber-100 rounded-2xl">
              <p className="text-[10px] font-extrabold text-amber-600 uppercase tracking-wider mb-1">📋 Rules</p>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{settings.rules}</p>
            </div>
          )}

          {/* Members */}
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.18em] px-5 pb-2">
            {total} Participants
          </p>

          {/* Admin row */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Av name={org?.owner_name || orgName} size={44} online />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-slate-800 truncate">{org?.owner_name || orgName}</p>
              <p className="text-[11px] text-blue-500 font-semibold">Admin · online</p>
            </div>
          </div>

          {members.map(m => {
            const online = onlineIds.includes(m.user_id);
            const seen   = lastSeen[m.user_id];
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Av name={m.full_name} size={44} online={online} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-slate-800 truncate">{m.full_name}</p>
                  <p className={`text-[11px] font-medium ${online ? "text-green-500" : "text-slate-400"}`}>
                    {online ? "online" : `last seen ${fmtRelTime(seen)}`}
                  </p>
                </div>
              </div>
            );
          })}
          <div className="h-4" />
        </div>

        <div className="px-4 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-3 bg-slate-100 rounded-2xl text-sm font-bold text-slate-600 active:bg-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Typing dots ──────────────────────────────────────────────────────────────
function TypingDots({ users }) {
  if (!users.length) return null;
  return (
    <div className="flex items-end gap-1.5 px-3 pb-2">
      <Av name={users[0]} size={26} />
      <div className="bg-white rounded-2xl rounded-bl-[4px] px-3.5 py-3 shadow-sm">
        <div className="flex gap-1 items-center">
          {[0,160,320].map(d => (
            <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main GroupChat ───────────────────────────────────────────────────────────
export default function GroupChat({ orgId, myName, myRole = "member", orgName, org, onBack }) {
  const [myId,         setMyId]         = useState(null);
  const [messages,     setMessages]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [hasMore,      setHasMore]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [members,      setMembers]      = useState([]);
  const [onlineIds,    setOnlineIds]    = useState([]);
  const [typingUsers,  setTypingUsers]  = useState([]);
  const [lastSeen,     setLastSeen]     = useState({});
  const [settings,     setSettings]     = useState(null);
  const [text,         setText]         = useState("");
  const [replyTo,      setReplyTo]      = useState(null);
  const [editMsg,      setEditMsg]      = useState(null);
  const [ctxMsg,       setCtxMsg]       = useState(null);
  const [pinnedMsg,    setPinnedMsg]    = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [recording,    setRecording]    = useState(false);
  const [recSecs,      setRecSecs]      = useState(0);
  const [sending,      setSending]      = useState(false);
  const [showInfo,     setShowInfo]     = useState(false);
  const [editSettings, setEditSettings] = useState(false);
  const [showSearch,   setShowSearch]   = useState(false);
  const [searchQ,      setSearchQ]      = useState("");
  const [showScrollBtn,setShowScrollBtn]= useState(false);
  const [unread,       setUnread]       = useState(0);

  const listRef     = useRef(null);
  const bottomRef   = useRef(null);
  const inputRef    = useRef(null);
  const fileRef     = useRef(null);
  const myIdRef     = useRef(null);
  const channelRef  = useRef(null);
  const recRef      = useRef(null);
  const audioChunks = useRef([]);
  const recTimer    = useRef(null);
  const recDur      = useRef(0);
  const typingTimer = useRef(null);
  const atBottom    = useRef(true);
  const oldestTs    = useRef(null);

  const isAdmin = myRole === "admin" || myRole === "org";

  // ── Auth ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      myIdRef.current = uid;
      setMyId(uid);
    });
  }, []);

  // ── Initial data load ──────────────────────────────────────────────────────
  const fetchPage = useCallback(async (before = null) => {
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

    Promise.all([
      fetchPage(),
      supabase.from("org_members").select("id,full_name,user_id,role,status").eq("org_id", orgId).eq("status", "active"),
      supabase.from("org_chat_settings").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("org_chat_reads").select("user_id,last_read_at").eq("org_id", orgId),
    ]).then(([msgs, memR, setR, readsR]) => {
      setMessages(msgs);
      if (msgs.length > 0) oldestTs.current = msgs[0].created_at;
      if (msgs.length < PAGE_SIZE) setHasMore(false);
      setMembers(memR.data || []);
      setSettings(setR.data || null);
      const seen = {};
      for (const r of (readsR.data || [])) seen[r.user_id] = r.last_read_at;
      setLastSeen(seen);
      const pinned = [...msgs].reverse().find(m => m.pinned && !m.is_deleted);
      if (pinned) setPinnedMsg(pinned);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView(), 80);
    });
  }, [orgId, fetchPage]);

  // ── Mark read ─────────────────────────────────────────────────────────────
  const markRead = useCallback(() => {
    const uid = myIdRef.current;
    if (!uid || !orgId) return;
    const now = new Date().toISOString();
    supabase.from("org_chat_reads")
      .upsert({ user_id: uid, org_id: orgId, last_read_at: now }, { onConflict: "user_id,org_id" });
    setLastSeen(p => ({ ...p, [uid]: now }));
  }, [orgId]);

  useEffect(() => { if (myId) markRead(); }, [myId, markRead]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;

    const ch = supabase.channel(`gc-${orgId}`, { config: { presence: { key: myIdRef.current || "anon" } } });
    channelRef.current = ch;

    ch
      // New message
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "org_group_messages", filter: `org_id=eq.${orgId}` }, ({ new: m }) => {
        setMessages(prev => {
          // If we have a pending temp with same content + sender, replace it
          const tempIdx = prev.findIndex(x => x._pending && x.sender_id === m.sender_id && x.content === m.content);
          if (tempIdx >= 0) {
            const next = [...prev];
            next[tempIdx] = { ...m, reactions: [] };
            return next;
          }
          // Already have it by id?
          if (prev.find(x => x.id === m.id)) return prev;
          // New message from someone else
          if (atBottom.current) {
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
            markRead();
          } else {
            setUnread(c => c + 1);
          }
          return [...prev, { ...m, reactions: [] }];
        });
      })
      // Edit / delete / pin
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "org_group_messages", filter: `org_id=eq.${orgId}` }, ({ new: m }) => {
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...m } : x));
        if (m.pinned && !m.is_deleted) setPinnedMsg(m);
        if (!m.pinned) setPinnedMsg(p => p?.id === m.id ? null : p);
      })
      // Reaction added
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "org_message_reactions", filter: `org_id=eq.${orgId}` }, ({ new: r }) => {
        setMessages(prev => prev.map(m =>
          m.id === r.message_id
            ? { ...m, reactions: [...(m.reactions || []).filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji)), r] }
            : m
        ));
      })
      // Reaction removed
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "org_message_reactions" }, ({ old: r }) => {
        setMessages(prev => prev.map(m =>
          m.id === r.message_id ? { ...m, reactions: (m.reactions || []).filter(x => x.id !== r.id) } : m
        ));
      })
      // Read receipts
      .on("postgres_changes", { event: "*", schema: "public", table: "org_chat_reads", filter: `org_id=eq.${orgId}` }, ({ new: r }) => {
        if (r) setLastSeen(p => ({ ...p, [r.user_id]: r.last_read_at }));
      })
      // Presence (typing + online)
      .on("presence", { event: "sync" }, () => {
        const state  = ch.presenceState();
        const users  = Object.values(state).flat();
        setOnlineIds(users.map(u => u.user_id).filter(Boolean));
        setTypingUsers(users.filter(u => u.typing && u.user_id !== myIdRef.current).map(u => u.user_name));
      })
      .subscribe(async status => {
        if (status === "SUBSCRIBED" && myIdRef.current) {
          await ch.track({ user_id: myIdRef.current, user_name: myName, typing: false, role: myRole });
        }
      });

    return () => { supabase.removeChannel(ch); };
  }, [orgId, myName, myRole, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load more ─────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestTs.current) return;
    setLoadingMore(true);
    const el    = listRef.current;
    const prevH = el?.scrollHeight || 0;
    const msgs  = await fetchPage(oldestTs.current);
    if (msgs.length > 0) {
      oldestTs.current = msgs[0].created_at;
      setMessages(prev => [...msgs, ...prev]);
      setTimeout(() => { if (el) el.scrollTop = el.scrollHeight - prevH; }, 0);
    }
    if (msgs.length < PAGE_SIZE) setHasMore(false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, fetchPage]);

  // ── Scroll detection ──────────────────────────────────────────────────────
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = bottom;
    setShowScrollBtn(!bottom);
    if (bottom) { setUnread(0); markRead(); }
    if (el.scrollTop < 80 && hasMore && !loadingMore) loadMore();
  }, [hasMore, loadingMore, loadMore, markRead]);

  // ── Typing signal ─────────────────────────────────────────────────────────
  const signalTyping = useCallback((on) => {
    if (myIdRef.current)
      channelRef.current?.track({ user_id: myIdRef.current, user_name: myName, typing: on, role: myRole });
  }, [myName, myRole]);

  const onTextChange = e => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 112) + "px";
    signalTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => signalTyping(false), 2000);
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMsg = useCallback(async (overrides = {}) => {
    const uid     = myIdRef.current;
    if (!uid) return;
    const content = (overrides.content ?? text).trim();
    if (!content && !overrides.media_url) return;

    clearTimeout(typingTimer.current);
    signalTyping(false);

    const replySnap   = replyTo;
    const replyContent = replySnap
      ? (replySnap.type === "audio" ? "[🎤 Voice]" : replySnap.type === "image" ? "[📷 Photo]" : replySnap.content?.slice(0, 100))
      : null;

    // Optimistic message
    const tempId  = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId, org_id: orgId, sender_id: uid, sender_name: myName, sender_role: myRole,
      content: content || null, type: overrides.type || "text",
      media_url: overrides.media_url || null, media_name: overrides.media_name || null,
      duration: overrides.duration || null,
      reply_to_id: replySnap?.id || null, reply_to_content: replyContent, reply_to_sender: replySnap?.sender_name || null,
      reactions: [], created_at: new Date().toISOString(), _pending: true,
    };

    setMessages(prev => [...prev, optimistic]);
    setText("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    setReplyTo(null);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 40);

    const { data, error } = await supabase.from("org_group_messages").insert({
      org_id: orgId, sender_id: uid, sender_name: myName, sender_role: myRole,
      content: content || null, type: overrides.type || "text",
      media_url: overrides.media_url || null, media_name: overrides.media_name || null,
      media_mime: overrides.media_mime || null, duration: overrides.duration || null,
      reply_to_id: replySnap?.id || null, reply_to_content: replyContent, reply_to_sender: replySnap?.sender_name || null,
    }).select("*").single();

    if (data) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...data, reactions: [] } : m));
    } else {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      console.error("Send failed:", error);
    }
  }, [text, replyTo, orgId, myName, myRole, signalTyping]);

  // ── Upload media ──────────────────────────────────────────────────────────
  const upload = useCallback(async (file) => {
    const uid  = myIdRef.current;
    const ext  = file.name.split(".").pop() || "bin";
    const path = `${orgId}/${uid}/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return publicUrl;
  }, [orgId]);

  const onPickImage = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setMediaPreview({ file, url: URL.createObjectURL(file) });
  };

  const sendImage = async () => {
    if (!mediaPreview) return;
    setSending(true);
    try {
      const url = await upload(mediaPreview.file);
      await sendMsg({ type: "image", media_url: url, media_name: mediaPreview.file.name, media_mime: mediaPreview.file.type, content: text });
      setMediaPreview(null);
    } catch (e) { console.error(e); }
    setSending(false);
  };

  // ── Voice recording ───────────────────────────────────────────────────────
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec    = new MediaRecorder(stream);
      audioChunks.current = [];
      recDur.current      = 0;
      rec.ondataavailable = e => audioChunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        try {
          const url = await upload(file);
          await sendMsg({ type: "audio", media_url: url, media_name: file.name, duration: recDur.current });
        } catch {}
        setRecSecs(0);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      recTimer.current = setInterval(() => setRecSecs(s => { recDur.current = s + 1; return s + 1; }), 1000);
    } catch {}
  };

  const stopRec = () => {
    clearInterval(recTimer.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
    setRecording(false);
  };

  const cancelRec = () => {
    clearInterval(recTimer.current);
    if (recRef.current) { recRef.current.onstop = null; recRef.current.stop(); }
    setRecording(false);
    setRecSecs(0);
  };

  // ── Context actions ───────────────────────────────────────────────────────
  const doAction = useCallback(async (action, msg, extra) => {
    const uid = myIdRef.current;
    if (action === "reply") {
      setReplyTo(msg); setEditMsg(null);
      setTimeout(() => inputRef.current?.focus(), 80);
    } else if (action === "react") {
      const emoji    = extra;
      const existing = (msg.reactions || []).find(r => r.user_id === uid && r.emoji === emoji);
      if (existing) await supabase.from("org_message_reactions").delete().eq("id", existing.id);
      else          await supabase.from("org_message_reactions").insert({ message_id: msg.id, org_id: orgId, user_id: uid, user_name: myName, emoji });
    } else if (action === "copy") {
      navigator.clipboard?.writeText(msg.content || "");
    } else if (action === "edit") {
      setEditMsg(msg); setReplyTo(null); setText(msg.content || "");
      setTimeout(() => inputRef.current?.focus(), 80);
    } else if (action === "delete") {
      await supabase.from("org_group_messages").update({ is_deleted: true, content: null, media_url: null }).eq("id", msg.id);
    } else if (action === "pin") {
      await supabase.from("org_group_messages").update({ pinned: !msg.pinned }).eq("id", msg.id);
    }
  }, [orgId, myName]);

  const submitEdit = async () => {
    if (!editMsg || !text.trim()) return;
    await supabase.from("org_group_messages")
      .update({ content: text.trim(), is_edited: true, edited_at: new Date().toISOString() })
      .eq("id", editMsg.id);
    setEditMsg(null);
    setText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const jumpTo = id => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "background-color 0.15s";
    el.style.backgroundColor = "#fef08a";
    setTimeout(() => { el.style.backgroundColor = ""; el.style.transition = ""; }, 1200);
  };

  // ── Filtered display ──────────────────────────────────────────────────────
  const displayMsgs = useMemo(() => {
    if (!searchQ.trim()) return messages;
    const q = searchQ.toLowerCase();
    return messages.filter(m => m.content?.toLowerCase().includes(q) || m.sender_name?.toLowerCase().includes(q));
  }, [messages, searchQ]);

  const displayName = settings?.chat_name || `${orgName} Group`;
  const canSend     = text.trim().length > 0 || !!mediaPreview;

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 z-[80] bg-[#e8edf2] flex items-center justify-center">
      <div className="w-9 h-9 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-[#e8edf2]">
      <div className="w-full max-w-md flex flex-col h-full">

        {/* ── Header ── */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5"
          style={{ background: "linear-gradient(135deg,#1e40af,#1d4ed8)", paddingTop: "max(10px,env(safe-area-inset-top))" }}>
          <button onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 transition-colors flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>

          <button onClick={() => setShowInfo(true)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0 bg-white/15">
              {settings?.emoji || "💬"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold text-white truncate leading-tight">{displayName}</p>
              <p className="text-[10px] text-blue-200 truncate">
                {typingUsers.length > 0
                  ? `${typingUsers.slice(0, 2).join(", ")} typing…`
                  : `${members.length + 1} members · ${onlineIds.length} online`}
              </p>
            </div>
          </button>

          <button onClick={() => { setShowSearch(s => !s); setSearchQ(""); }}
            className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
        </div>

        {/* ── Search ── */}
        {showSearch && (
          <div className="flex-shrink-0 px-3 py-2 bg-[#1d4ed8]">
            <div className="flex items-center gap-2 bg-white/20 rounded-xl px-3 py-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} autoFocus
                placeholder="Search messages…"
                className="flex-1 bg-transparent text-white placeholder-white/60 text-sm outline-none" />
              {searchQ && (
                <button onClick={() => setSearchQ("")} className="text-white/60">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Pinned banner ── */}
        {pinnedMsg && !pinnedMsg.is_deleted && !showSearch && (
          <button onClick={() => jumpTo(pinnedMsg.id)}
            className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-white/80 backdrop-blur-sm border-b border-slate-200 text-left">
            <div className="w-0.5 h-8 bg-blue-500 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider">📌 Pinned</p>
              <p className="text-xs text-slate-700 truncate font-medium">
                {pinnedMsg.type === "audio" ? "🎤 Voice message" : pinnedMsg.type === "image" ? "📷 Photo" : pinnedMsg.content}
              </p>
            </div>
          </button>
        )}

        {/* ── Messages ── */}
        <div ref={listRef} onScroll={onScroll}
          className="flex-1 overflow-y-auto overscroll-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23e8edf2'/%3E%3Ccircle cx='40' cy='40' r='1' fill='%23d1d8e0' opacity='0.6'/%3E%3C/svg%3E\")" }}>

          {loadingMore && (
            <div className="flex justify-center py-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {hasMore && !loadingMore && (
            <div className="flex justify-center pt-2 pb-1">
              <button onClick={loadMore}
                className="text-xs text-blue-600 font-bold bg-white/90 px-4 py-1.5 rounded-full shadow-sm active:bg-blue-50">
                Load earlier
              </button>
            </div>
          )}

          {displayMsgs.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
              <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-4xl mb-4 shadow-sm">
                {settings?.emoji || "💬"}
              </div>
              <p className="text-base font-extrabold text-slate-700 mb-1">
                {searchQ ? "No results" : `Welcome to ${displayName}!`}
              </p>
              <p className="text-sm text-slate-400">
                {searchQ ? "Try a different term" : "Send the first message to get the conversation going"}
              </p>
            </div>
          )}

          <div className="pt-2 pb-2">
            {displayMsgs.map((msg, i) => {
              const prev    = displayMsgs[i - 1];
              const next    = displayMsgs[i + 1];
              const dateSep = !prev || !isSameDay(msg.created_at, prev.created_at);
              const isMe    = msg.sender_id === (myIdRef.current || myId);
              const grouped = !!prev && prev.sender_id === msg.sender_id && !dateSep
                              && (new Date(msg.created_at) - new Date(prev.created_at)) < 90000;
              const showAv  = !next || next.sender_id !== msg.sender_id || !isSameDay(msg.created_at, next?.created_at || "");
              return (
                <div key={msg.id}>
                  {dateSep && (
                    <div className="flex justify-center my-3">
                      <span className="text-[11px] font-semibold text-slate-500 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm">
                        {fmtDateSep(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <Bubble
                    msg={msg} isMe={isMe} showName={!grouped} showAv={showAv}
                    myId={myIdRef.current || myId} lastSeen={lastSeen} memberCount={members.length}
                    onLongPress={m => setCtxMsg(m)}
                    onReact={(m, e) => doAction("react", m, e)}
                    onJumpTo={jumpTo}
                  />
                </div>
              );
            })}
          </div>

          <TypingDots users={typingUsers} />
          <div ref={bottomRef} className="h-2" />
        </div>

        {/* ── Scroll FAB ── */}
        {showScrollBtn && (
          <button onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setUnread(0); }}
            className="absolute right-4 bottom-[76px] z-10 w-10 h-10 bg-white rounded-full shadow-xl flex items-center justify-center border border-slate-200">
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4">
              <path d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
        )}

        {/* ── Image preview ── */}
        {mediaPreview && (
          <div className="flex-shrink-0 bg-white border-t border-slate-200 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <img src={mediaPreview.url} alt="" className="w-16 h-16 object-cover rounded-xl flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 truncate">{mediaPreview.file.name}</p>
                <p className="text-[10px] text-slate-400">{(mediaPreview.file.size / 1024).toFixed(0)} KB</p>
                <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a caption…"
                  className="mt-1 w-full bg-slate-100 rounded-lg px-2 py-1 text-xs text-slate-800 outline-none" />
              </div>
              <button onClick={() => setMediaPreview(null)} className="text-slate-400 flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Reply banner ── */}
        {replyTo && !mediaPreview && (
          <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-white border-t border-slate-200">
            <div className="w-0.5 h-8 bg-blue-500 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-extrabold text-blue-600">{replyTo.sender_name}</p>
              <p className="text-xs text-slate-500 truncate">
                {replyTo.type === "audio" ? "🎤 Voice" : replyTo.type === "image" ? "📷 Photo" : replyTo.content?.slice(0, 60)}
              </p>
            </div>
            <button onClick={() => setReplyTo(null)} className="text-slate-400 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}

        {/* ── Edit banner ── */}
        {editMsg && (
          <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-amber-50 border-t border-amber-200">
            <div className="w-0.5 h-8 bg-amber-500 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-extrabold text-amber-600">Editing</p>
              <p className="text-xs text-slate-500 truncate">{editMsg.content?.slice(0, 60)}</p>
            </div>
            <button onClick={() => { setEditMsg(null); setText(""); if (inputRef.current) inputRef.current.style.height = "auto"; }}
              className="text-slate-400 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}

        {/* ── Input bar ── */}
        <div className="flex-shrink-0 bg-[#f0f2f5] border-t border-slate-200 px-2.5 pt-2"
          style={{ paddingBottom: "max(8px,env(safe-area-inset-bottom))" }}>
          {recording ? (
            <div className="flex items-center gap-2 pb-1">
              <button onClick={cancelRec}
                className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
              <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 flex items-center gap-2 shadow-sm">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-sm font-bold text-red-500">{fmtDuration(recSecs)}</span>
                <span className="text-xs text-slate-400">Recording…</span>
              </div>
              <button onClick={stopRec}
                className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-md active:scale-90 transition-transform">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              {!mediaPreview && (
                <button onClick={() => fileRef.current?.click()}
                  className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm active:bg-slate-100 flex-shrink-0 mb-0.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />

              <div className="flex-1 bg-white rounded-[20px] shadow-sm flex items-end px-3.5 py-2.5 gap-2 min-h-[42px]">
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
                  className="flex-1 bg-transparent text-[15px] text-slate-800 placeholder-slate-400 outline-none resize-none leading-[1.4] w-full"
                  style={{ minHeight: "22px", maxHeight: "112px" }}
                />
              </div>

              {canSend || editMsg ? (
                <button onClick={() => editMsg ? submitEdit() : mediaPreview ? sendImage() : sendMsg()}
                  disabled={sending}
                  className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 disabled:opacity-50 active:scale-90 transition-transform">
                  {sending
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : editMsg
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M5 12l5 5L20 7"/></svg>
                    : <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 -rotate-45 translate-x-0.5"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>}
                </button>
              ) : (
                <button onClick={startRec}
                  className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 active:scale-90 transition-transform">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Context menu ── */}
      {ctxMsg && (
        <CtxMenu
          msg={ctxMsg}
          isMe={ctxMsg.sender_id === (myIdRef.current || myId)}
          isAdmin={isAdmin}
          onClose={() => setCtxMsg(null)}
          onAction={(a, e) => doAction(a, ctxMsg, e)}
        />
      )}

      {/* ── Group info sheet ── */}
      {showInfo && (
        <GroupInfo
          orgId={orgId} orgName={orgName} org={org} settings={settings}
          members={members} onlineIds={onlineIds} lastSeen={lastSeen}
          isAdmin={isAdmin} myId={myIdRef.current || myId}
          onClose={() => setShowInfo(false)}
          onEdit={() => { setShowInfo(false); setEditSettings(true); }}
        />
      )}

      {/* ── Edit settings (admin) ── */}
      {editSettings && (
        <EditSettings
          orgId={orgId} settings={settings} myId={myIdRef.current || myId}
          onSave={s => setSettings(s)}
          onClose={() => setEditSettings(false)}
        />
      )}
    </div>
  );
}
