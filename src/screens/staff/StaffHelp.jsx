/* StaffHelp — staff-scoped Help & Support: AI FAQ search + My Tickets
   Mirrors the business portal's Help.jsx but restricted to staff features
   and using view-state instead of react-router navigation.              */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../utils/supabase";
import { friendlyError } from "../../utils/errorMessage";
import { askGemini } from "../../utils/gemini";
import { GK } from "./StaffShared";

/* ── Staff-specific FAQ data ──────────────────────────────────────── */
const STAFF_FAQS = [
  {
    cat: "Sales & Transactions",
    items: [
      { id: "s1", q: "How do I record a cash sale (Cash In)?", a: "Tap Cash In on the Home tab or the Sales tab → Cash Sales. Enter the amount, item name, and customer details, then confirm. Your daily totals update immediately." },
      { id: "s2", q: "How do I record a cash-out or expense?", a: "Tap Cash Out on Home or Sales. Enter the amount and reason (e.g. 'restock', 'wages'). Cash Out reduces your daily net total." },
      { id: "s3", q: "How do I process bill payments?", a: "Go to Sales → Bill Payments or tap a service tile on Home. Choose Airtime, Data, Electricity, Cable TV, or Betting, fill in the details, and confirm. Bill payment must be enabled by your manager." },
      { id: "s4", q: "How do I request a refund or discount approval?", a: "In the Sales tab, tap 'Request Refund / Discount Approval'. Select the type (refund / discount / expense), enter the amount and reason, then submit. Your manager is notified and can approve or reject." },
    ],
  },
  {
    cat: "Records",
    items: [
      { id: "s5", q: "How do I view credit records?", a: "Go to the Records tab → Credit. You can see outstanding balances and overdue accounts. Credit management must be enabled by your manager." },
      { id: "s6", q: "How do I view Ajo / savings records?", a: "Go to Records → Ajo. You can see savings group members and balances. Ajo access requires your business to be on a supporting plan and your manager to enable it for you." },
    ],
  },
  {
    cat: "My Earnings",
    items: [
      { id: "s7", q: "How do I view my commission earnings?", a: "Go to Me → My Commissions. You'll see this month's total, your pending payout, and a history of each earning with the rate and basis amount for every record." },
      { id: "s8", q: "How do I view my salary and payment history?", a: "Go to Me → My Payments. All disbursements your manager has recorded for you appear here with dates, types, and amounts." },
    ],
  },
  {
    cat: "End of Day",
    items: [
      { id: "s9", q: "What is 'Close My Day'?", a: "Close My Day (Me → Close My Day) lets you submit your end-of-day cash count. Enter the actual cash at hand — the system compares it to your expected cash from today's transactions. Discrepancies over ₦100 are flagged for your manager to review." },
      { id: "s10", q: "What happens after I close my day?", a: "Your reconciliation is saved. Your manager can review it in Staff Management. Only one reconciliation is allowed per day — if you made an error, contact your manager to correct it." },
    ],
  },
  {
    cat: "Profile & Security",
    items: [
      { id: "s11", q: "How do I view or update my profile?", a: "Tap the Me tab → View on your profile card to see your full details. Tap Edit (top right) to update your name, phone, or photo. Your email address cannot be changed here." },
      { id: "s12", q: "How do I change my App Lock PIN?", a: "Go to Me → App Lock PIN. Enter your current 6-digit PIN, then choose a new one and confirm. This PIN locks the portal after inactivity." },
      { id: "s13", q: "How do I change my Transaction PIN?", a: "Go to Me → Transaction PIN. Enter your current 4-digit PIN, then set a new one. This PIN authorises bill payments and other sensitive operations." },
      { id: "s14", q: "How do I enable fingerprint / face unlock?", a: "Go to Me → Face / Fingerprint and toggle it on. Your device must support biometrics. Once enabled, use your fingerprint or face ID to unlock the app instead of your 6-digit PIN." },
      { id: "s15", q: "How do I set the auto-lock timeout?", a: "Go to Me → Auto-lock and pick your preferred timeout (1 min, 5 min, 15 min, 30 min, or Never). 5 minutes is recommended for shared-device environments." },
    ],
  },
  {
    cat: "Reports & Activity",
    items: [
      { id: "s16", q: "How do I view my performance reports?", a: "Go to Me → Reports & Insights for charts and breakdowns of your sales performance. You can filter by date range and category." },
      { id: "s17", q: "How do I generate a shareable activity statement?", a: "Go to Me → Activity Statement. Choose a date period and tap Share Statement to generate and share a PDF of your sales history." },
      { id: "s18", q: "How do I view my activity log?", a: "Go to Me → My Activity for a chronological list of all actions you've taken on the portal — sales recorded, approvals requested, settings changed, etc." },
    ],
  },
  {
    cat: "Access & Permissions",
    items: [
      { id: "s19", q: "Why can't I access certain features?", a: "Access is controlled by your manager. Features like credit, invoices, refunds, discounts, and bill payments are individually enabled per staff account. Contact your manager to request access." },
      { id: "s20", q: "Why do I need manager approval for some actions?", a: "Your manager may require approval for refunds, discounts, or large expenses to maintain business controls. Requests notify your manager, who can approve or reject from the Staff Management section." },
    ],
  },
];

/* ── AI context for staff portal only ───────────────────────────── */
function buildStaffAiContext() {
  const qa = STAFF_FAQS.flatMap(cat => cat.items)
    .map(item => `Q: ${item.q}\nA: ${item.a}`)
    .join("\n\n");

  return `You are KudiAI, the friendly support assistant built into the KudiAI Track Staff Portal — a Nigerian business management app.

Answer the staff member's question in 2–4 short, warm sentences. Be direct. No markdown, no bullet points — plain conversational text. Under 100 words.

You may ONLY help with features available to staff:
- Recording cash sales (Cash In / Cash Out)
- Bill payments (airtime, data, electricity, cable TV, betting)
- Credit records, Ajo/savings records, invoices (when permitted by manager)
- Viewing commissions and payment/salary history
- Requesting manager approvals for refunds and discounts
- End-of-day cash reconciliation ("Close My Day")
- Viewing activity log, generating reports and activity statements
- Changing App Lock PIN and Transaction PIN
- Viewing/editing profile and photo
- Biometric unlock and auto-lock settings

Do NOT discuss: subscription plans, staff management, business owner settings, loyalty programs, branch management, or other businesses' data — you only know this staff member's own features.

=== Staff FAQ Knowledge Base ===
${qa}
=== End ===`;
}

/* ── Icon helpers ─────────────────────────────────────────────────── */
const ArrowLeft  = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const PlusIcon   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const SendIcon   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const TicketIcon = () => <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M2 9a1 1 0 010-2v-1a2 2 0 012-2h16a2 2 0 012 2v1a1 1 0 010 2v1a1 1 0 010 2v1a2 2 0 01-2 2H4a2 2 0 01-2-2v-1a1 1 0 010-2z"/></svg>;
const ThumbUp    = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>;
const ThumbDown  = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>;
const ChevDown   = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>;
const ChevUp     = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>;
const SearchIco  = () => <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;

/* ── Status badge ─────────────────────────────────────────────────── */
const STATUS_META = {
  open:              { label: "Open",         cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"             },
  in_progress:       { label: "In Progress",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"         },
  escalated:         { label: "Escalated",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"     },
  awaiting_response: { label: "Awaiting Reply",cls:"bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"    },
  resolved:          { label: "Resolved",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  closed:            { label: "Closed",       cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"           },
};
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.open;
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : ""; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : ""; }
function daysSince(iso) { return (Date.now() - new Date(iso).getTime()) / 864e5; }

/* ── Typing dots ──────────────────────────────────────────────────── */
function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: GK, animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

/* ── KudiAI answer card ───────────────────────────────────────────── */
function KudiAICard({ loading, answer, onContactSupport }) {
  if (!loading && !answer) return null;
  return (
    <div className="mb-4 rounded-2xl overflow-hidden border border-emerald-200 dark:border-emerald-700/50 shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: GK }}>
        <span className="text-sm">✨</span>
        <span className="text-xs font-extrabold tracking-widest text-white uppercase">KudiAI</span>
        <span className="ml-auto text-[10px] text-white/70 font-medium">AI answer</span>
      </div>
      <div className="px-4 py-4 bg-emerald-50 dark:bg-emerald-900/20">
        {loading
          ? <div className="flex items-center gap-3 text-sm text-slate-400 dark:text-slate-500"><TypingDots /><span>KudiAI is thinking…</span></div>
          : <>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{answer}</p>
              <button onClick={onContactSupport} className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                Still need help? Open a support ticket →
              </button>
            </>
        }
      </div>
    </div>
  );
}

/* ── FAQ accordion item ───────────────────────────────────────────── */
function FaqItem({ item, expanded, onToggle, feedback, onFeedback }) {
  const fb = feedback[item.id];
  return (
    <div className="border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <button onClick={() => onToggle(item.id)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug flex-1">{item.q}</span>
        <span className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500">
          {expanded ? <ChevUp /> : <ChevDown />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 pt-3 pb-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{item.a}</p>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <span className="text-xs text-slate-400 dark:text-slate-500">Was this helpful?</span>
            <button onClick={() => onFeedback(item.id, true)}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-xl transition-colors ${
                fb === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
              <ThumbUp /> Yes
            </button>
            <button onClick={() => onFeedback(item.id, false)}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-xl transition-colors ${
                fb === false ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                             : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
              <ThumbDown /> No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Ticket detail (threaded conversation) ────────────────────────── */
function TicketDetail({ ticket, userId, staffName, onBack, onUpdate }) {
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
    Promise.all([
      supabase.from("ticket_messages").select("*").eq("ticket_id", ticket.id).order("created_at"),
      supabase.from("support_ticket_comments").select("*").eq("ticket_id", ticket.id).eq("is_internal", false).order("created_at"),
    ]).then(([{ data: msgs }, { data: adminComments }]) => {
      setMessages(msgs || []);
      setAdminMsgs(adminComments || []);
    });
  }, [ticket.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, adminMsgs]);

  const timeline = [
    { type: "initial", created_at: ticket.created_at, content: ticket.description, sender: staffName || "You" },
    ...(messages  || []).map(m => ({ ...m, type: "user_msg"  })),
    ...(adminMsgs || []).map(m => ({ ...m, type: "admin_msg" })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    const { data: msg } = await supabase.from("ticket_messages").insert({
      ticket_id: ticket.id, sender_type: "user", sender_id: userId,
      sender_name: staffName || "Staff", content: text,
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
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
          <ArrowLeft />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">{ticket.ticket_no}</span>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-sm font-bold text-slate-800 dark:text-white truncate mt-0.5">{ticket.subject}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {timeline.map((item, i) => {
          const isAdmin = item.type === "admin_msg";
          return (
            <div key={i} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[82%] rounded-2xl ${isAdmin ? "bg-slate-100 dark:bg-slate-800 rounded-tl-sm" : "rounded-tr-sm text-white"} px-4 py-3`}
                style={!isAdmin ? { backgroundColor: GK } : {}}>
                {isAdmin && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">{item.admin_username || "Support Team"}</p>}
                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isAdmin ? "text-slate-700 dark:text-slate-200" : "text-white"}`}>
                  {item.content || item.comment}
                </p>
                <p className={`text-[10px] mt-1.5 ${isAdmin ? "text-slate-400" : "text-white/60"}`}>
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
            <div className="flex gap-1">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setRating(n)}
                  className={`text-2xl transition-transform active:scale-110 ${n <= rating ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}`}>★</button>
              ))}
            </div>
            {rating > 0 && (
              <button onClick={submitRating} className="mt-3 text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-200 dark:bg-amber-800/40 px-4 py-2 rounded-xl active:scale-95 transition">
                Submit Rating
              </button>
            )}
          </div>
        )}
        {ratingDone && <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Thanks for your rating! ⭐</p>}

        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-4 py-3 flex flex-col gap-2">
        {canReopen && (
          <button onClick={reopen} disabled={reopening}
            className="w-full py-2.5 rounded-2xl border text-sm font-bold active:scale-[0.98] transition disabled:opacity-50 text-emerald-600 dark:text-emerald-400"
            style={{ borderColor: GK }}>
            {reopening ? "Reopening…" : "Reopen Ticket"}
          </button>
        )}
        {canReply && (
          <div className="flex items-end gap-2">
            <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply…" rows={2}
              className="flex-1 border border-slate-200 dark:border-slate-600 rounded-2xl px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} />
            <button onClick={sendReply} disabled={!reply.trim() || sending}
              className="flex-shrink-0 w-10 h-10 rounded-2xl text-white flex items-center justify-center active:scale-90 transition disabled:opacity-40"
              style={{ backgroundColor: GK }}>
              {sending ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <SendIcon />}
            </button>
          </div>
        )}
        {!canReply && !canReopen && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-1 capitalize">This ticket is {ticket.status}.</p>
        )}
      </div>
    </div>
  );
}

/* ── Create Ticket form ───────────────────────────────────────────── */
const TICKET_TYPES = [
  { value: "account",     label: "Account / Login" },
  { value: "payment",     label: "Payment / Billing" },
  { value: "transaction", label: "Transaction Issue" },
  { value: "technical",   label: "Technical Problem" },
  { value: "commission",  label: "Commission / Earnings" },
  { value: "access",      label: "Feature Access" },
  { value: "general",     label: "General Enquiry" },
];

function CreateTicket({ userId, staffName, staffEmail, onBack, onCreated }) {
  const [form,   setForm]   = useState({ subject: "", description: "", type: "general", priority: "medium" });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-2xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500";

  const submit = async () => {
    if (!form.subject.trim() || !form.description.trim()) { setError("Subject and description are required."); return; }
    setSaving(true); setError("");
    const { data: ticket, error: err } = await supabase.from("support_tickets").insert({
      user_id:     userId,
      user_email:  staffEmail || "",
      user_name:   staffName  || "Staff",
      subject:     form.subject.trim(),
      description: form.description.trim(),
      type:        form.type,
      priority:    form.priority,
      status:      "open",
    }).select().single();
    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    onCreated(ticket);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
          <ArrowLeft />
        </button>
        <h2 className="text-[17px] font-extrabold text-slate-800 dark:text-white">New Support Ticket</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 pb-6">
        {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Subject *</label>
          <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} placeholder="Brief description of your issue" className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
            <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} className={inputCls}>
              {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} className={inputCls}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Description *</label>
          <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
            placeholder="Describe your issue in detail. Include any error messages or steps that led to it."
            rows={5} className={`${inputCls} resize-none`} />
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl px-4 py-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Your ticket will be assigned a reference number. Our support team will respond within 24 hours.
        </div>

        <button onClick={submit} disabled={saving}
          className="w-full py-3.5 rounded-2xl text-white font-bold text-sm active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
          style={{ backgroundColor: GK }}>
          {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Submitting…</> : <><TicketIcon /> Submit Ticket</>}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN StaffHelp COMPONENT
══════════════════════════════════════════════════════════════════ */
export default function StaffHelp({ session, staff, onBack }) {
  const userId    = session?.user?.id;
  const staffName = staff?.full_name || "Staff";
  const staffEmail= staff?.email || session?.user?.email || "";

  const [tab,            setTab]            = useState("faq");
  const [search,         setSearch]         = useState("");
  const [expandedId,     setExpandedId]     = useState(null);
  const [feedback,       setFeedback]       = useState({});
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiAnswer,       setAiAnswer]       = useState("");
  const [tickets,        setTickets]        = useState([]);
  const [ticketLoading,  setTicketLoading]  = useState(false);
  const [ticketView,     setTicketView]     = useState("list");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [successTicket,  setSuccessTicket]  = useState(null);
  const aiReqId = useRef(0);

  /* AI search — debounced 600ms */
  useEffect(() => {
    if (search.trim().length < 3) { setAiAnswer(""); setAiLoading(false); return; }
    setAiLoading(true); setAiAnswer("");
    const timer = setTimeout(async () => {
      const reqId = ++aiReqId.current;
      try {
        const context = buildStaffAiContext();
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
  }, [search]);

  /* Load tickets */
  const loadTickets = useCallback(async () => {
    if (!userId) return;
    setTicketLoading(true);
    const { data } = await supabase.from("support_tickets").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    setTickets(data || []);
    setTicketLoading(false);
  }, [userId]);

  useEffect(() => { if (tab === "tickets") loadTickets(); }, [tab, loadTickets]);

  /* FAQ filtering */
  const q = search.toLowerCase();
  const filteredFAQ = STAFF_FAQS.map(cat => ({
    ...cat,
    items: cat.items.filter(item =>
      !q || item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
    ),
  })).filter(cat => cat.items.length > 0);

  const goToCreateTicket = () => { setTab("tickets"); setTicketView("create"); };

  const handleFeedback = (itemId, isHelpful) => {
    setFeedback(f => ({ ...f, [itemId]: isHelpful }));
  };

  /* ── Ticket sub-views ─────────────────────────────────────────── */
  if (tab === "tickets" && ticketView === "create") return (
    <div className="h-full flex flex-col">
      <CreateTicket userId={userId} staffName={staffName} staffEmail={staffEmail}
        onBack={() => setTicketView("list")}
        onCreated={(ticket) => { setTickets(t => [ticket, ...t]); setSuccessTicket(ticket); setTicketView("list"); }} />
    </div>
  );

  if (tab === "tickets" && ticketView === "detail" && selectedTicket) return (
    <div className="h-full flex flex-col">
      <TicketDetail
        ticket={selectedTicket} userId={userId} staffName={staffName}
        onBack={() => { setTicketView("list"); setSelectedTicket(null); }}
        onUpdate={loadTickets} />
    </div>
  );

  /* ── Main help view ───────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
          <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 text-[17px] font-extrabold text-slate-800 dark:text-slate-100 truncate">Help & Support</h1>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-4">
        {[{ key: "faq", label: "FAQs" }, { key: "tickets", label: "My Tickets" }].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${
              tab === key
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-400"
                : "border-transparent text-slate-400 dark:text-slate-500"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── FAQ tab ─────────────────────────────────────────────── */}
      {tab === "faq" && (
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          {/* AI-powered search bar */}
          <div className="relative mb-4">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 flex items-center gap-1 pointer-events-none">
              <SearchIco />
            </div>
            <div className="absolute left-9 top-1/2 -translate-y-1/2 pointer-events-none">
              <span className="text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded-md text-white" style={{ backgroundColor: GK }}>AI</span>
            </div>
            <input
              value={search} onChange={e => { setSearch(e.target.value); }}
              placeholder="Ask KudiAI anything about your portal…"
              className="w-full pl-[72px] pr-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-2xl text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            {search.length > 0 && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg leading-none">×</button>
            )}
          </div>

          {/* KudiAI answer */}
          <KudiAICard loading={aiLoading} answer={aiAnswer} onContactSupport={goToCreateTicket} />

          {/* FAQ accordion by category */}
          {filteredFAQ.length === 0 && search ? (
            <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">
              No FAQ matches — see KudiAI's answer above, or open a ticket below.
            </p>
          ) : (
            <div className="space-y-5">
              {filteredFAQ.map(cat => (
                <div key={cat.cat}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 px-1">{cat.cat}</p>
                  <div className="space-y-2">
                    {cat.items.map(item => (
                      <FaqItem key={item.id} item={item}
                        expanded={expandedId === item.id}
                        onToggle={id => setExpandedId(e => e === id ? null : id)}
                        feedback={feedback}
                        onFeedback={handleFeedback} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Still need help banner */}
          <div className="mt-6 rounded-3xl px-5 py-5 text-white bg-[linear-gradient(135deg,#059669,#065f46)]">
            <p className="font-extrabold text-base mb-1">Still need help?</p>
            <p className="text-sm text-white/75 mb-4 leading-relaxed">
              Our support team is ready. Create a ticket and we'll get back to you within 24 hours.
            </p>
            <button onClick={goToCreateTicket}
              className="flex items-center gap-2 bg-white font-bold text-sm px-4 py-2.5 rounded-2xl active:scale-95 transition"
              style={{ color: GK }}>
              <TicketIcon /> Contact Support
            </button>
          </div>
        </div>
      )}

      {/* ── My Tickets tab ──────────────────────────────────────── */}
      {tab === "tickets" && (
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
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

          <button onClick={() => setTicketView("create")}
            className="w-full flex items-center justify-center gap-2 py-3 mb-4 rounded-2xl border-2 border-dashed font-bold text-sm active:scale-[0.98] transition text-emerald-600 dark:text-emerald-400"
            style={{ borderColor: GK + "80" }}>
            <PlusIcon /> New Ticket
          </button>

          {ticketLoading
            ? [1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse mb-3" />)
            : tickets.length === 0
              ? <div className="text-center py-16">
                  <p className="text-5xl mb-4">🎟️</p>
                  <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-1">No tickets yet</p>
                  <p className="text-sm text-slate-400 dark:text-slate-500">Your support tickets will appear here.</p>
                </div>
              : <div className="space-y-3">
                  {tickets.map(t => (
                    <button key={t.id}
                      onClick={() => { setSelectedTicket(t); setTicketView("detail"); }}
                      className="w-full bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700 shadow-card text-left active:scale-[0.98] transition hover:shadow-md">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">{t.ticket_no}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 line-clamp-2">{t.subject}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{fmtDate(t.created_at)}</p>
                      {t.rating && <p className="text-xs text-amber-500 mt-1">{"★".repeat(t.rating)}{"☆".repeat(5 - t.rating)}</p>}
                    </button>
                  ))}
                </div>
          }
        </div>
      )}
    </div>
  );
}
