import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabase";
import { friendlyError } from "../utils/errorMessage";
import { askGemini } from "../utils/gemini";

// ── Icons ────────────────────────────────────────────────────────────────────
const ArrowLeft   = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const ChevronDown = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>;
const ChevronUp   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>;
const SearchIcon  = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
const PlusIcon    = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const SendIcon    = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const TicketIcon  = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M2 9a1 1 0 010-2v-1a2 2 0 012-2h16a2 2 0 012 2v1a1 1 0 010 2v1a1 1 0 010 2v1a2 2 0 01-2 2H4a2 2 0 01-2-2v-1a1 1 0 010-2z"/></svg>;
const ThumbUp     = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>;
const ThumbDown   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>;

const TICKET_TYPES = ["general", "payment", "account", "invoice", "subscription", "technical", "ajo", "other"];
const PRIORITIES   = ["low", "medium", "high"];

const STATUS_META = {
  open:              { label: "Open",           cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"           },
  in_progress:       { label: "In Progress",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"       },
  escalated:         { label: "Escalated",      cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"   },
  awaiting_response: { label: "Awaiting Reply", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"   },
  resolved:          { label: "Resolved",       cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  closed:            { label: "Closed",         cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"          },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.open;
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}
function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 864e5;
}

// Build context string for Gemini from FAQ items
function buildFaqContext(items) {
  const qa = items.slice(0, 30).map(item => {
    const plain = item.answer.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return `Q: ${item.question}\nA: ${plain}`;
  }).join("\n\n");

  return `You are KudiAI, the friendly support assistant built into KudiAI Track — a business management app for Nigerian SMEs. A user is searching the help centre and needs an answer.

Answer the user's question in 2–4 short, warm sentences. Be direct and helpful. No markdown headers, no bullet points — plain conversational text only. Keep it under 100 words.

If the question is clearly answered by the FAQ knowledge base below, use that information. Otherwise, use your general knowledge about business management apps, invoicing, payments, and Nigerian SME operations.

=== FAQ Knowledge Base ===
${qa}
=== End FAQ ===`;
}

// ── Typing dots indicator ─────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ── KudiAI answer card shown in FAQ search ────────────────────────────────────
function KudiAICard({ loading, answer, onContactSupport }) {
  if (!loading && !answer) return null;
  return (
    <div className="mb-4 rounded-2xl overflow-hidden border border-brand-200 dark:border-brand-700/50 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-600">
        <span className="text-sm">✨</span>
        <span className="text-xs font-extrabold tracking-widest text-white uppercase">KudiAI</span>
        <span className="ml-auto text-[10px] text-brand-200 font-medium">AI answer</span>
      </div>
      {/* Body */}
      <div className="px-4 py-4 bg-brand-50 dark:bg-brand-900/20">
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-slate-400 dark:text-slate-500">
            <TypingDots />
            <span>KudiAI is thinking…</span>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{answer}</p>
            <button
              onClick={onContactSupport}
              className="mt-3 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
            >
              Still need help? Open a support ticket →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── FAQ Accordion Item ────────────────────────────────────────────────────────
function FaqItem({ item, expanded, onToggle, feedback, onFeedback }) {
  const fb = feedback[item.id];
  return (
    <div className="border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <button
        onClick={() => onToggle(item.id)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug flex-1">{item.question}</span>
        <span className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500">
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 pt-3 pb-4">
          <div
            className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed faq-answer"
            dangerouslySetInnerHTML={{ __html: item.answer }}
          />
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <span className="text-xs text-slate-400 dark:text-slate-500">Was this helpful?</span>
            <button
              onClick={() => onFeedback(item.id, true)}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-xl transition-colors ${
                fb === true
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              }`}
            >
              <ThumbUp /> Yes
            </button>
            <button
              onClick={() => onFeedback(item.id, false)}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-xl transition-colors ${
                fb === false
                  ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              }`}
            >
              <ThumbDown /> No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Star Rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`text-2xl transition-transform active:scale-110 ${n <= value ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Ticket Detail View ────────────────────────────────────────────────────────
function TicketDetail({ ticket, userId, profile, onBack, onUpdate }) {
  const [messages,   setMessages]   = useState([]);
  const [adminMsgs,  setAdminMsgs]  = useState([]);
  const [reply,      setReply]      = useState("");
  const [sending,    setSending]    = useState(false);
  const [rating,     setRating]     = useState(0);
  const [ratingDone, setRatingDone] = useState(false);
  const [reopening,  setReopening]  = useState(false);
  const bottomRef = useRef(null);

  const canReply  = ["open", "in_progress", "awaiting_response", "escalated"].includes(ticket.status);
  const canReopen = ticket.status === "resolved" && daysSince(ticket.resolved_at || ticket.updated_at) < 7;
  const canRate   = ticket.status === "resolved" && !ticket.rating;

  useEffect(() => {
    async function load() {
      const [{ data: msgs }, { data: adminComments }] = await Promise.all([
        supabase.from("ticket_messages").select("*").eq("ticket_id", ticket.id).order("created_at"),
        supabase.from("support_ticket_comments").select("*")
          .eq("ticket_id", ticket.id).eq("is_internal", false).order("created_at"),
      ]);
      setMessages(msgs || []);
      setAdminMsgs(adminComments || []);
    }
    load();
  }, [ticket.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, adminMsgs]);

  const timeline = [
    { type: "initial",   created_at: ticket.created_at, content: ticket.description, sender: profile?.owner_name || profile?.business_name || "You" },
    ...(messages  || []).map(m => ({ ...m, type: "user_msg"  })),
    ...(adminMsgs || []).map(m => ({ ...m, type: "admin_msg" })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    const { data: msg } = await supabase.from("ticket_messages").insert({
      ticket_id:   ticket.id,
      sender_type: "user",
      sender_id:   userId,
      sender_name: profile?.owner_name || profile?.business_name || "Me",
      content:     text,
    }).select().single();
    if (msg) setMessages(m => [...m, msg]);
    await supabase.from("support_tickets").update({ updated_at: new Date().toISOString() }).eq("id", ticket.id);
    setReply("");
    setSending(false);
  };

  const submitRating = async () => {
    if (!rating) return;
    await supabase.from("support_tickets").update({ rating }).eq("id", ticket.id);
    setRatingDone(true);
    onUpdate();
  };

  const reopen = async () => {
    setReopening(true);
    await supabase.from("support_tickets").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", ticket.id);
    setReopening(false);
    onUpdate();
    onBack();
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 64px)" }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
          <ArrowLeft />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-2 py-0.5 rounded-full">
              {ticket.ticket_no}
            </span>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-sm font-bold text-slate-800 dark:text-white truncate mt-0.5">{ticket.subject}</p>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {timeline.map((item, i) => {
          const isAdmin = item.type === "admin_msg";
          return (
            <div key={i} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[82%] ${isAdmin ? "bg-slate-100 dark:bg-slate-800" : "bg-brand-600"} rounded-2xl ${isAdmin ? "rounded-tl-sm" : "rounded-tr-sm"} px-4 py-3`}>
                {isAdmin && (
                  <p className="text-[10px] font-bold text-brand-600 dark:text-brand-400 mb-1">
                    {item.admin_username || "Support Team"}
                  </p>
                )}
                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isAdmin ? "text-slate-700 dark:text-slate-200" : "text-white"}`}>
                  {item.content || item.comment}
                </p>
                <p className={`text-[10px] mt-1.5 ${isAdmin ? "text-slate-400 dark:text-slate-500" : "text-white/60"}`}>
                  {fmtDate(item.created_at)} · {fmtTime(item.created_at)}
                </p>
              </div>
            </div>
          );
        })}

        {ticket.status === "awaiting_response" && ticket.needs_info_message && (
          <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700/40 rounded-2xl px-4 py-3 text-sm text-violet-700 dark:text-violet-300">
            <p className="font-semibold text-xs uppercase tracking-wide mb-1">Additional info needed</p>
            {ticket.needs_info_message}
          </div>
        )}

        {ticket.resolution && (ticket.status === "resolved" || ticket.status === "closed") && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-2xl px-4 py-3">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">Resolution</p>
            <p className="text-sm text-emerald-800 dark:text-emerald-200">{ticket.resolution}</p>
          </div>
        )}

        {canRate && !ratingDone && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-4 py-4">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-1">How was our support?</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">Rate your experience (optional)</p>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && (
              <button onClick={submitRating} className="mt-3 text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-200 dark:bg-amber-800/40 px-4 py-2 rounded-xl active:scale-95 transition">
                Submit Rating
              </button>
            )}
          </div>
        )}

        {ratingDone && (
          <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
            Thanks for your rating! ⭐
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Reply / Action bar */}
      <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-4 py-3 flex flex-col gap-2">
        {canReopen && (
          <button onClick={reopen} disabled={reopening}
            className="w-full py-2.5 rounded-2xl border border-brand-500 text-brand-600 dark:text-brand-400 text-sm font-bold active:scale-[0.98] transition disabled:opacity-50">
            {reopening ? "Reopening…" : "Reopen Ticket"}
          </button>
        )}
        {canReply && (
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Type a reply…"
              rows={2}
              className="flex-1 border border-slate-200 dark:border-slate-600 rounded-2xl px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
            />
            <button onClick={sendReply} disabled={!reply.trim() || sending}
              className="flex-shrink-0 w-10 h-10 rounded-2xl bg-brand-600 text-white flex items-center justify-center active:scale-90 transition disabled:opacity-40">
              {sending ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <SendIcon />}
            </button>
          </div>
        )}
        {!canReply && !canReopen && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-1">
            This ticket is {ticket.status}.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Create Ticket Form ────────────────────────────────────────────────────────
function CreateTicket({ userId, profile, session, onBack, onCreated }) {
  const [form,   setForm]   = useState({ subject: "", description: "", type: "general", priority: "medium" });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const submit = async () => {
    if (!form.subject.trim() || !form.description.trim()) {
      setError("Subject and description are required.");
      return;
    }
    setSaving(true);
    setError("");
    const { data: ticket, error: err } = await supabase.from("support_tickets").insert({
      user_id:     userId,
      user_email:  session?.user?.email,
      user_name:   profile?.owner_name || profile?.business_name || "",
      subject:     form.subject.trim(),
      description: form.description.trim(),
      type:        form.type,
      priority:    form.priority,
      status:      "open",
    }).select().single();

    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    onCreated(ticket);
  };

  const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-2xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="pb-32 screen-enter">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onBack} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
          <ArrowLeft />
        </button>
        <h2 className="text-[17px] font-bold text-slate-900 dark:text-white">New Support Ticket</h2>
      </div>

      {/* Form fields */}
      <div className="px-4 py-5 space-y-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Subject *</label>
          <input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            placeholder="Brief description of your issue"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Category</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
              {TICKET_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Description *</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe your issue in detail. Include any error messages or steps to reproduce the problem."
            rows={6}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl px-4 py-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Your ticket will be assigned a reference number and our support team will respond within 24 hours.
        </div>

        {/* Submit button lives inside the scrollable area so it's always reachable */}
        <button
          onClick={submit}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-bold text-sm active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
        >
          {saving
            ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Submitting…</>
            : <><TicketIcon /> Submit Ticket</>}
        </button>
      </div>
    </div>
  );
}

// ── Main Help Screen ──────────────────────────────────────────────────────────
export default function Help({ store, session }) {
  const navigate = useNavigate();
  const profile  = store?.profile || {};
  const userId   = session?.user?.id;

  const [tab, setTab] = useState("faq");

  // FAQ state
  const [categories,     setCategories]     = useState([]);
  const [faqItems,       setFaqItems]       = useState([]);
  const [faqLoading,     setFaqLoading]     = useState(true);
  const [search,         setSearch]         = useState("");
  const [activeCategory, setActiveCategory] = useState(null);
  const [expandedId,     setExpandedId]     = useState(null);
  const [feedback,       setFeedback]       = useState({});

  // KudiAI search answer
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer,  setAiAnswer]  = useState("");
  const aiReqId = useRef(0);

  // Ticket state
  const [tickets,        setTickets]        = useState([]);
  const [ticketLoading,  setTicketLoading]  = useState(false);
  const [ticketView,     setTicketView]     = useState("list");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [successTicket,  setSuccessTicket]  = useState(null);

  // ── Load FAQ ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadFAQ() {
      setFaqLoading(true);
      const [{ data: cats }, { data: items }] = await Promise.all([
        supabase.from("faq_categories").select("id, name, icon").order("sort_order"),
        supabase.from("faq_items").select("id, category_id, question, answer").eq("is_published", true).order("sort_order"),
      ]);
      setCategories(cats || []);
      setFaqItems(items || []);
      setFaqLoading(false);
    }
    loadFAQ();
  }, []);

  // ── Gemini FAQ search — debounced, fires after 600ms of inactivity ────────────
  useEffect(() => {
    if (search.trim().length < 3) {
      setAiAnswer("");
      setAiLoading(false);
      return;
    }

    setAiLoading(true);
    setAiAnswer("");

    const timer = setTimeout(async () => {
      const reqId = ++aiReqId.current;
      try {
        const context = buildFaqContext(faqItems);
        const answer  = await askGemini({ message: search.trim(), context, timeout: 20000 });
        if (reqId === aiReqId.current) {
          setAiAnswer(answer || "I couldn't find a specific answer. Please try rephrasing or open a support ticket.");
          setAiLoading(false);
        }
      } catch {
        if (reqId === aiReqId.current) {
          setAiAnswer("I'm having trouble connecting right now. Try again or open a support ticket.");
          setAiLoading(false);
        }
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [search, faqItems]);

  // ── Load Tickets ──────────────────────────────────────────────────────────────
  const loadTickets = useCallback(async () => {
    if (!userId) return;
    setTicketLoading(true);
    const { data } = await supabase.from("support_tickets")
      .select("*").eq("user_id", userId).order("created_at", { ascending: false });
    setTickets(data || []);
    setTicketLoading(false);
  }, [userId]);

  useEffect(() => {
    if (tab === "tickets") loadTickets();
  }, [tab, loadTickets]);

  // ── FAQ helpers ───────────────────────────────────────────────────────────────
  const filteredFAQ = faqItems.filter(item => {
    const matchCat    = !activeCategory || item.category_id === activeCategory;
    const q           = search.toLowerCase();
    const matchSearch = !q || item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const handleFeedback = async (itemId, isHelpful) => {
    if (!userId) return;
    setFeedback(f => ({ ...f, [itemId]: isHelpful }));
    await supabase.from("faq_feedback").upsert(
      { faq_item_id: itemId, user_id: userId, is_helpful: isHelpful },
      { onConflict: "faq_item_id,user_id" }
    );
  };

  const goToCreateTicket = () => { setTab("tickets"); setTicketView("create"); };

  // ── Full-screen sub-views ─────────────────────────────────────────────────────
  if (tab === "tickets" && ticketView === "create") {
    return (
      <CreateTicket
        userId={userId}
        profile={profile}
        session={session}
        onBack={() => setTicketView("list")}
        onCreated={(ticket) => {
          setTickets(t => [ticket, ...t]);
          setSuccessTicket(ticket);
          setTicketView("list");
        }}
      />
    );
  }

  if (tab === "tickets" && ticketView === "detail" && selectedTicket) {
    return (
      <TicketDetail
        ticket={selectedTicket}
        userId={userId}
        profile={profile}
        onBack={() => { setTicketView("list"); setSelectedTicket(null); }}
        onUpdate={loadTickets}
      />
    );
  }

  // ── Main tabbed view ──────────────────────────────────────────────────────────
  return (
    <div className="pb-32 screen-enter">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={() => navigate("/settings")} className="text-slate-600 dark:text-slate-300 active:scale-90 transition">
          <ArrowLeft />
        </button>
        <h1 className="text-[22px] font-bold text-slate-900 dark:text-white flex-1">Help & Support</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-4">
        {[{ key: "faq", label: "FAQs" }, { key: "tickets", label: "My Tickets" }].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${
              tab === key
                ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── FAQ Tab ─────────────────────────────────────────────────────────── */}
      {tab === "faq" && (
        <div className="px-4 pt-4">
          {/* Search box */}
          <div className="relative mb-4">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </div>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveCategory(null); }}
              placeholder="Ask KudiAI anything…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-2xl text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {search.length > 0 && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {/* KudiAI answer card — appears when searching */}
          <KudiAICard
            loading={aiLoading}
            answer={aiAnswer}
            onContactSupport={goToCreateTicket}
          />

          {/* Category chips — hide while searching */}
          {!search && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setActiveCategory(null)}
                className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                  !activeCategory
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800"
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                  className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                    activeCategory === cat.id
                      ? "bg-brand-600 text-white border-brand-600"
                      : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800"
                  }`}
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* FAQ items */}
          {faqLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : filteredFAQ.length === 0 && !search ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">📚</p>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No FAQs available yet</p>
            </div>
          ) : filteredFAQ.length === 0 && search ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No FAQ matches found — see KudiAI's answer above
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {!search && !activeCategory ? (
                categories.map(cat => {
                  const catItems = filteredFAQ.filter(i => i.category_id === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat.id} className="mb-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 px-1">
                        {cat.icon} {cat.name}
                      </p>
                      <div className="space-y-2">
                        {catItems.map(item => (
                          <FaqItem
                            key={item.id}
                            item={item}
                            expanded={expandedId === item.id}
                            onToggle={id => setExpandedId(e => e === id ? null : id)}
                            feedback={feedback}
                            onFeedback={handleFeedback}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                filteredFAQ.map(item => (
                  <FaqItem
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={id => setExpandedId(e => e === id ? null : id)}
                    feedback={feedback}
                    onFeedback={handleFeedback}
                  />
                ))
              )}
            </div>
          )}

          {/* Still need help? */}
          <div className="mt-6 mb-4 bg-gradient-to-br from-brand-600 to-brand-800 rounded-3xl px-5 py-5 text-white">
            <p className="font-extrabold text-base mb-1">Still need help?</p>
            <p className="text-sm text-white/75 mb-4 leading-relaxed">
              Our support team is ready to help you. Create a ticket and we'll get back to you within 24 hours.
            </p>
            <button
              onClick={goToCreateTicket}
              className="flex items-center gap-2 bg-white text-brand-700 font-bold text-sm px-4 py-2.5 rounded-2xl active:scale-95 transition"
            >
              <TicketIcon /> Contact Support
            </button>
          </div>
        </div>
      )}

      {/* ── Tickets Tab ──────────────────────────────────────────────────────── */}
      {tab === "tickets" && (
        <div className="px-4 pt-4">
          {successTicket && (
            <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">✓</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Ticket submitted!</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  Reference: <span className="font-bold">{successTicket.ticket_no}</span>. We'll respond within 24 hours.
                </p>
              </div>
              <button onClick={() => setSuccessTicket(null)} className="text-emerald-400 text-lg leading-none">×</button>
            </div>
          )}

          <button
            onClick={() => setTicketView("create")}
            className="w-full flex items-center justify-center gap-2 py-3 mb-4 rounded-2xl border-2 border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 font-bold text-sm active:scale-[0.98] transition hover:bg-brand-50 dark:hover:bg-brand-900/10"
          >
            <PlusIcon /> New Ticket
          </button>

          {ticketLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-5xl mb-4">🎟️</p>
              <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-1">No tickets yet</p>
              <p className="text-sm text-slate-400 dark:text-slate-500">Your support tickets will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTicket(t); setTicketView("detail"); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700 shadow-card text-left active:scale-[0.98] transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400">{t.ticket_no}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 line-clamp-2">{t.subject}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{fmtDate(t.created_at)}</p>
                  {t.rating && (
                    <p className="text-xs text-amber-500 mt-1">{"★".repeat(t.rating)}{"☆".repeat(5 - t.rating)}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
