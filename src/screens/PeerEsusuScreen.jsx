import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";
import Icon from "../components/Icon";
import { BottomSheet } from "../components/WalletPanel";
import { friendlyError } from "../utils/errorMessages";

async function peerEsusuFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("peer-esusu", { body: { action, ...body } });
  if (error) {
    let msg = error.message || "Request failed";
    try {
      const errBody = await error.context?.json?.();
      if (errBody?.error) msg = errBody.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const FREQUENCIES = [
  { id: "daily",   label: "Daily"   },
  { id: "weekly",  label: "Weekly"  },
  { id: "monthly", label: "Monthly" },
  { id: "custom",  label: "Custom"  },
];

/* ── Create Circle sheet ──────────────────────────────────────────────── */
function CreateCircleSheet({ onClose, onCreated }) {
  const [name,       setName]       = useState("");
  const [amount,     setAmount]     = useState("");
  const [frequency,  setFrequency]  = useState("monthly");
  const [customDays, setCustomDays] = useState("");
  const [slots,      setSlots]      = useState("1");
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState("");

  const create = async () => {
    if (!name.trim())            { setErr("Give your circle a name"); return; }
    if (!(Number(amount) > 0))   { setErr("Enter a contribution amount"); return; }
    if (frequency === "custom" && !(Number(customDays) > 0)) { setErr("Enter how many days between rotations"); return; }
    setSaving(true); setErr("");
    try {
      const res = await peerEsusuFn("create-group", {
        name: name.trim(), contribution_amount: Number(amount), frequency,
        custom_interval_days: frequency === "custom" ? Number(customDays) : undefined,
        payout_slots_per_round: Number(slots) || 1,
      });
      onCreated(res.group_id);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title="Create an Esusu circle">
      <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
        You'll be the first member — invite others once it's created.
      </p>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

      <div className="space-y-3">
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Circle name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Circle"
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Contribution per rotation</label>
          <div className="flex items-center gap-2 mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60">
            <span className="text-[15px] font-black text-brand-600 dark:text-brand-300">₦</span>
            <input type="number" inputMode="decimal" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
              className="flex-1 bg-transparent text-[14px] font-semibold text-slate-900 dark:text-slate-50 outline-none placeholder:font-normal placeholder:text-slate-400 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">How often</label>
          <div className="flex gap-2 mt-1.5">
            {FREQUENCIES.map(f => (
              <button key={f.id} type="button" onClick={() => setFrequency(f.id)}
                className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-transform active:scale-[0.98] ${
                  frequency === f.id ? "bg-brand-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          {frequency === "custom" && (
            <input type="number" inputMode="numeric" min="1" value={customDays} onChange={e => setCustomDays(e.target.value)}
              placeholder="Days between rotations"
              className="w-full mt-2 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
          )}
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            Winners per rotation <span className="text-slate-300 font-normal">1 = one person collects each round</span>
          </label>
          <input type="number" inputMode="numeric" min="1" value={slots} onChange={e => setSlots(e.target.value)}
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold outline-none focus:border-brand-400" />
        </div>
      </div>

      <button onClick={create} disabled={saving}
        className="w-full mt-5 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
        {saving ? "Creating…" : "Create circle"}
      </button>
    </BottomSheet>
  );
}

/* ── Search & Invite sheet ────────────────────────────────────────────── */
function InviteMemberSheet({ groupId, onClose, onInvited }) {
  const [acctNo,    setAcctNo]    = useState("");
  const [searching, setSearching] = useState(false);
  const [result,    setResult]    = useState(null); // { found, user_id, display_name }
  const [err,       setErr]       = useState("");
  const [inviting,  setInviting]  = useState(false);

  const search = async () => {
    if (!/^\d{10}$/.test(acctNo)) { setErr("Enter a 10-digit wallet account number"); return; }
    setSearching(true); setErr(""); setResult(null);
    try {
      const res = await peerEsusuFn("search-wallet-user", { account_number: acctNo });
      if (!res.found) { setErr(res.error || "No active KudiAI wallet found for that number"); return; }
      setResult(res);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSearching(false);
    }
  };

  const invite = async () => {
    if (!result) return;
    setInviting(true); setErr("");
    try {
      await peerEsusuFn("invite-member", { group_id: groupId, invitee_user_id: result.user_id });
      onInvited();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setInviting(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title="Invite a member">
      <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
        Enter their KudiAI wallet account number — anyone with an active wallet can be invited, whichever business they're a client of.
      </p>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

      <div className="flex gap-2">
        <input type="text" inputMode="numeric" maxLength={10} value={acctNo}
          onChange={e => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setResult(null); }}
          placeholder="10-digit wallet account number"
          className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
        <button onClick={search} disabled={searching || acctNo.length !== 10}
          className="px-5 rounded-2xl bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm font-bold disabled:opacity-40">
          {searching ? "…" : "Search"}
        </button>
      </div>

      {result?.found && (
        <div className="mt-4 flex items-center gap-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-3.5">
          <div className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center font-extrabold flex-shrink-0">
            {(result.display_name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{result.display_name}</p>
            <p className="text-[11px] text-slate-400">Wallet {acctNo}</p>
          </div>
        </div>
      )}

      <button onClick={invite} disabled={!result?.found || inviting}
        className="w-full mt-5 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
        {inviting ? "Sending invite…" : "Send invite"}
      </button>
    </BottomSheet>
  );
}

/* ── Circle detail ────────────────────────────────────────────────────── */
function CircleDetail({ groupId, myUserId, onClose, onChanged }) {
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState("");
  const [order,    setOrder]    = useState([]); // local reorder buffer while forming

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await peerEsusuFn("get-group-detail", { group_id: groupId });
      setDetail(res);
      setOrder((res.members || []).map(m => m.id));
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !detail) {
    return (
      <BottomSheet open onClose={onClose} title="Circle">
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      </BottomSheet>
    );
  }

  const { group, members, round, turns, contributions, is_creator: isCreator, pending_invites: pendingInvites } = detail;
  const forming  = group.status === "forming";
  const active   = group.status === "active";
  const myPaid   = (contributions || []).filter(c => c.user_id === myUserId).reduce((s, c) => s + Number(c.amount), 0);
  const haveIPaid = myPaid >= Number(group.contribution_amount);
  const allPaid  = (members || []).filter(m => m.status === "active").every(m =>
    (contributions || []).filter(c => c.user_id === m.user_id).reduce((s, c) => s + Number(c.amount), 0) >= Number(group.contribution_amount)
  );
  const currentTurns = (turns || []).filter(t => t.status === "current");

  const moveMember = (idx, dir) => {
    const next = [...order];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOrder(next);
  };

  const saveOrder = async () => {
    setBusy(true); setErr("");
    try {
      await peerEsusuFn("reorder-members", {
        group_id: groupId,
        new_order: order.map((memberId, i) => ({ member_id: memberId, position: i + 1 })),
      });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const startCircle = async () => {
    setBusy(true); setErr("");
    try {
      await peerEsusuFn("start-group", { group_id: groupId });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const payMyShare = async () => {
    setBusy(true); setErr("");
    try {
      await peerEsusuFn("pay-contribution", { group_id: groupId, amount: Number(group.contribution_amount) });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const executePayout = async () => {
    setBusy(true); setErr("");
    try {
      await peerEsusuFn("execute-payout", { group_id: groupId });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const orderedMembers = order.map(id => members.find(m => m.id === id)).filter(Boolean);

  return (
    <>
      <BottomSheet open onClose={onClose} title={group.name}>
        {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-4 py-3 mb-4">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Per rotation</p>
            <p className="text-lg font-extrabold text-slate-800 dark:text-white">{fmt(group.contribution_amount)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status</p>
            <p className="text-sm font-bold text-brand-600 dark:text-brand-400 capitalize">{group.status}</p>
          </div>
        </div>

        {forming && (
          <>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
              Members ({orderedMembers.length}) {isCreator && "— reorder before starting"}
            </p>
            <div className="space-y-2 mb-3">
              {orderedMembers.map((m, i) => (
                <div key={m.id} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl px-3 py-2.5">
                  <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {m.display_name}{m.user_id === myUserId ? " (You)" : ""}
                  </span>
                  {isCreator && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => moveMember(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 disabled:opacity-30 flex items-center justify-center">↑</button>
                      <button onClick={() => moveMember(i, 1)} disabled={i === orderedMembers.length - 1} className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 disabled:opacity-30 flex items-center justify-center">↓</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {isCreator && (
              <>
                {pendingInvites?.length > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3">{pendingInvites.length} invite(s) awaiting response</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setShowInvite(true)}
                    className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm active:scale-[0.98]">
                    + Invite
                  </button>
                  <button onClick={saveOrder} disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm disabled:opacity-50 active:scale-[0.98]">
                    Save order
                  </button>
                </div>
                <button onClick={startCircle} disabled={busy || orderedMembers.length < 2}
                  className="w-full mt-3 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
                  {busy ? "Starting…" : orderedMembers.length < 2 ? "Need at least 2 members" : "Start circle"}
                </button>
              </>
            )}
          </>
        )}

        {active && round && (
          <>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Round {round.round_number} — who's paid</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {(members || []).filter(m => m.status === "active").map(m => {
                const paid = (contributions || []).filter(c => c.user_id === m.user_id).reduce((s, c) => s + Number(c.amount), 0) >= Number(group.contribution_amount);
                return (
                  <span key={m.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                    paid ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300"
                         : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-400"
                  }`}>
                    <span>{paid ? "✓" : "·"}</span>{m.display_name}{m.user_id === myUserId ? " (You)" : ""}
                  </span>
                );
              })}
            </div>

            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">This round's collector{currentTurns.length > 1 ? "s" : ""}</p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">
              {currentTurns.map(t => (members || []).find(m => m.user_id === t.user_id)?.display_name || "—").join(", ") || "—"}
            </p>

            {!haveIPaid && (
              <button onClick={payMyShare} disabled={busy}
                className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] mb-2">
                {busy ? "Paying…" : `Pay my ${fmt(group.contribution_amount)} contribution`}
              </button>
            )}
            {haveIPaid && <p className="text-[12px] text-green-600 dark:text-green-400 font-semibold mb-2">You've paid for this round ✓</p>}

            {isCreator && (
              <button onClick={executePayout} disabled={busy || !allPaid}
                className="w-full py-3.5 bg-navy hover:opacity-90 disabled:opacity-40 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
                {busy ? "Paying out…" : allPaid ? "Execute payout" : "Waiting for everyone to pay"}
              </button>
            )}
          </>
        )}
      </BottomSheet>

      {showInvite && (
        <InviteMemberSheet groupId={groupId} onClose={() => setShowInvite(false)}
          onInvited={() => { setShowInvite(false); load(); }} />
      )}
    </>
  );
}

/* ── Main screen — list of circles + invites inbox ────────────────────── */
export default function PeerEsusuScreen({ session }) {
  const myUserId = session?.user?.id;
  const [data,       setData]       = useState(null);
  const [loading,     setLoading]    = useState(true);
  const [showCreate,  setShowCreate] = useState(false);
  const [openGroupId, setOpenGroupId] = useState(null);
  const [busyInvite,  setBusyInvite] = useState(null);
  const [err,         setErr]        = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await peerEsusuFn("list-my-groups");
      setData(res);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respondInvite = async (inviteId, accept) => {
    setBusyInvite(inviteId);
    try {
      await peerEsusuFn("respond-invite", { invite_id: inviteId, accept });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusyInvite(null);
    }
  };

  const groups = [...(data?.created || []), ...(data?.member_of || [])];

  return (
    <div className="px-4 pt-4 pb-28 screen-enter space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">My Circles</h1>
        <button onClick={() => setShowCreate(true)}
          className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center active:scale-95 transition-transform">
          <Icon name="plus" size={18} />
        </button>
      </div>

      {err && <p className="text-[12px] text-red-500">{err}</p>}

      {data?.invites?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Invites for you</p>
          {data.invites.map(inv => (
            <div key={inv.id} className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-3.5">
              <p className="text-sm font-bold text-slate-800 dark:text-white">"{inv.peer_esusu_groups?.name}"</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2.5">You've been invited to join this Esusu circle</p>
              <div className="flex gap-2">
                <button onClick={() => respondInvite(inv.id, false)} disabled={busyInvite === inv.id}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs disabled:opacity-50">
                  Decline
                </button>
                <button onClick={() => respondInvite(inv.id, true)} disabled={busyInvite === inv.id}
                  className="flex-1 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-xs disabled:opacity-50">
                  {busyInvite === inv.id ? "…" : "Accept"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-slate-400 mb-1">No circles yet</p>
            <p className="text-[12px] text-slate-400">Create one, or wait for an invite</p>
          </div>
        ) : groups.map(g => (
          <button key={g.id} onClick={() => setOpenGroupId(g.id)}
            className="w-full text-left bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3.5 flex items-center justify-between active:scale-[0.99] transition-transform">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{g.name}</p>
              <p className="text-[11px] text-slate-400 capitalize">{g.status} · {fmt(g.contribution_amount)} / {g.frequency}</p>
            </div>
            <Icon name="chevron-right" size={16} className="text-slate-300 flex-shrink-0" />
          </button>
        ))}
      </div>

      {showCreate && (
        <CreateCircleSheet onClose={() => setShowCreate(false)}
          onCreated={(groupId) => { setShowCreate(false); load(); setOpenGroupId(groupId); }} />
      )}

      {openGroupId && (
        <CircleDetail groupId={openGroupId} myUserId={myUserId} onClose={() => { setOpenGroupId(null); load(); }} onChanged={load} />
      )}
    </div>
  );
}
