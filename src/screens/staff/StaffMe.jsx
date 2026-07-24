import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";
import Modal from "../../components/shared/Modal";
import { StaffActivityStatement } from "../../components/shared/Receipt";
import Insights from "../Insights";
import LegalScreen from "../LegalScreen";
import StaffHelp from "./StaffHelp";
import {
  Svg, P, GK, YEAR,
  SectionLabel, SettingsCard, Row, RowIcon,
  ChangePinModal,
} from "./StaffShared";
import TransactionPinModal from "../../components/TransactionPinModal";
import ForgotPinFlow from "../../components/ForgotPinFlow";
import ProfileEdit from "../../components/shared/ProfileEdit";
import NotificationPreferences from "../../components/NotificationPreferences";

/* ─ Inline profile display components — mirror business Profile.jsx */
function SectionCard({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-card border border-slate-100 dark:border-slate-700/50 overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/40">{children}</div>
    </div>
  );
}

function ProfileRow({ label, value, cap }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <p className="text-xs text-slate-400 dark:text-slate-500 w-28 flex-shrink-0 pt-0.5">{label}</p>
      {value
        ? <p className={`flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 break-words ${cap ? "capitalize" : ""}`}>{value}</p>
        : <p className="flex-1 text-sm text-slate-300 dark:text-slate-600 italic font-normal">Not set</p>
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ME TAB — redesigned to match business portal look and feel
══════════════════════════════════════════════════════════════════ */
export default function StaffMe({ staff, session, store, inventory, livePerms, staffId, pinLock, plan, initialView, onStaffUpdate }) {
  const [view,              setView]              = useState(initialView || "menu");
  const [isDark,            setIsDark]            = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [changingPin,  setChangingPin]  = useState(null);
  const [bioLoading,   setBioLoading]   = useState(false);
  const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);
  const [showStatement,     setShowStatement]     = useState(false);
  const [showReconcilePin,  setShowReconcilePin]  = useState(false);
  const [showForgotPin,     setShowForgotPin]     = useState(false);
  const [legalView,         setLegalView]         = useState(null); // "terms" | "privacy"
  const [showNotifPrefs,    setShowNotifPrefs]    = useState(false);
  const [acceptedConsent,   setAcceptedConsent]   = useState(null);
  /* D2: My Activity */
  const [activityLogs,    setActivityLogs]    = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  /* D4: My Commissions */
  const [commissions,  setCommissions]  = useState([]);
  const [commLoading,  setCommLoading]  = useState(false);

  /* D6: My Payments */
  const [disbursements,   setDisbursements]   = useState([]);
  const [disburseLoading, setDisburseLoading] = useState(false);

  /* D7: Close My Day */
  const [actualCash,      setActualCash]      = useState("");
  const [reconcileNote,   setReconcileNote]   = useState("");
  const [reconcileSaving, setReconcileSaving] = useState(false);
  const [reconcileMsg,    setReconcileMsg]    = useState("");

  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);

  /* Fetch user's accepted consent version for the Legal section */
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    supabase.from("user_consents").select("tnc_version, privacy_version, consented_at")
      .eq("user_id", uid).order("consented_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data) setAcceptedConsent(data); })
      .catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === "activity") {
      setActivityLogs([]); setActivityLoading(true);
      supabase.from("audit_logs").select("*").eq("staff_id", staffId)
        .order("created_at", { ascending: false }).limit(100)
        .then(({ data }) => { setActivityLogs(data || []); setActivityLoading(false); });
    }
    if (view === "commissions") {
      setCommissions([]); setCommLoading(true);
      supabase.from("commission_earnings")
        .select("*, transactions(item_name, transaction_date)")
        .eq("staff_id", staffId).order("earned_at", { ascending: false }).limit(100)
        .then(({ data }) => { setCommissions(data || []); setCommLoading(false); });
    }
    if (view === "payments") {
      setDisbursements([]); setDisburseLoading(true);
      supabase.from("staff_disbursements").select("*").eq("staff_id", staffId)
        .order("created_at", { ascending: false }).limit(100)
        .then(({ data }) => { setDisbursements(data || []); setDisburseLoading(false); });
    }
  }, [view, staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  /* ── Back-button sub-header — business portal style ── */
  const SubHeader = ({ title, onEdit }) => (
    <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
      <button onClick={() => setView("menu")}
        className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
        <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 className="flex-1 text-[17px] font-extrabold text-slate-800 dark:text-slate-100 truncate">{title}</h1>
      {onEdit && (
        <button onClick={onEdit}
          className="flex-shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-xl active:scale-95 transition">
          Edit
        </button>
      )}
    </div>
  );

  /* ── Toggle helper ── */
  const Toggle = ({ on, onToggle }) => (
    <button onClick={e => { e.stopPropagation(); onToggle(); }}
      className={`relative w-12 h-6 rounded-full flex-shrink-0 transition-colors duration-200 ${on ? "bg-emerald-600" : "bg-slate-200 dark:bg-slate-600"}`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: on ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );

  /* ── Spinner ── */
  const Spinner = () => (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GK, borderTopColor: "transparent" }} />
    </div>
  );

  /* ── Legal screens ── */
  if (legalView) return <LegalScreen type={legalView} onBack={() => setLegalView(null)} />;

  /* ── Help & Support (FAQs + My Tickets) ── */
  if (view === "help") return (
    <div className="h-full flex flex-col">
      <StaffHelp session={session} staff={staff} onBack={() => setView("menu")} />
    </div>
  );

  /* ── Reports — manager-only: row gated by insights.can_view (PERM-2);
     only reachable from the menu when livePerms allows it ── */
  if (view === "reports") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Reports & Insights" />
      <div className="flex-1 overflow-y-auto pb-4">
        <Insights store={store} inventory={inventory} plan={plan || "starter"} onUpgrade={null}
          onReports={() => {}} />
      </div>
    </div>
  );

  /* ── Profile view — mirrors business Profile.jsx ── */
  if (view === "profile") return (
    <div className="h-full flex flex-col">
      <SubHeader title="My Profile" onEdit={() => setView("edit")} />
      <div className="flex-1 overflow-y-auto pb-8">
        {/* Avatar hero */}
        <div className="flex flex-col items-center py-8 bg-gradient-to-b from-emerald-600/5 to-transparent">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg mb-3">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                  <span className="text-2xl font-black text-white">{initials}</span>
                </div>
            }
          </div>
          <p className="text-lg font-extrabold text-slate-800 dark:text-white">{staff?.full_name || "Staff"}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
            {(staff?.role || "staff member").replace(/_/g, " ")}
          </p>
          <span className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
            {staff?.business_name || "Staff Portal"}
          </span>
        </div>

        <div className="px-4">
          <SectionCard title="Personal Information">
            <ProfileRow label="Full Name" value={staff?.full_name} />
            <ProfileRow label="Email"     value={staff?.email || session?.user?.email} />
            <ProfileRow label="Phone"     value={staff?.phone} />
            <ProfileRow label="Address"   value={staff?.address} />
          </SectionCard>

          {(staff?.nok_name || staff?.nok_phone || staff?.nok_relationship) && (
            <SectionCard title="Next of Kin">
              <ProfileRow label="Name"         value={staff?.nok_name} />
              <ProfileRow label="Phone"        value={staff?.nok_phone} />
              <ProfileRow label="Relationship" value={staff?.nok_relationship} />
            </SectionCard>
          )}

          <SectionCard title="Employment">
            <ProfileRow label="Role"     value={(staff?.role || "").replace(/_/g, " ")} cap />
            <ProfileRow label="Business" value={staff?.business_name} />
            <ProfileRow label="Status"   value={staff?.status} cap />
            {staff?.shift_assignment && (
              <ProfileRow label="Shift" value={staff.shift_assignment} />
            )}
          </SectionCard>

          <SectionCard title="Account">
            <ProfileRow label="Portal"       value="Staff Portal" />
            <ProfileRow label="Member Since" value={
              staff?.created_at
                ? new Date(staff.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
                : null
            } />
          </SectionCard>
        </div>
      </div>
    </div>
  );

  /* ── Edit profile — shared ProfileEdit component ── */
  if (view === "edit") return (
    <ProfileEdit
      staff={staff}
      session={session}
      livePerms={livePerms}
      onBack={() => setView("profile")}
      onSaved={p => { onStaffUpdate?.(p); }}
    />
  );

  /* ── D2: My Activity ── */
  if (view === "activity") {
    const fmtTs = iso => iso ? new Date(iso).toLocaleString("en-NG", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "";
    return (
      <div className="h-full flex flex-col">
        <SubHeader title="My Activity" />
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 pb-6">
          {activityLoading
            ? <Spinner />
            : activityLogs.length === 0
              ? <p className="text-center text-sm text-slate-400 py-16">No activity recorded yet</p>
              : activityLogs.map(l => (
                  <div key={l.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{l.action}</p>
                        {l.details && <p className="text-xs text-slate-400 mt-0.5 italic">{l.details}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        {l.module && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-md capitalize">{l.module}</span>}
                        <p className="text-[10px] text-slate-400 mt-1">{fmtTs(l.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))
          }
        </div>
      </div>
    );
  }

  /* ── D4: My Commissions ── */
  if (view === "commissions") {
    const thisMonth  = new Date().toISOString().slice(0, 7);
    const pending    = commissions.filter(e => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0);
    const monthTotal = commissions.filter(e => e.status !== "voided" && (e.earned_at || "").startsWith(thisMonth)).reduce((s, e) => s + Number(e.amount), 0);
    const f = n => `₦${Number(n).toLocaleString()}`;
    return (
      <div className="h-full flex flex-col">
        <SubHeader title="My Commissions" />
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-6">
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[["This Month", f(monthTotal), "text-emerald-600 dark:text-emerald-400"], ["Pending Payout", f(pending), "text-slate-700 dark:text-slate-200"]].map(([l, v, c]) => (
              <div key={l} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">{l}</p>
                <p className={`text-xl font-extrabold tabular ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          {commLoading
            ? <Spinner />
            : commissions.length === 0
              ? <p className="text-center text-sm text-slate-400 py-12">No commission records found.<br/>Your manager may need to set up commission rules.</p>
              : <div className="space-y-2">
                  {commissions.map(e => (
                    <div key={e.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{e.transactions?.item_name || "Sale"}</p>
                        <p className="text-xs text-slate-400">{e.rate_percent}% of ₦{Number(e.basis_amount).toLocaleString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-extrabold tabular text-emerald-600 dark:text-emerald-400">₦{Number(e.amount).toLocaleString()}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md capitalize ${e.status === "paid" ? "bg-green-50 text-green-600" : e.status === "voided" ? "bg-red-50 text-red-400" : "bg-amber-50 text-amber-600"}`}>{e.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
          }
        </div>
      </div>
    );
  }

  /* ── D6: My Payments ── */
  if (view === "payments") {
    const total = disbursements.reduce((s, d) => s + Number(d.amount), 0);
    return (
      <div className="h-full flex flex-col">
        <SubHeader title="My Payments" />
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-6">
          {disbursements.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl px-5 py-4 border border-slate-100 dark:border-slate-700 mb-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Received</p>
              <p className="text-2xl font-extrabold tabular text-emerald-600 dark:text-emerald-400">₦{total.toLocaleString()}</p>
            </div>
          )}
          {disburseLoading
            ? <Spinner />
            : disbursements.length === 0
              ? <p className="text-center text-sm text-slate-400 py-16">No payments recorded yet</p>
              : <div className="space-y-2">
                  {disbursements.map(d => (
                    <div key={d.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 capitalize">{d.type}</p>
                        {d.notes && <p className="text-xs text-slate-400 truncate">{d.notes}</p>}
                        <p className="text-[11px] text-slate-400">{d.receipt_number}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-extrabold tabular text-emerald-600 dark:text-emerald-400">₦{Number(d.amount).toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400">{new Date(d.created_at).toLocaleDateString("en-NG", { day:"2-digit", month:"short", year:"numeric" })}</p>
                      </div>
                    </div>
                  ))}
                </div>
          }
        </div>
      </div>
    );
  }

  /* ── D7: Close My Day (Reconciliation) ── */
  if (view === "reconcile") {
    const ownerId     = store.profile?.id || staff?.owner_id;
    const todayStr    = new Date().toISOString().slice(0, 10);
    const todayTx     = (store.transactions || []).filter(tx => tx.transaction_date === todayStr);
    const expectedCash = todayTx.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0)
                       - todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);
    const discrepancy = Number(actualCash || 0) - expectedCash;

    /* PIN boundary: transaction PIN required before writing reconciliation record —
       attestation signature confirming the staff member's end-of-day declaration.
       Flow: submit button → TransactionPinModal → onApprove → submitReconciliation() */
    const submitReconciliation = async () => {
      if (!ownerId || !staffId) return;
      setReconcileSaving(true); setReconcileMsg("");
      const { error } = await supabase.from("reconciliations").upsert({
        owner_id: ownerId, staff_id: staffId, date: todayStr,
        expected_cash: expectedCash, actual_cash: Number(actualCash || 0),
        notes: reconcileNote || null,
        status: Math.abs(discrepancy) > 100 ? "flagged" : "submitted",
      }, { onConflict: "staff_id,date" });
      if (error) {
        setReconcileMsg("Failed: " + error.message);
      } else {
        setReconcileMsg(Math.abs(discrepancy) > 100 ? "Day closed — discrepancy flagged for review." : "Day closed successfully!");
        setTimeout(() => { setView("menu"); setReconcileMsg(""); setActualCash(""); setReconcileNote(""); }, 2000);
      }
      setReconcileSaving(false);
    };

    return (
      <div className="h-full flex flex-col">
        <SubHeader title="Close My Day" />
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="h-1.5 bg-[linear-gradient(90deg,#3DA829,#2E8020)]" />
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Expected Cash</p>
                <p className="text-xl font-extrabold tabular text-emerald-600 dark:text-emerald-400">₦{expectedCash.toLocaleString()}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{todayTx.length} transactions today</p>
              </div>
              {actualCash !== "" && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Discrepancy</p>
                  <p className={`text-xl font-extrabold tabular ${Math.abs(discrepancy) > 100 ? "text-red-500" : "text-green-500"}`}>
                    {discrepancy >= 0 ? "+" : ""}₦{discrepancy.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Cash at Hand (₦)</p>
            <input type="number" min="0" placeholder="Enter actual cash amount" value={actualCash} onChange={e => setActualCash(e.target.value)}
              className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Notes (optional)</p>
            <input type="text" placeholder="Any remarks for today" value={reconcileNote} onChange={e => setReconcileNote(e.target.value)}
              className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          {reconcileMsg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${reconcileMsg.includes("Failed") ? "bg-red-50 text-red-600" : ""}`}
              style={!reconcileMsg.includes("Failed") ? { backgroundColor: "#ecfdf5", color: GK } : {}}>
              <p className="text-sm font-semibold">{reconcileMsg}</p>
            </div>
          )}
          <button onClick={() => setShowReconcilePin(true)} disabled={reconcileSaving || !actualCash}
            className="w-full h-12 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50"
            style={{ backgroundColor: GK }}>
            {reconcileSaving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {reconcileSaving ? "Closing…" : "Close My Day"}
          </button>
        </div>
        {showReconcilePin && (
          <TransactionPinModal
            title="Confirm Close My Day"
            onApprove={() => { setShowReconcilePin(false); submitReconciliation(); }}
            onCancel={() => setShowReconcilePin(false)}
          />
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     MAIN ME MENU
  ══════════════════════════════════════════════════════════════════ */
  return (
    <div className="h-full overflow-y-auto pb-6">

      {/* Profile card — business portal style (flat rounded-3xl card) */}
      <div className="mt-4 mx-4 mb-5 bg-white dark:bg-slate-800 rounded-3xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-slate-100 dark:border-slate-700">
          {staff?.profile_image_url
            ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                <span className="text-xl font-black text-white">{initials}</span>
              </div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-extrabold text-slate-800 dark:text-white truncate">{staff?.full_name || "Staff"}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 capitalize">
            {(staff?.role || "staff member").replace(/_/g, " ")}
          </p>
          <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
            {staff?.business_name || "Staff Portal"}
          </span>
        </div>
        <button onClick={() => setView("profile")}
          className="flex-shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-xl active:scale-95 transition">
          View
        </button>
      </div>

      {/* Account */}
      <div className="px-4 mb-5">
        <SectionLabel>Account</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.person} />} label="My Profile"           sub="View and edit your profile"             onClick={() => setView("profile")} />
          {livePerms.find(p => p.module === "insights")?.can_view && (
            <Row icon={<RowIcon d={P.report} />} label="Reports & Insights" sub="View your performance analytics" onClick={() => setView("reports")} />
          )}
          <Row icon={<RowIcon d={P.doc} />}    label="Activity Statement"   sub="Generate & share your statement"        onClick={() => setShowStatement(true)} />
          <Row icon={<RowIcon d={P.doc} />}    label="My Activity"          sub="Your action log and history"            onClick={() => setView("activity")} />
          <Row icon={<RowIcon d={P.credit} />} label="My Commissions"       sub="Commission earnings breakdown"          onClick={() => setView("commissions")} />
          <Row icon={<RowIcon d={P.in} />}     label="My Payments"          sub="Salary and disbursement history"        onClick={() => setView("payments")} />
          <Row icon={<RowIcon d={P.check} />}  label="Close My Day"         sub="Submit end-of-day cash reconciliation"  onClick={() => setView("reconcile")} />
        </SettingsCard>
      </div>

      {/* Security */}
      <div className="px-4 mb-5">
        <SectionLabel>Security</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.lock} />}   label="App Lock PIN"        sub="Change your 6-digit unlock PIN"  onClick={() => setChangingPin("app")} />
          <Row icon={<RowIcon d={P.shield} />} label="Transaction PIN"     sub="Change your 4-digit payment PIN" onClick={() => setChangingPin("txn")} />
          {pinLock.biometricAvailable && (
            <Row
              icon={<RowIcon d={P.finger} />}
              label="Face / Fingerprint"
              sub={pinLock.biometricEnabled ? "Enabled — tap to disable" : "Tap to enable biometric unlock"}
              onClick={async () => {
                setBioLoading(true);
                if (pinLock.biometricEnabled) await pinLock.disableBiometric();
                else await pinLock.registerBiometric();
                setBioLoading(false);
              }}
              right={
                bioLoading
                  ? <div className="w-5 h-5 rounded-full animate-spin border-2"
                      style={{ borderColor: GK, borderTopColor: "transparent" }} />
                  : <Toggle on={pinLock.biometricEnabled} onToggle={async () => {
                      setBioLoading(true);
                      if (pinLock.biometricEnabled) await pinLock.disableBiometric();
                      else await pinLock.registerBiometric();
                      setBioLoading(false);
                    }} />
              }
            />
          )}
          <Row
            icon={<RowIcon d={P.shield} />}
            label="Auto-lock"
            sub={({ 0:"Never", 60:"1 minute", 300:"5 minutes", 900:"15 minutes", 1800:"30 minutes" })[pinLock.autoLockTimeout] || `${Math.round(pinLock.autoLockTimeout / 60)} min`}
            onClick={() => setShowTimeoutPicker(true)}
          />
        </SettingsCard>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-5">
        <SectionLabel>Preferences</SectionLabel>
        <SettingsCard>
          <Row
            icon={<RowIcon d={isDark ? P.moon : P.sun} />}
            label="Dark Mode"
            onClick={toggleDark}
            right={<Toggle on={isDark} onToggle={toggleDark} />}
          />
          <Row
            icon={<RowIcon d={P.bell} />}
            label="Notifications"
            sub="Manage push and in-app notification settings"
            onClick={() => setShowNotifPrefs(true)}
          />
        </SettingsCard>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-5">
        <SectionLabel>Help & Support</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.faq} />}  label="FAQs & My Tickets" sub="Browse staff FAQs and manage support tickets" onClick={() => setView("help")} />
          <Row icon={<RowIcon d={P.help} />} label="Contact Support"   sub="Submit a support ticket directly"              onClick={() => setView("help")} />
        </SettingsCard>
      </div>

      {/* Legal */}
      <div className="px-4 mb-5">
        <SectionLabel>Legal</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.doc} />} label="Terms & Conditions" sub="Last updated 1 July 2026"   onClick={() => setLegalView("terms")} />
          <Row icon={<RowIcon d={P.doc} />} label="Privacy Policy"     sub="NDPA 2023 compliant"         onClick={() => setLegalView("privacy")} />
          {acceptedConsent && (
            <Row
              icon={<RowIcon d={P.doc} />}
              label="Your Accepted Version"
              sub={`T&C v${acceptedConsent.tnc_version} · Privacy v${acceptedConsent.privacy_version} · ${new Date(acceptedConsent.consented_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
              right={null}
            />
          )}
        </SettingsCard>
      </div>

      {/* Sign Out */}
      <div className="px-4 mb-4">
        <button onClick={() => supabase.auth.signOut()}
          className="w-full py-[15px] bg-red-50 dark:bg-red-950/30 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors flex items-center justify-center gap-2.5 text-red-500 dark:text-red-400 active:scale-[0.99]">
          <Svg d={P.out2} size={18} color="currentColor" />
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="text-center py-2 px-8 space-y-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">KudiAI Track · Staff Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">Powered by AMAYA & Co. Technologies<br />All rights reserved © {YEAR}</p>
      </div>

      {/* Modals */}
      {changingPin && (
        <ChangePinModal
          mode={changingPin}
          onClose={() => setChangingPin(null)}
          onForgotPin={() => { setChangingPin(null); setShowForgotPin(true); }}
          onDone={async (current, newP) => {
            await (changingPin === "app" ? pinLock.changeAppPin : pinLock.changeTxnPin)(current, newP);
          }}
        />
      )}
      {showForgotPin && (
        <ForgotPinFlow pinLock={pinLock} onCancel={() => setShowForgotPin(false)} />
      )}
      {showTimeoutPicker && (
        <Modal title="Auto-lock Timeout" onClose={() => setShowTimeoutPicker(false)}>
          <div className="space-y-2 py-2">
            {[[0,"Never"],[60,"1 minute"],[300,"5 minutes (recommended)"],[900,"15 minutes"],[1800,"30 minutes"]].map(([v, l]) => (
              <button key={v}
                onClick={async () => { await pinLock.updateSettings({ autoLockTimeout: v }); setShowTimeoutPicker(false); }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition text-sm font-semibold ${
                  pinLock.autoLockTimeout === v ? "text-white" : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                }`}
                style={pinLock.autoLockTimeout === v ? { backgroundColor: "#3DA829" } : {}}>
                {l}
                {pinLock.autoLockTimeout === v && <Svg d={P.check} size={16} color="#fff" sw={2.5} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {showStatement && (
        <StaffActivityStatement store={store} staffName={staff?.full_name} businessName={staff?.business_name || store.profile?.business_name} onClose={() => setShowStatement(false)} />
      )}
      {showNotifPrefs && (
        <NotificationPreferences userId={session?.user?.id} portal="staff" onClose={() => setShowNotifPrefs(false)} />
      )}
    </div>
  );
}
