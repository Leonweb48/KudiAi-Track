import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";
import GroupInfoPage from "./community/GroupInfoPage";

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ["👍","❤️","😂","😮","😢","🙏","🔥","👏","🎉","💯"];
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


const avatarColor = (name = "") => {
  const p = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return p[Math.abs(h) % p.length];
};

// Detect best supported recording MIME type (webm for Chrome, mp4 for Safari/iOS)
const getBestMime = () => {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg", ""];
  return candidates.find(t => !t || MediaRecorder.isTypeSupported(t)) ?? "";
};
const mimeToExt = mime => {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("mpeg")) return "mp4";
  return "webm";
};

// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ url, duration, isMe }) {
  const [playing, setPlaying] = useState(false);
  const [cur,     setCur]     = useState(0);
  const [dur,     setDur]     = useState(duration || 0);
  const [errored, setErrored] = useState(false);
  const audioRef              = useRef(null);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a || errored) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      // Mobile browsers (iOS especially) need load() called before play()
      // when preload="none" is set or the src was set after mount
      if (a.readyState < 2) a.load();
      try {
        await a.play();
        setPlaying(true);
      } catch {
        setErrored(true);
        setPlaying(false);
      }
    }
  };

  const pct  = Math.min(((cur || 0) / (dur || 1)) * 100, 100);
  const BARS = [2,4,7,5,8,3,6,9,4,7,5,3,8,6,4,5,9,3,7,5,4,6,3,5];

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] py-0.5">
      {/* src set directly (no <source type>) so iOS Safari doesn't reject unknown MIME types */}
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        playsInline
        crossOrigin="anonymous"
        onEnded={() => { setPlaying(false); setCur(0); }}
        onTimeUpdate={e => setCur(e.target.currentTime)}
        onLoadedMetadata={e => { if (e.target.duration && isFinite(e.target.duration)) setDur(e.target.duration); }}
        onError={() => { setPlaying(false); setErrored(true); }}
        style={{ display: "none" }}
      />
      <button onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-90
          ${errored ? "opacity-50 cursor-not-allowed" : ""}
          ${isMe ? "bg-[#25d366]/25 hover:bg-[#25d366]/35" : "bg-blue-100 hover:bg-blue-200"}`}>
        {errored
          ? <svg viewBox="0 0 24 24" fill="none" stroke={isMe ? "#128c7e" : "#dc2626"} strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          : playing
            ? <svg viewBox="0 0 24 24" fill={isMe ? "#128c7e" : "#2563eb"} className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg viewBox="0 0 24 24" fill={isMe ? "#128c7e" : "#2563eb"} className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-[2px] h-6">
          {BARS.map((h, i) => {
            const filled = (i / BARS.length) * 100 <= pct;
            return (
              <div key={i} className="w-[2.5px] rounded-full flex-shrink-0 transition-all duration-100"
                style={{ height: `${h * 2.2}px`, background: filled ? (isMe ? "#128c7e" : "#2563eb") : (isMe ? "#b7d4b5" : "#cbd5e1") }} />
            );
          })}
        </div>
        <span className={`text-[10px] font-medium ${isMe ? "text-[#128c7e]" : "text-slate-400"}`}>
          {fmtDuration(cur)} / {fmtDuration(dur)}
        </span>
      </div>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ name = "?", size = 32, online, url }) {
  const [imgErr, setImgErr] = useState(false);
  const showImg = url && !imgErr;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {showImg
        ? <img src={url} alt={name} className="w-full h-full rounded-full object-cover"
            onError={() => setImgErr(true)} />
        : <div className="w-full h-full rounded-full flex items-center justify-center font-bold text-white"
            style={{ fontSize: size * 0.38, background: avatarColor(name) }}>
            {name.charAt(0).toUpperCase()}
          </div>
      }
      {online && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
      )}
    </div>
  );
}

// ─── Sender Profile Sheet ─────────────────────────────────────────────────────
function SenderProfile({ member, org, isAdmin, onClose }) {
  const [savings, setSavings] = useState(null);
  const [loan,    setLoan]    = useState(null);

  const isOrgUser = member.role === "admin" || member.role === "org";
  const fmt = d => d ? new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";

  useEffect(() => {
    if (!member.id || !isAdmin || isOrgUser) return;
    supabase.from("org_savings").select("amount").eq("member_id", member.id)
      .then(({ data }) => {
        if (data?.length) setSavings(data.reduce((s, r) => s + (Number(r.amount) || 0), 0));
      });
    supabase.from("org_loans").select("amount_requested, status").eq("member_id", member.id)
      .then(({ data }) => {
        if (!data) return;
        const active = data.find(l => !["repaid", "rejected", "paid", "closed"].includes(l.status));
        if (active) setLoan(active);
      });
  }, [member.id, isAdmin, isOrgUser]);

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3" />

        {/* Gradient header */}
        <div className="flex flex-col items-center pt-5 pb-5 px-5"
          style={{ background: isOrgUser
            ? "linear-gradient(135deg,#064e3b 0%,#128c7e 100%)"
            : "linear-gradient(135deg,#1e40af 0%,#3b82f6 100%)" }}>
          <Av name={member.full_name || "?"} size={80} url={member.avatar_url} />
          <p className="text-[18px] font-extrabold text-white mt-3 text-center leading-tight">
            {member.full_name}
          </p>
          <span className="mt-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-white/20 text-white">
            {isOrgUser ? "GROUP ADMIN" : "MEMBER"}
          </span>
          {isOrgUser && org?.name && (
            <p className="text-[12px] text-white/65 mt-1 text-center">{org.name}</p>
          )}
        </div>

        {/* Details */}
        <div className="px-5 py-4 flex flex-col gap-2.5">
          {/* Phone */}
          {(member.phone || (isOrgUser && org?.phone)) && (
            <a href={`tel:${member.phone || org?.phone}`}
              className="flex items-center gap-3.5 bg-slate-50 rounded-2xl px-4 py-3 active:bg-slate-100">
              <div className="w-9 h-9 rounded-full bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="#128c7e" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 .95h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                </svg>
              </div>
              <span className="text-[14px] font-semibold text-[#128c7e]">{member.phone || org?.phone}</span>
            </a>
          )}

          {/* Joined date */}
          {member.joined_date && !isOrgUser && (
            <div className="flex items-center gap-3.5 bg-slate-50 rounded-2xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Member since</p>
                <p className="text-[13px] font-semibold text-slate-700">{fmt(member.joined_date)}</p>
              </div>
            </div>
          )}

          {/* Org email */}
          {isOrgUser && org?.email && (
            <a href={`mailto:${org.email}`}
              className="flex items-center gap-3.5 bg-slate-50 rounded-2xl px-4 py-3 active:bg-slate-100">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <span className="text-[14px] font-semibold text-slate-700 truncate">{org.email}</span>
            </a>
          )}

          {/* Savings (admin viewing member) */}
          {savings !== null && (
            <div className="flex items-center gap-3.5 bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="#128c7e" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Total Savings</p>
                <p className="text-[15px] font-extrabold text-[#128c7e]">₦{savings.toLocaleString()}</p>
              </div>
            </div>
          )}

          {/* Active loan (admin viewing member) */}
          {loan && (
            <div className="flex items-center gap-3.5 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                  <path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/>
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Active Loan</p>
                <p className="text-[15px] font-extrabold text-amber-600">₦{(loan.amount_requested || 0).toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-8">
          <button onClick={onClose}
            className="w-full py-3.5 bg-slate-100 rounded-2xl text-[14px] font-bold text-slate-600 active:bg-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, isMe, showName, showAv, myId, lastSeen, memberCount, avatarUrl, onLongPress, onReact, onJumpTo, onAvatarTap }) {
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

      {/* Avatar slot — tappable to view sender profile */}
      {!isMe && (
        <div style={{ width: 30 }} className="flex-shrink-0 mb-1">
          {showAv
            ? <button onClick={() => onAvatarTap?.(msg)} className="active:scale-90 transition-transform block">
                <Av name={msg.sender_name} size={30} url={avatarUrl} />
              </button>
            : null}
        </div>
      )}

      <div className={`flex flex-col max-w-[78%] ${isMe ? "items-end" : "items-start"}`}>

        {showName && !isMe && (
          <button onClick={() => onAvatarTap?.(msg)}
            className="text-[11px] font-extrabold mb-0.5 ml-0.5 flex items-center gap-1 text-left active:opacity-70">
            <span style={{ color: avatarColor(msg.sender_name) }}>{msg.sender_name}</span>
            {(msg.sender_role === "admin" || msg.sender_role === "org") && (
              <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold">ADMIN</span>
            )}
          </button>
        )}

        {/* Bubble */}
        <div
          id={`msg-${msg.id}`}
          onPointerDown={startPress} onPointerUp={endPress} onPointerMove={onMove}
          className={[
            `relative rounded-2xl shadow-sm select-none transition-colors ${(msg.type==="poll"||msg.type==="event")?"overflow-hidden":"px-3 py-2"}`,
            isMe
              ? `${(msg.type==="poll"||msg.type==="event")?"":"bg-[#dcf8c6] text-[#111b21]"} rounded-br-[5px] ${isPending ? "opacity-70" : ""}`
              : `${(msg.type==="poll"||msg.type==="event")?"":"bg-white text-slate-800"} rounded-bl-[5px]`,
            isDeleted ? "opacity-50" : "",
          ].join(" ")}
          style={{ wordBreak: "break-word" }}>

          {/* Reply quote */}
          {msg.reply_to_id && !isDeleted && (
            <button onClick={() => onJumpTo(msg.reply_to_id)}
              className={`mb-2 pl-2.5 border-l-[3px] rounded text-left w-full transition-opacity hover:opacity-80
                ${isMe ? "border-[#25d366]/70 bg-[#25d366]/15" : "border-blue-500 bg-blue-50"}`}>
              <p className={`text-[10px] font-extrabold truncate ${isMe ? "text-[#128c7e]" : "text-blue-600"}`}>
                {msg.reply_to_sender}
              </p>
              <p className={`text-[11px] truncate ${isMe ? "text-[#111b21]/65" : "text-slate-500"}`}>
                {msg.reply_to_content || "Message"}
              </p>
            </button>
          )}

          {/* Content */}
          {isDeleted ? (
            <p className={`text-sm italic flex items-center gap-1.5 ${isMe ? "text-[#111b21]/50" : "text-slate-400"}`}>
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
            <AudioPlayer url={msg.media_url} duration={msg.duration} isMe={isMe} mime={msg.media_mime} />
          ) : msg.type === "poll" ? (
            <PollBubble pollId={msg.media_name} myId={myId} isMe={isMe} />
          ) : msg.type === "event" ? (
            <EventBubble eventId={msg.media_name} myId={myId} isMe={isMe} />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          )}

          {/* Footer */}
          {!isDeleted && (
            <div className={`flex items-center gap-1 mt-0.5 justify-end`}>
              {msg.pinned && (
                <span className="text-[10px] opacity-60">📌</span>
              )}
              {msg.is_edited && (
                <span className={`text-[9px] italic ${isMe ? "text-[#111b21]/40" : "text-slate-400"}`}>edited</span>
              )}
              <span className={`text-[10px] ${isMe ? "text-[#111b21]/55" : "text-slate-400"}`}>
                {fmtTime(msg.created_at)}
              </span>
              {isMe && !isPending && (
                <svg viewBox="0 0 18 13" fill="none" className="w-[18px] h-3 flex-shrink-0">
                  {readBy > 0 ? (
                    <>
                      <path d="M1 6.5L5.5 11L15 2" stroke="#34b7f1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 6.5L9.5 11" stroke="#34b7f1" strokeWidth="1.7" strokeLinecap="round"/>
                    </>
                  ) : (
                    <>
                      <path d="M1 6.5L5.5 11L15 2" stroke="#8e9cad" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 6.5L9.5 11" stroke="#8e9cad" strokeWidth="1.7" strokeLinecap="round"/>
                    </>
                  )}
                </svg>
              )}
              {isMe && isPending && (
                <svg viewBox="0 0 18 13" fill="none" className="w-[18px] h-3 flex-shrink-0">
                  <path d="M4 6.5L8.5 11L16 2" stroke="#8e9cad" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
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
  const ageS = (Date.now() - new Date(msg.created_at).getTime()) / 1000;
  const withinMin = ageS < 60;
  const items = [
    { id:"reply",   emoji:"↩️", label:"Reply" },
    !msg.is_deleted && { id:"copy",    emoji:"📋", label:"Copy text" },
    !msg.is_deleted && isMe && withinMin && { id:"edit",    emoji:"✏️", label:"Edit" },
    !msg.is_deleted && ((isMe && withinMin) || isAdmin) && { id:"delete",  emoji:"🗑️", label:"Delete for everyone", danger:true },
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
          <button onClick={submit} disabled={saving} className="flex-1 py-3 bg-[#128c7e] text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}



// ─── Header menu (Twitter/X style) ───────────────────────────────────────────
function ChatHeaderMenu({ isAdmin, onGroupInfo, onSearch, onEditGroup, onClose }) {
  const items = [
    { label: "Group info", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", onClick: onGroupInfo },
    { label: "Search",     icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",                onClick: onSearch    },
    isAdmin ? { label: "Edit group", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", onClick: onEditGroup } : null,
  ].filter(Boolean);
  return (
    <div className="fixed inset-0 z-[91]" onClick={onClose}>
      <div
        className="absolute right-2 bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ top: "max(52px,calc(env(safe-area-inset-top) + 52px))", minWidth: 192 }}
        onClick={e => e.stopPropagation()}
      >
        {items.map((item, i) => (
          <button key={item.label}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:bg-slate-50 transition-colors ${i < items.length - 1 ? "border-b border-slate-100" : ""}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 flex-shrink-0">
              <path d={item.icon} />
            </svg>
            <span className="text-[14px] font-semibold text-slate-800">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Poll Bubble ──────────────────────────────────────────────────────────────
function PollBubble({ pollId, myId, isMe }) {
  const [poll,       setPoll]       = useState(null);
  const [myVoteIdx,  setMyVoteIdx]  = useState(null);
  const [voteCounts, setVoteCounts] = useState([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [voting,     setVoting]     = useState(false);

  useEffect(() => {
    if (!pollId) return;
    supabase.from("org_polls").select("*").eq("id", pollId).single()
      .then(({ data }) => {
        if (data) {
          setPoll(data);
          setVoteCounts(Array(data.options?.length || 0).fill(0));
        }
      });
    supabase.from("org_poll_votes").select("option_index, user_id").eq("poll_id", pollId)
      .then(({ data }) => {
        if (!data) return;
        const mine = data.find(v => v.user_id === myId);
        if (mine != null) setMyVoteIdx(mine.option_index);
        const counts = [];
        data.forEach(v => { counts[v.option_index] = (counts[v.option_index] || 0) + 1; });
        setVoteCounts(counts);
        setTotalVotes(data.length);
      });
  }, [pollId, myId]);

  const vote = async (idx) => {
    if (!poll || voting) return;
    const isClosed = !poll.is_active || (poll.closes_at && new Date(poll.closes_at) < new Date());
    if (isClosed) return;
    setVoting(true);
    if (myVoteIdx === idx) {
      await supabase.from("org_poll_votes").delete().match({ poll_id: pollId, user_id: myId });
      setVoteCounts(c => { const n = [...c]; n[idx] = Math.max(0, (n[idx] || 0) - 1); return n; });
      setTotalVotes(t => Math.max(0, t - 1));
      setMyVoteIdx(null);
    } else {
      const prev = myVoteIdx;
      await supabase.from("org_poll_votes").upsert(
        { poll_id: pollId, option_index: idx, user_id: myId, org_id: poll.org_id },
        { onConflict: "poll_id,user_id" }
      );
      setVoteCounts(c => { const n = [...c]; n[idx] = (n[idx] || 0) + 1; if (prev !== null) n[prev] = Math.max(0, (n[prev] || 0) - 1); return n; });
      setTotalVotes(t => prev !== null ? t : t + 1);
      setMyVoteIdx(idx);
    }
    setVoting(false);
  };

  if (!poll) return (
    <div className={`min-w-[200px] rounded-2xl px-3 py-3 shadow-sm ${isMe ? "bg-[#dcf8c6]" : "bg-white"}`}>
      <p className="text-[12px] text-slate-400">Loading poll…</p>
    </div>
  );

  const isClosed = !poll.is_active || (poll.closes_at && new Date(poll.closes_at) < new Date());
  const hasVoted = myVoteIdx !== null;
  const opts     = poll.options || [];

  return (
    <div className="min-w-[220px] max-w-[280px] rounded-2xl overflow-hidden shadow-sm" style={{ background: isMe ? "#dcf8c6" : "#fff" }}>
      <div className={`px-3 pt-3 pb-2 border-b ${isMe ? "border-[#b7e8a0]" : "border-slate-100"}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <svg viewBox="0 0 24 24" fill="none" stroke={isMe ? "#128c7e" : "#3b82f6"} strokeWidth={2} className="w-3.5 h-3.5 flex-shrink-0">
            <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
          <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isMe ? "text-[#128c7e]" : "text-blue-500"}`}>Poll</span>
          {isClosed && <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">Closed</span>}
        </div>
        <p className={`text-[13px] font-bold leading-snug ${isMe ? "text-[#111b21]" : "text-slate-800"}`}>{poll.question}</p>
        <p className={`text-[10px] mt-0.5 ${isMe ? "text-[#128c7e]/70" : "text-slate-400"}`}>
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
          {poll.closes_at && !isClosed ? ` · ends ${new Date(poll.closes_at).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}
        </p>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {opts.map((opt, idx) => {
          const count = voteCounts[idx] || 0;
          const pct   = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMine = myVoteIdx === idx;
          return (
            <button key={idx} onClick={() => vote(idx)} disabled={isClosed || voting}
              className={`relative w-full rounded-xl text-left overflow-hidden transition-transform ${!isClosed && !voting ? "active:scale-[0.98]" : "opacity-70"} ${isMine ? (isMe ? "ring-2 ring-[#128c7e]/50" : "ring-2 ring-blue-400/50") : ""}`}>
              {hasVoted && (
                <div className="absolute inset-y-0 left-0 rounded-xl transition-all"
                  style={{ width: `${pct}%`, background: isMine ? (isMe ? "#25d366" : "#3b82f6") : (isMe ? "#b7e8a0" : "#e2e8f0"), opacity: 0.3 }} />
              )}
              <div className={`relative flex items-center justify-between px-3 py-2 rounded-xl border ${isMine ? (isMe ? "border-[#25d366]/60 bg-[#25d366]/10" : "border-blue-300/60 bg-blue-50/60") : (isMe ? "border-[#b7e8a0]/40" : "border-slate-100")}`}>
                <span className={`text-[12px] font-semibold pr-2 ${isMe ? "text-[#111b21]" : "text-slate-700"}`}>{opt}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {hasVoted && <span className={`text-[10px] font-bold ${isMine ? (isMe ? "text-[#128c7e]" : "text-blue-600") : "text-slate-400"}`}>{pct}%</span>}
                  {isMine && <svg viewBox="0 0 24 24" fill="none" stroke={isMe ? "#128c7e" : "#3b82f6"} strokeWidth={2.5} className="w-3 h-3"><path d="M5 12l5 5L20 7"/></svg>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event Bubble ─────────────────────────────────────────────────────────────
function EventBubble({ eventId, myId, isMe }) {
  const [event,      setEvent]      = useState(null);
  const [myRsvp,     setMyRsvp]     = useState(null);
  const [rsvpCounts, setRsvpCounts] = useState({ going: 0, maybe: 0, not_going: 0 });
  const [rsvpBusy,   setRsvpBusy]   = useState(false);

  useEffect(() => {
    if (!eventId) return;
    supabase.from("org_events").select("*").eq("id", eventId).single()
      .then(({ data }) => setEvent(data));
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !myId) return;
    supabase.from("org_event_rsvps").select("status").eq("event_id", eventId).eq("user_id", myId).maybeSingle()
      .then(({ data }) => { if (data) setMyRsvp(data.status); });
    supabase.from("org_event_rsvps").select("status").eq("event_id", eventId)
      .then(({ data }) => {
        if (!data) return;
        const c = { going: 0, maybe: 0, not_going: 0 };
        data.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
        setRsvpCounts(c);
      });
  }, [eventId, myId]);

  const castRsvp = async (status) => {
    if (!event || rsvpBusy) return;
    setRsvpBusy(true);
    const prev = myRsvp;
    if (status === myRsvp) {
      await supabase.from("org_event_rsvps").delete().match({ event_id: eventId, user_id: myId });
      setMyRsvp(null);
      setRsvpCounts(c => ({ ...c, [status]: Math.max(0, c[status] - 1) }));
    } else {
      await supabase.from("org_event_rsvps").upsert(
        { event_id: eventId, org_id: event.org_id, user_id: myId, status },
        { onConflict: "event_id,user_id" }
      );
      setMyRsvp(status);
      setRsvpCounts(c => {
        const n = { ...c, [status]: (c[status] || 0) + 1 };
        if (prev) n[prev] = Math.max(0, n[prev] - 1);
        return n;
      });
    }
    setRsvpBusy(false);
  };

  if (!event) return (
    <div className={`min-w-[200px] rounded-2xl px-3 py-3 shadow-sm ${isMe ? "bg-[#dcf8c6]" : "bg-white"}`}>
      <p className="text-[12px] text-slate-400">Loading event…</p>
    </div>
  );

  const fmtEv  = ts => new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const isPast = event.event_date && new Date(event.event_date) < new Date();

  const RSVP_OPTIONS = [
    { s: "going",     label: "Going",  icon: "M5 13l4 4L19 7",                          activeBg: "#dcf8c6", activeBorder: "#25d366", activeText: "#128c7e" },
    { s: "maybe",     label: "Maybe",  icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", activeBg: "#fef9c3", activeBorder: "#f59e0b", activeText: "#92400e" },
    { s: "not_going", label: "No",     icon: "M6 18L18 6M6 6l12 12",                    activeBg: "#fee2e2", activeBorder: "#ef4444", activeText: "#991b1b" },
  ];

  const totalGoing = rsvpCounts.going;

  return (
    <div className="min-w-[220px] max-w-[280px] rounded-2xl overflow-hidden shadow-sm" style={{ background: isMe ? "#dcf8c6" : "#fff" }}>

      {/* Header */}
      <div className={`px-3 pt-3 pb-2.5 border-b ${isMe ? "border-[#b7e8a0]" : "border-slate-100"}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <svg viewBox="0 0 24 24" fill="none" stroke={isMe ? "#128c7e" : "#075E54"} strokeWidth={2} className="w-3.5 h-3.5 flex-shrink-0">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isMe ? "text-[#128c7e]" : "text-[#075E54]"}`}>Event</span>
          {isPast && <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Ended</span>}
        </div>
        <p className={`text-[13px] font-bold leading-snug ${isMe ? "text-[#111b21]" : "text-slate-800"}`}>{event.title}</p>
        <div className={`flex items-center gap-1.5 mt-1 ${isMe ? "text-[#128c7e]" : "text-[#075E54]"}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 flex-shrink-0">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span className="text-[11px] font-semibold">{fmtEv(event.event_date)}</span>
        </div>
        {event.location && (
          <div className="flex items-center gap-1 mt-0.5 text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 flex-shrink-0">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-[11px] truncate">{event.location}</span>
          </div>
        )}
        {event.event_link && (
          <a href={event.event_link} target="_blank" rel="noreferrer"
            className={`inline-flex items-center gap-1 mt-1.5 text-[11px] font-bold ${isMe ? "text-[#128c7e]" : "text-blue-500"}`}
            onClick={e => e.stopPropagation()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
            </svg>
            Join online
          </a>
        )}
        {event.description && (
          <p className={`text-[11px] leading-relaxed mt-1.5 ${isMe ? "text-[#111b21]/65" : "text-slate-500"}`}>
            {event.description.slice(0, 90)}{event.description.length > 90 ? "…" : ""}
          </p>
        )}
      </div>

      {/* RSVP section */}
      <div className={`px-3 py-2.5`}>
        {totalGoing > 0 && (
          <p className={`text-[10px] font-semibold mb-1.5 ${isMe ? "text-[#128c7e]/70" : "text-slate-400"}`}>
            {totalGoing} going{rsvpCounts.maybe > 0 ? ` · ${rsvpCounts.maybe} maybe` : ""}
          </p>
        )}
        {!isPast ? (
          <div className="flex gap-1.5">
            {RSVP_OPTIONS.map(({ s, label, icon, activeBg, activeBorder, activeText }) => {
              const active = myRsvp === s;
              return (
                <button key={s} onClick={() => castRsvp(s)} disabled={rsvpBusy}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-bold border transition-all active:scale-95 disabled:opacity-60"
                  style={active
                    ? { background: activeBg, borderColor: activeBorder, color: activeText }
                    : { background: "transparent", borderColor: isMe ? "#b7e8a0" : "#e2e8f0", color: isMe ? "#128c7e" : "#64748b" }
                  }>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 flex-shrink-0">
                    <path d={icon}/>
                  </svg>
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          totalGoing === 0 && <p className={`text-[10px] ${isMe ? "text-[#128c7e]/50" : "text-slate-400"}`}>Event has ended</p>
        )}
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
  const [viewProfile,  setViewProfile]  = useState(null);
  const [showMenu,     setShowMenu]     = useState(false);

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
  const latestTs    = useRef(null);
  const chState     = useRef("init"); // tracks realtime channel health

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
      supabase.from("org_members").select("id,full_name,user_id,role,status,avatar_url,profile_image_url,phone,joined_date").eq("org_id", orgId).eq("status", "active"),
      supabase.from("org_chat_settings").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("org_chat_reads").select("user_id,last_read_at").eq("org_id", orgId),
    ]).then(([msgs, memR, setR, readsR]) => {
      setMessages(msgs);
      if (msgs.length > 0) {
        oldestTs.current = msgs[0].created_at;
        latestTs.current = msgs[msgs.length - 1].created_at;
      }
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
        if (m.created_at) latestTs.current = m.created_at;
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
          // New message from someone else — notify if tab not focused
          if (m.sender_id !== myIdRef.current) {
            if (document.visibilityState !== "visible" || !document.hasFocus()) {
              if (Notification.permission === "granted") {
                new Notification(m.sender_name || "New message", {
                  body: m.type === "audio" ? "🎤 Voice message" : m.type === "image" ? "📷 Photo" : m.content || "New message",
                  icon: "/favicon.ico",
                  tag: `msg-${orgId}`,
                  renotify: true,
                });
              }
            }
          }
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
        chState.current = status;
        if (status === "SUBSCRIBED" && myIdRef.current) {
          await ch.track({ user_id: myIdRef.current, user_name: myName, typing: false, role: myRole });
        }
      });

    return () => { supabase.removeChannel(ch); };
  }, [orgId, myName, myRole, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Notification permission ────────────────────────────────────────────────
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // ── Sync missed messages + reconnect on tab focus ──────────────────────────
  useEffect(() => {
    if (!orgId) return;

    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;

      // Fetch any messages that arrived while the tab was in the background
      const since = latestTs.current;
      if (since) {
        const { data } = await supabase
          .from("org_group_messages")
          .select("*, reactions:org_message_reactions(*)")
          .eq("org_id", orgId)
          .gt("created_at", since)
          .order("created_at", { ascending: true });

        if (data?.length) {
          latestTs.current = data[data.length - 1].created_at;
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const fresh = data
              .filter(m => !existingIds.has(m.id))
              .map(m => ({ ...m, reactions: m.reactions || [] }));
            if (!fresh.length) return prev;
            setTimeout(() => {
              if (atBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              else setUnread(c => c + fresh.length);
            }, 40);
            return [...prev, ...fresh];
          });
        }
      }

      // Reconnect realtime channel if it dropped while backgrounded
      if (chState.current !== "SUBSCRIBED" && channelRef.current) {
        supabase.removeChannel(channelRef.current).then(() => {
          // The realtime useEffect will re-run and create a fresh channel
          // when orgId/myName/myRole haven't changed — force it by touching channelRef
          channelRef.current = null;
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (data.created_at) latestTs.current = data.created_at;
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
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime     = getBestMime();
      const recOpts  = mime ? { mimeType: mime } : {};
      const rec      = new MediaRecorder(stream, recOpts);
      const usedMime = rec.mimeType || mime || "audio/webm";
      audioChunks.current = [];
      recDur.current      = 0;
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: usedMime });
        const ext  = mimeToExt(usedMime);
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: usedMime });
        try {
          const url = await upload(file);
          await sendMsg({ type: "audio", media_url: url, media_name: file.name, media_mime: usedMime, duration: recDur.current });
        } catch {}
        setRecSecs(0);
      };
      rec.start(250); // collect in 250ms chunks for reliability
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

  // Map sender_id / sender_name → avatar_url for message bubbles.
  // Keyed by user_id (primary) AND full_name (fallback for members whose user_id
  // is not yet set in org_members).
  const avatarMap = useMemo(() => {
    const m = {};
    for (const mem of members) {
      const url = mem.avatar_url || mem.profile_image_url;
      if (!url) continue;
      if (mem.user_id) m[mem.user_id] = url;
      m[`n:${mem.full_name}`] = url;
    }
    if (org?.logo_url) {
      if (org?.owner_id)       m[org.owner_id]       = org.logo_url;
      if (org?.portal_user_id) m[org.portal_user_id] = org.logo_url;
      m["__org__"] = org.logo_url;
    }
    return m;
  }, [members, org]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 z-[80] bg-[#e5ddd5] flex items-center justify-center">
      <div className="w-9 h-9 border-[3px] border-[#128c7e] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-[#e5ddd5]">
      <div className="w-full max-w-md flex flex-col h-full">

        {/* ── Header ── */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5"
          style={{ background: "#075E54", paddingTop: "max(10px,env(safe-area-inset-top))" }}>
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
              <p className="text-[10px] text-white/65 truncate">
                {typingUsers.length > 0
                  ? `${typingUsers.slice(0, 2).join(", ")} typing…`
                  : `${members.length + 1} members · ${onlineIds.length} online`}
              </p>
            </div>
          </button>

          <button onClick={() => setShowMenu(s => !s)}
            className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="white" className="w-[18px] h-[18px]">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </div>

        {/* ── Search ── */}
        {showSearch && (
          <div className="flex-shrink-0 px-3 py-2 bg-[#075E54]">
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
          <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2 bg-white/90 backdrop-blur-sm border-b border-slate-200">
            <button onClick={() => jumpTo(pinnedMsg.id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
              <div className="w-0.5 h-8 bg-[#128c7e] rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-extrabold text-[#128c7e] uppercase tracking-wider">📌 Pinned message</p>
                <p className="text-xs text-slate-700 truncate font-medium">
                  {pinnedMsg.type === "audio" ? "🎤 Voice message" : pinnedMsg.type === "image" ? "📷 Photo" : pinnedMsg.content}
                </p>
              </div>
            </button>
            {isAdmin && (
              <button onClick={() => doAction("pin", pinnedMsg)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 active:bg-slate-100 flex-shrink-0"
                title="Unpin">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        )}

        {/* ── Messages ── */}
        <div ref={listRef} onScroll={onScroll}
          className="flex-1 overflow-y-auto overscroll-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23e5ddd5'/%3E%3Ccircle cx='40' cy='40' r='1' fill='%23c9c0b5' opacity='0.6'/%3E%3C/svg%3E\")" }}>

          {loadingMore && (
            <div className="flex justify-center py-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {hasMore && !loadingMore && (
            <div className="flex justify-center pt-2 pb-1">
              <button onClick={loadMore}
                className="text-xs text-[#128c7e] font-bold bg-white/90 px-4 py-1.5 rounded-full shadow-sm active:bg-[#e8f5f3]">
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
                    avatarUrl={avatarMap[msg.sender_id] || avatarMap[`n:${msg.sender_name}`] || null}
                    onLongPress={m => setCtxMsg(m)}
                    onReact={(m, e) => doAction("react", m, e)}
                    onJumpTo={jumpTo}
                    onAvatarTap={m => {
                      const mem = members.find(x => x.user_id === m.sender_id)
                               || members.find(x => x.full_name === m.sender_name);
                      if (mem) { setViewProfile({ ...mem, avatar_url: mem.avatar_url || mem.profile_image_url }); return; }
                      if (m.sender_role === "admin" || m.sender_role === "org") {
                        setViewProfile({ full_name: m.sender_name, role: "admin", avatar_url: org?.logo_url, joined_date: null, phone: null });
                      }
                    }}
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
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] bg-[#25d366] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
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
            <div className="w-0.5 h-8 bg-[#128c7e] rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-extrabold text-[#128c7e]">{replyTo.sender_name}</p>
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
                className="w-10 h-10 rounded-full bg-[#128c7e] text-white flex items-center justify-center flex-shrink-0 shadow-md active:scale-90 transition-transform">
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
                  className="w-10 h-10 rounded-full bg-[#128c7e] flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 disabled:opacity-50 active:scale-90 transition-transform">
                  {sending
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : editMsg
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M5 12l5 5L20 7"/></svg>
                    : <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 -rotate-45 translate-x-0.5"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>}
                </button>
              ) : (
                <button onClick={startRec}
                  className="w-10 h-10 rounded-full bg-[#128c7e] flex items-center justify-center shadow-md flex-shrink-0 mb-0.5 active:scale-90 transition-transform">
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

      {/* ── Header menu ── */}
      {showMenu && (
        <ChatHeaderMenu
          isAdmin={isAdmin}
          onGroupInfo={() => setShowInfo(true)}
          onSearch={() => { setShowSearch(s => !s); setSearchQ(""); }}
          onEditGroup={() => setEditSettings(true)}
          onClose={() => setShowMenu(false)}
        />
      )}

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

      {/* ── Group info page ── */}
      {showInfo && (
        <GroupInfoPage
          orgId={orgId} orgName={orgName} org={org} settings={settings}
          members={members} onlineIds={onlineIds} lastSeen={lastSeen}
          isAdmin={isAdmin} myId={myIdRef.current || myId}
          onClose={() => setShowInfo(false)}
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

      {/* ── Sender profile sheet ── */}
      {viewProfile && (
        <SenderProfile member={viewProfile} org={org} isAdmin={isAdmin} onClose={() => setViewProfile(null)} />
      )}
    </div>
  );
}
