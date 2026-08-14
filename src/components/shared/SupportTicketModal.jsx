/**
 * Reusable support ticket bottom-sheet.
 * Pre-fills subject and description from the calling context; user can edit before submitting.
 * Gets the current session from Supabase directly — no auth props required.
 *
 * Props:
 *   isOpen      — boolean
 *   onClose     — () => void
 *   subject     — string  (pre-filled, editable)
 *   description — string  (pre-filled, editable)
 *   type        — string  ticket category default (default: "payment")
 *   priority    — string  ticket priority default (default: "high")
 */
import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";
import { friendlyError } from "../../utils/errorMessage";

const TICKET_TYPES = ["payment", "general", "account", "technical", "ajo", "subscription", "invoice", "other"];
const PRIORITIES   = ["low", "medium", "high"];

const inputCls = "w-full border border-slate-200 dark:border-slate-600 rounded-2xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function SupportTicketModal({
  isOpen,
  onClose,
  subject:     initSubject     = "",
  description: initDescription = "",
  type:        initType        = "payment",
  priority:    initPriority    = "high",
}) {
  const [authUser, setAuthUser] = useState(null);
  const [form,    setForm]    = useState({ subject: initSubject, description: initDescription, type: initType, priority: initPriority });
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState("");

  // Re-sync form only when the modal opens/closes — intentionally omit init* props
  // from the dep array so the form is not reset on every parent re-render.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ subject: initSubject, description: initDescription, type: initType, priority: initPriority });
    setDone(false);
    setError("");
    supabase.auth.getUser().then(({ data }) => setAuthUser(data?.user || null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function submit() {
    if (!form.subject.trim() || !form.description.trim()) {
      setError("Subject and description are required.");
      return;
    }
    setSaving(true);
    setError("");

    // Try to get user's display name from the businesses table
    let userName = "";
    if (authUser?.id) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("owner_name, business_name")
        .eq("user_id", authUser.id)
        .maybeSingle();
      userName = biz?.owner_name || biz?.business_name || "";
    }

    const { data: ticket, error: err } = await supabase.from("support_tickets").insert({
      user_id:     authUser?.id    || null,
      user_email:  authUser?.email || "",
      user_name:   userName,
      subject:     form.subject.trim(),
      description: form.description.trim(),
      type:        form.type,
      priority:    form.priority,
      status:      "open",
    }).select().single();

    setSaving(false);
    if (err) { setError(friendlyError(err)); return; }

    // Notify support admins via edge function proxy (secret stays server-side)
    supabase.functions.invoke("notify-admin", {
      body: {
        event: "support_ticket_admin_notify",
        data: {
          ticket_id:   ticket?.id            || "",
          ticket_no:   ticket?.ticket_number || ticket?.ticket_no || "",
          subject:     form.subject.trim(),
          priority:    form.priority,
          description: form.description.trim(),
          user_name:   userName,
          user_email:  authUser?.email       || "",
        },
      },
    }).catch(() => null);

    setDone(true);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "92dvh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-blue-600 dark:text-blue-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-base font-bold text-slate-800 dark:text-white">Report an Issue</p>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-transform"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {done ? (
          /* ── Success state ── */
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-5 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-emerald-600 dark:text-emerald-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-slate-800 dark:text-white">Ticket Submitted</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">
                Our support team has received your report and will respond within 24 hours.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-10 py-3 rounded-2xl text-white font-bold text-sm active:scale-[0.98] transition-transform shadow-lg bg-[linear-gradient(135deg,#16a34a,#059669)]"
            >
              Done
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-4 space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Subject</label>
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
                    {TICKET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Full Details
                  <span className="ml-1 font-normal text-slate-400">(auto-filled — you can add more)</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={10}
                  className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl px-4 py-3 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                Transaction references are included automatically so our team can trace your payment without you having to look them up.
              </div>

              <button
                onClick={submit}
                disabled={saving}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg bg-[linear-gradient(135deg,#1d4ed8,#2563eb)]"
                style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))" }}
              >
                {saving
                  ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Submitting…</>
                  : <>
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                      Submit Ticket
                    </>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
