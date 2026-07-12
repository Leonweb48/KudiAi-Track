import { useState, useMemo } from "react";
import TransactionPinModal from "./TransactionPinModal";

const fmtCur = (n) =>
  `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function displayName(name = "", showFull) {
  if (showFull) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.slice(0, 2).toUpperCase() + ".";
  return parts[0] + " " + parts[parts.length - 1][0].toUpperCase() + ".";
}

const STATUS_BADGE = {
  current:  { cls: "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300", label: "Current" },
  upcoming: { cls: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300",        label: "Upcoming" },
  paid:     { cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",     label: "Paid" },
  skipped:  { cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",     label: "Skipped" },
};

function Badge({ status }) {
  const b = STATUS_BADGE[status] || STATUS_BADGE.upcoming;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${b.cls}`}>
      {b.label}
    </span>
  );
}

function Spin() {
  return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ── Setup view ─────────────────────────────────────────────────────────────
// Used before a round exists. Owner drags-to-order members and sets dates.
function SetupView({ members = [], loading, onStart }) {
  const [order,   setOrder]   = useState(members.map(m => m.id));
  const [dates,   setDates]   = useState({});
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  const memberMap = useMemo(() => {
    const m = {};
    members.forEach(mb => { m[mb.id] = mb; });
    return m;
  }, [members]);

  const move = (idx, dir) => {
    const next = [...order];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOrder(next);
  };

  const handleStart = async () => {
    if (order.length === 0) { setErr("Add members to the group first"); return; }
    setSaving(true); setErr("");
    try {
      const turns = order.map(id => ({
        client_id:            id,
        expected_payout_date: dates[id] || null,
      }));
      await onStart(turns);
    } catch (e) {
      setErr(e.message || "Failed to start round");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin />;

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 gap-2 text-center px-4">
        <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-slate-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No members assigned yet</p>
        <p className="text-xs text-slate-400">Assign clients to this group first, then start a round.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/40 rounded-2xl px-4 py-3">
        <p className="text-[11px] text-violet-700 dark:text-violet-300 font-medium leading-relaxed">
          Set the rotation order below. Position 1 collects first. Once started, changes require your PIN.
        </p>
      </div>

      {err && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl">{err}</p>
      )}

      <div className="space-y-2">
        {order.map((id, idx) => {
          const mb = memberMap[id];
          if (!mb) return null;
          return (
            <div key={id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-3 py-3 flex items-center gap-3">
              <span className="w-6 h-6 flex-shrink-0 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 rounded-full text-[11px] font-black flex items-center justify-center">
                {idx + 1}
              </span>

              <div className="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center">
                <span className="text-[10px] font-black text-white">{initials(mb.display_name)}</span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{mb.display_name}</p>
                <input
                  type="date"
                  value={dates[id] || ""}
                  onChange={e => setDates(d => ({ ...d, [id]: e.target.value }))}
                  className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 bg-transparent border-none outline-none w-full"
                  placeholder="Expected payout date (optional)"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(idx, -1)} disabled={idx === 0}
                  className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 disabled:opacity-30 text-slate-500 flex items-center justify-center transition active:scale-90">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 15l-6-6-6 6" /></svg>
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1}
                  className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 disabled:opacity-30 text-slate-500 flex items-center justify-center transition active:scale-90">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleStart}
        disabled={saving || members.length === 0}
        className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-2xl font-bold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2">
        {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {saving ? "Starting Round…" : "Start Round 1"}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function EsusuRotationDashboard({
  data,
  loading,
  isOwner,
  myClientId,
  onRefresh,
  onStartRound,
  onExecutePayout,
  onSkipTurn,
  onReorderTurns,
  onCloseRound,
}) {
  const [pinFor,       setPinFor]       = useState(null); // { action, turnId?, roundId? }
  const [skipDialog,   setSkipDialog]   = useState(null); // { turnId }
  const [skipReason,   setSkipReason]   = useState("");
  const [skipToEnd,    setSkipToEnd]    = useState(true);
  const [reorderMode,  setReorderMode]  = useState(false);
  const [reorderQueue, setReorderQueue] = useState(null); // prepared new order
  const [actionErr,    setActionErr]    = useState("");
  const [closingRound, setClosingRound] = useState(false);
  const [closeResult,  setCloseResult]  = useState(null);

  const { group = null, round = null, turns = [], members = [], contribution_ticks = {}, pot_size = 0 } = data || {};
  const showNames = isOwner || (group?.privacy_show_names !== false);

  const currentTurn  = useMemo(() => turns.find(t => t.status === "current"),  [turns]);
  const upcomingCount = useMemo(() => turns.filter(t => t.status === "upcoming").length, [turns]);
  const paidCount     = useMemo(() => turns.filter(t => t.status === "paid").length,     [turns]);

  const handlePin = async (pin) => {
    if (!pinFor) return;
    setActionErr("");
    try {
      if (pinFor.action === "payout") {
        await onExecutePayout(pinFor.turnId, pin);
        onRefresh?.();
      } else if (pinFor.action === "skip") {
        await onSkipTurn(pinFor.turnId, skipReason, skipToEnd, pin);
        setSkipDialog(null); setSkipReason("");
        onRefresh?.();
      } else if (pinFor.action === "reorder") {
        await onReorderTurns(round.id, reorderQueue, pin);
        setReorderMode(false); setReorderQueue(null);
        onRefresh?.();
      }
    } catch (e) {
      setActionErr(e.message || "Action failed");
    } finally {
      setPinFor(null);
    }
  };

  const handleCloseRound = async () => {
    if (!window.confirm("Close this round? Any unpaid turns will be marked skipped.")) return;
    setClosingRound(true); setActionErr("");
    try {
      const result = await onCloseRound(round.id);
      setCloseResult(result);
      onRefresh?.();
    } catch (e) {
      setActionErr(e.message || "Failed to close round");
    } finally {
      setClosingRound(false);
    }
  };

  // ReorderView state — inline in active round
  const [localOrder, setLocalOrder] = useState(null);
  const startReorder = () => {
    const upcoming = turns.filter(t => t.status === "upcoming").sort((a, b) => a.position - b.position);
    setLocalOrder(upcoming.map(t => t.id));
    setReorderMode(true);
  };
  const moveLocal = (idx, dir) => {
    if (!localOrder) return;
    const next = [...localOrder];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setLocalOrder(next);
  };
  const confirmReorder = () => {
    const currentMaxPos = currentTurn ? currentTurn.position : 0;
    const newOrder = (localOrder || []).map((tid, i) => ({
      turn_id:  tid,
      position: currentMaxPos + i + 1,
    }));
    setReorderQueue(newOrder);
    setPinFor({ action: "reorder" });
  };

  if (loading) return <Spin />;
  if (!group) return null;

  // Closed round summary
  if (closeResult) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center px-4">
        <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <p className="text-base font-black text-slate-800 dark:text-white">Round Closed</p>
        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 w-full space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Total paid out</span>
            <span className="font-bold text-slate-800 dark:text-white">{fmtCur(closeResult.total_paid)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Turns skipped</span>
            <span className="font-bold text-slate-800 dark:text-white">{closeResult.skipped_count ?? 0}</span>
          </div>
        </div>
        <button onClick={onRefresh} className="w-full py-3 bg-violet-600 text-white rounded-2xl font-bold text-sm transition active:scale-[0.99]">
          Done
        </button>
      </div>
    );
  }

  // No active round → setup view (owner) or "no active round" (member)
  if (!round) {
    if (!isOwner) {
      return (
        <div className="flex flex-col items-center py-8 gap-2 text-center px-4">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No active round</p>
          <p className="text-xs text-slate-400">Your savings group doesn't have an active rotation round yet.</p>
        </div>
      );
    }
    return (
      <SetupView
        members={members}
        loading={false}
        onStart={onStartRound}
      />
    );
  }

  // ── Active round view ──────────────────────────────────────────────────
  const roundProgress = `${paidCount} of ${turns.filter(t => t.status !== "skipped").length + paidCount} paid`;

  return (
    <>
      {/* Pot + ticks panel */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Round {round.round_number} · {roundProgress}</p>
          {isOwner && (
            <span className="text-[10px] text-violet-600 dark:text-violet-400 font-bold">
              {round.status === "active" ? "Active" : "Closed"}
            </span>
          )}
        </div>

        {/* Pot size */}
        <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-900/20 rounded-xl px-4 py-3">
          <div>
            <p className="text-[11px] text-violet-500 font-semibold">Current pot</p>
            <p className="text-xl font-black text-violet-700 dark:text-violet-300">{fmtCur(pot_size)}</p>
          </div>
          {currentTurn && (
            <div className="text-right">
              <p className="text-[10px] text-slate-400">Collecting now</p>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {displayName(currentTurn.client_name, showNames)}
              </p>
              {currentTurn.expected_payout_date && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Due {new Date(currentTurn.expected_payout_date).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Contribution ticks */}
        {Object.keys(contribution_ticks).length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">This period</p>
            <div className="flex flex-wrap gap-2">
              {members.map(mb => {
                const hasPaid = contribution_ticks[mb.id];
                const isMe    = mb.id === myClientId;
                return (
                  <div key={mb.id} title={displayName(mb.display_name, showNames)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition
                      ${isMe ? "ring-2 ring-violet-500 ring-offset-1" : ""}
                      ${hasPaid
                        ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300"
                        : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-400"
                      }`}>
                    <span>{hasPaid ? "✓" : "·"}</span>
                    <span>{displayName(mb.display_name, showNames)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {actionErr && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl">{actionErr}</p>
      )}

      {/* Reorder mode */}
      {isOwner && reorderMode && localOrder && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Reordering upcoming turns — requires PIN</p>
          {localOrder.map((tid, idx) => {
            const t = turns.find(x => x.id === tid);
            if (!t) return null;
            return (
              <div key={tid} className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5">
                <span className="text-[10px] font-black text-amber-600 w-4">{idx + 1}</span>
                <p className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{displayName(t.client_name, true)}</p>
                <button onClick={() => moveLocal(idx, -1)} disabled={idx === 0}
                  className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 disabled:opacity-30 flex items-center justify-center transition active:scale-90">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 15l-6-6-6 6" /></svg>
                </button>
                <button onClick={() => moveLocal(idx, 1)} disabled={idx === localOrder.length - 1}
                  className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 disabled:opacity-30 flex items-center justify-center transition active:scale-90">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button onClick={() => { setReorderMode(false); setLocalOrder(null); }}
              className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs transition">
              Cancel
            </button>
            <button onClick={confirmReorder}
              className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-bold text-xs transition active:scale-[0.99]">
              Confirm (PIN required)
            </button>
          </div>
        </div>
      )}

      {/* Turn list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Rotation Order</p>
          {isOwner && upcomingCount > 1 && !reorderMode && (
            <button onClick={startReorder}
              className="text-[10px] font-bold text-violet-600 dark:text-violet-400 px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 transition active:scale-95">
              Reorder Remaining
            </button>
          )}
        </div>

        {turns.map(turn => {
          const isMine   = turn.client_id === myClientId;
          const isCurrent = turn.status === "current";
          const isUpcoming = turn.status === "upcoming";
          return (
            <div key={turn.id}
              className={`rounded-2xl border px-4 py-3 transition
                ${isCurrent ? "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700"}
                ${isMine ? "ring-1 ring-violet-400 dark:ring-violet-500" : ""}`}>
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-black
                  ${isCurrent ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}>
                  {turn.position}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                      {displayName(turn.client_name, showNames)}
                      {isMine && <span className="ml-1 text-[10px] font-semibold text-violet-500">(You)</span>}
                    </p>
                    <Badge status={turn.status} />
                  </div>
                  {turn.expected_payout_date && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Expected: {new Date(turn.expected_payout_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                  {turn.status === "paid" && turn.payout_contribution_id && (
                    <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5 font-semibold">Pot paid out ✓</p>
                  )}
                  {turn.status === "skipped" && turn.skip_reason && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Skipped: {turn.skip_reason}</p>
                  )}
                </div>

                {/* Owner action buttons */}
                {isOwner && isCurrent && onExecutePayout && (
                  <button
                    onClick={() => { setActionErr(""); setPinFor({ action: "payout", turnId: turn.id }); }}
                    className="flex-shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-[11px] transition active:scale-95 whitespace-nowrap">
                    Pay Out
                  </button>
                )}
                {isOwner && isUpcoming && onSkipTurn && (
                  <button
                    onClick={() => { setSkipDialog({ turnId: turn.id }); setSkipReason(""); setSkipToEnd(true); }}
                    className="flex-shrink-0 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 rounded-xl font-bold text-[10px] transition active:scale-95">
                    Skip
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Skip dialog */}
      {skipDialog && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-amber-200 dark:border-amber-800/40 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800 dark:text-white">Skip this turn?</p>
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Reason *</label>
            <input
              type="text"
              value={skipReason}
              onChange={e => setSkipReason(e.target.value)}
              placeholder="e.g. Member could not participate"
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSkipToEnd(true)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${skipToEnd ? "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300" : "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500"}`}>
              Move to end
            </button>
            <button
              onClick={() => setSkipToEnd(false)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${!skipToEnd ? "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300" : "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500"}`}>
              Remove from round
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSkipDialog(null)}
              className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs transition">
              Cancel
            </button>
            <button
              disabled={!skipReason.trim()}
              onClick={() => { if (!skipReason.trim()) return; setPinFor({ action: "skip", turnId: skipDialog.turnId }); }}
              className="flex-1 py-2 bg-amber-600 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition active:scale-[0.99]">
              Confirm (PIN)
            </button>
          </div>
        </div>
      )}

      {/* Close round button */}
      {isOwner && onCloseRound && (
        <button
          onClick={handleCloseRound}
          disabled={closingRound}
          className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 rounded-2xl font-bold text-sm transition hover:border-red-300 hover:text-red-500 dark:hover:border-red-700 dark:hover:text-red-400 active:scale-[0.99]">
          {closingRound ? "Closing…" : "Close Round"}
        </button>
      )}

      {/* PIN modal */}
      {pinFor && (
        <TransactionPinModal
          title={
            pinFor.action === "payout"  ? "Confirm Payout" :
            pinFor.action === "skip"    ? "Confirm Skip" :
            "Confirm Reorder"
          }
          onConfirm={handlePin}
          onCancel={() => { setPinFor(null); setActionErr(""); }}
        />
      )}
    </>
  );
}
