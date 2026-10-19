import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";
import Icon from "../components/Icon";
import { BottomSheet } from "../components/WalletPanel";
import { friendlyError } from "../utils/errorMessages";
import EsusuRotationDashboard from "../components/EsusuRotationDashboard";
import TransactionPinModal from "../components/TransactionPinModal";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useT, tNow } from "../contexts/LanguageContext";

async function peerEsusuFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("peer-esusu", { body: { action, ...body } });
  if (error) {
    let msg = error.message || tNow("circles.requestFailed");
    try {
      const errBody = await error.context?.json?.();
      if (errBody?.error) msg = errBody.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// The organiser's fee on each collector's payout, in words — null when the circle has none.
// `t` is the screen's translator (useT); without one it uses the current language.
export function circleFeeLabel(g, t = tNow) {
  const v = Number(g?.payout_fee_value || 0);
  if (!g || !(v > 0)) return null;
  if (g.payout_fee_type === "percent") return t("circles.feePercent", { v });
  if (g.payout_fee_type === "fixed") return t("circles.feeFixed", { amount: fmt(v) });
  return null;
}

// label = translation key (circles.js); id is what is stored
const FEE_TYPES = [
  { id: "none",    label: "circles.feeTypeNone" },
  { id: "percent", label: "circles.feeTypePercent" },
  { id: "fixed",   label: "circles.feeTypeFixed" },
];

const FREQUENCIES = [
  { id: "daily",   label: "circles.freqDaily"   },
  { id: "weekly",  label: "circles.freqWeekly"  },
  { id: "monthly", label: "circles.freqMonthly" },
  { id: "custom",  label: "circles.freqCustom"  },
];

// Stored frequency / status → the words shown (an unknown value is shown as it is)
const PER_FREQ = { daily: "circles.perDaily", weekly: "circles.perWeekly", monthly: "circles.perMonthly", custom: "circles.perCustom" };
const perFreq = (t, f) => (PER_FREQ[f] ? t(PER_FREQ[f]) : f);
const STATUS_LABEL = { forming: "circles.statusForming", active: "circles.statusActive", completed: "circles.statusCompleted", cancelled: "circles.statusCancelled" };
const statusLabel = (t, st) => (STATUS_LABEL[st] ? t(STATUS_LABEL[st]) : st);

/* ── Create Circle sheet ──────────────────────────────────────────────── */
function CreateCircleSheet({ onClose, onCreated }) {
  const t = useT();
  const [name,       setName]       = useState("");
  const [amount,     setAmount]     = useState("");
  const [frequency,  setFrequency]  = useState("monthly");
  const [customDays, setCustomDays] = useState("");
  const [slots,      setSlots]      = useState("1");
  const [feeType,    setFeeType]    = useState("none");
  const [feeValue,   setFeeValue]   = useState("");
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState("");

  const create = async () => {
    if (!name.trim())            { setErr(t("circles.errName")); return; }
    if (!(Number(amount) > 0))   { setErr(t("circles.errAmount")); return; }
    if (frequency === "custom" && !(Number(customDays) > 0)) { setErr(t("circles.errDays")); return; }
    if (feeType === "percent" && !(Number(feeValue) > 0 && Number(feeValue) <= 50)) { setErr(t("circles.errFeePct")); return; }
    if (feeType === "fixed" && !(Number(feeValue) > 0 && Number(feeValue) <= Number(amount))) { setErr(t("circles.errFeeFixed")); return; }
    setSaving(true); setErr("");
    try {
      const res = await peerEsusuFn("create-group", {
        name: name.trim(), contribution_amount: Number(amount), frequency,
        custom_interval_days: frequency === "custom" ? Number(customDays) : undefined,
        payout_slots_per_round: Number(slots) || 1,
        payout_fee_type: feeType, payout_fee_value: feeType === "none" ? 0 : Number(feeValue),
      });
      onCreated(res.group_id);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title={t("circles.createTitle")}>
      <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
        {t("circles.createIntro")}
      </p>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

      <div className="space-y-3">
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">{t("circles.circleName")}</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("circles.circleNamePh")}
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">{t("circles.contribPerRotation")}</label>
          <div className="flex items-center gap-2 mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60">
            <span className="text-[15px] font-black text-brand-600 dark:text-brand-300">₦</span>
            <input type="number" inputMode="decimal" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
              className="flex-1 bg-transparent text-[14px] font-semibold text-slate-900 dark:text-slate-50 outline-none placeholder:font-normal placeholder:text-slate-400 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">{t("circles.howOften")}</label>
          <div className="flex gap-2 mt-1.5">
            {FREQUENCIES.map(f => (
              <button key={f.id} type="button" onClick={() => setFrequency(f.id)}
                className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-transform active:scale-[0.98] ${
                  frequency === f.id ? "bg-brand-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
                }`}>
                {t(f.label)}
              </button>
            ))}
          </div>
          {frequency === "custom" && (
            <input type="number" inputMode="numeric" min="1" value={customDays} onChange={e => setCustomDays(e.target.value)}
              placeholder={t("circles.daysPh")}
              className="w-full mt-2 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
          )}
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            {t("circles.winners")} <span className="text-slate-300 font-normal">{t("circles.winnersHint")}</span>
          </label>
          <input type="number" inputMode="numeric" min="1" value={slots} onChange={e => setSlots(e.target.value)}
            className="w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold outline-none focus:border-brand-400" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            {t("circles.yourFee")} <span className="text-slate-300 font-normal">{t("circles.yourFeeHint")}</span>
          </label>
          <div className="flex gap-2 mt-1.5">
            {FEE_TYPES.map(f => (
              <button key={f.id} type="button" onClick={() => { setFeeType(f.id); setFeeValue(""); }}
                className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-transform active:scale-[0.98] ${
                  feeType === f.id ? "bg-brand-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
                }`}>
                {t(f.label)}
              </button>
            ))}
          </div>
          {feeType !== "none" && (
            <div className="flex items-center gap-2 mt-2 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60">
              {feeType === "fixed" && <span className="text-[15px] font-black text-brand-600 dark:text-brand-300">₦</span>}
              <input type="number" inputMode="decimal" min="0" value={feeValue} onChange={e => setFeeValue(e.target.value)}
                placeholder={t("circles.egValue", { v: feeType === "percent" ? 5 : 500 })}
                className="flex-1 bg-transparent text-[14px] font-semibold text-slate-900 dark:text-slate-50 outline-none placeholder:font-normal placeholder:text-slate-400 tabular [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              {feeType === "percent" && <span className="text-[15px] font-black text-brand-600 dark:text-brand-300">%</span>}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
            {feeType === "none"
              ? t("circles.feeNoneNote")
              : t("circles.feeNote")}
          </p>
        </div>
      </div>

      <button onClick={create} disabled={saving}
        className="w-full mt-5 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
        {saving ? t("circles.creating") : t("circles.createBtn")}
      </button>
    </BottomSheet>
  );
}

/* ── Search & Invite sheet ────────────────────────────────────────────── */
function InviteMemberSheet({ groupId, onClose, onInvited }) {
  const t = useT();
  const [acctNo,    setAcctNo]    = useState("");
  const [searching, setSearching] = useState(false);
  const [result,    setResult]    = useState(null); // { found, user_id, display_name }
  const [err,       setErr]       = useState("");
  const [inviting,  setInviting]  = useState(false);

  const search = async () => {
    if (!/^\d{10}$/.test(acctNo)) { setErr(t("circles.errAcct")); return; }
    setSearching(true); setErr(""); setResult(null);
    try {
      const res = await peerEsusuFn("search-wallet-user", { account_number: acctNo });
      if (!res.found) { setErr(res.error || t("circles.noWallet")); return; }
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
    <BottomSheet open onClose={onClose} title={t("circles.inviteTitle")}>
      <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
        {t("circles.inviteIntro")}
      </p>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

      <div className="flex gap-2">
        <input type="text" inputMode="numeric" maxLength={10} value={acctNo}
          onChange={e => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setResult(null); }}
          placeholder={t("circles.acctPh")}
          className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[14px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
        <button onClick={search} disabled={searching || acctNo.length !== 10}
          className="px-5 rounded-2xl bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm font-bold disabled:opacity-40">
          {searching ? "…" : t("common.search")}
        </button>
      </div>

      {result?.found && (
        <div className="mt-4 flex items-center gap-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-3.5">
          <div className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center font-extrabold flex-shrink-0">
            {(result.display_name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{result.display_name}</p>
            <p className="text-[11px] text-slate-400">{t("circles.walletNo", { n: acctNo })}</p>
          </div>
        </div>
      )}

      <button onClick={invite} disabled={!result?.found || inviting}
        className="w-full mt-5 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
        {inviting ? t("circles.sendingInvite") : t("circles.sendInvite")}
      </button>
    </BottomSheet>
  );
}

/* ── Circle dashboard — the same dashboard an owner-run esusu shows ──────
 * A client-started circle lives in its own tables (peer_esusu_*), keyed by the members' login ids. toRotationData
 * maps get-group-detail onto the shape EsusuRotationDashboard renders for business-run esusu groups, so a circle shows
 * the same Current Pot card, this-period ticks, avatar rail, "your turn is next" and rotation order. */
function toRotationData(detail, memberWord = "Member") {
  const { group, members = [], round, turns = [], contributions = [] } = detail || {};
  if (!group) return null;
  const nameOf = (uid) => members.find((m) => m.user_id === uid)?.display_name || memberWord;
  const paidBy = {};
  for (const c of contributions) paidBy[c.user_id] = (paidBy[c.user_id] || 0) + Number(c.amount || 0);
  const active = members.filter((m) => m.status === "active");
  const due = Number(group.contribution_amount || 0);
  return {
    group: { ...group, privacy_show_names: true },
    round: round ? { ...round, payout_slots_per_round: round.payout_slots_per_round || group.payout_slots_per_round || 1 } : null,
    turns: [...turns].sort((a, b) => a.position - b.position).map((t) => ({
      ...t, client_id: t.user_id, client_name: nameOf(t.user_id),
      payout_contribution_id: t.status === "paid" ? (t.payout_contribution_id || t.id) : null,
    })),
    members: active.map((m) => ({ id: m.user_id, display_name: m.display_name })),
    contribution_ticks: Object.fromEntries(active.map((m) => [m.user_id, due > 0 && (paidBy[m.user_id] || 0) >= due])),
    pot_size: contributions.reduce((n, c) => n + Number(c.amount || 0), 0),
    _paidBy: paidBy,
  };
}

function CircleActiveView({ detail, groupId, myUserId, reload, onChanged }) {
  const t = useT();
  const { walletMoveFeeKobo } = usePlatformConfig();   // the Charge fee on paying in from the wallet
  const { group, members = [], is_creator: isCreator } = detail;
  const memberWord = t("circles.member");
  const data = useMemo(() => toRotationData(detail, memberWord), [detail, memberWord]);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");
  const [askPin, setAskPin] = useState(false);   // paying in needs the member's transaction PIN
  const due       = Number(group.contribution_amount || 0);
  const haveIPaid = (data._paidBy[myUserId] || 0) >= due;
  const creatorName = members.find((m) => m.user_id === group.creator_user_id)?.display_name || t("circles.creatorFallback");

  // Called by the dashboard with the creator's transaction PIN; the server checks it again before moving the pot
  const executePayout = async (_turnId, pin) => {
    const missing = data.members.filter((m) => !data.contribution_ticks[m.id]);
    if (missing.length) {
      return { blocked: true, missing_count: missing.length,
        missing_contributors: missing.map((m) => ({ client_name: m.display_name, amount_paid: data._paidBy[m.id] || 0, amount_due: due })) };
    }
    const r = await peerEsusuFn("execute-payout", { group_id: groupId, pin });
    onChanged?.();
    const nameOf = (uid) => members.find((m) => m.user_id === uid)?.display_name;
    return { ok: true, beneficiaries: (r.winners || []).map((w) => ({ name: nameOf(w.user_id) })),
      per_winner_amount: r.per_winner_amount, pot_amount: r.pot_amount };
  };

  const payMyShare = async (pin) => {
    setAskPin(false);
    setBusy(true); setErr("");
    try {
      await peerEsusuFn("pay-contribution", { group_id: groupId, amount: due, pin });
      await reload();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {data.round ? (
        <EsusuRotationDashboard data={data} loading={false} isOwner={!!isCreator} myClientId={myUserId}
          onRefresh={reload} onExecutePayout={isCreator ? executePayout : undefined} />
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("circles.noRound")}</p>
      )}
      {err && <p className="text-[12px] text-red-500">{err}</p>}
      {/* Where the money goes: the circle's collection account is the creator's own wallet */}
      <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2.5 leading-relaxed">
        {isCreator
          ? t("circles.moneyCreator")
          : t("circles.moneyMember", { amount: fmt(due), creator: creatorName })}
        {circleFeeLabel(group, t) && ` ${isCreator
          ? t("circles.feeKeptCreator", { fee: circleFeeLabel(group, t) })
          : t("circles.feeKeptBy", { fee: circleFeeLabel(group, t), who: creatorName })}`}
      </p>
      {data.round && (haveIPaid ? (
        <p className="text-[12px] text-green-600 dark:text-green-400 font-semibold">{t("circles.paidThis")}</p>
      ) : (
        <button onClick={() => { setErr(""); setAskPin(true); }} disabled={busy}
          className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
          {busy ? t("circles.paying") : t("circles.payMy", { amount: fmt(due) })}
        </button>
      ))}
      {askPin && (
        <TransactionPinModal title={t("circles.confirmContribution")} fee={walletMoveFeeKobo} onApprove={payMyShare} onCancel={() => setAskPin(false)} />
      )}
    </div>
  );
}

/* One circle as a dashboard card — on My Circles and on the client's Home, like an owner-run esusu group */
export function PeerCircleDashboard({ groupId, myUserId, onChanged, onOpen }) {
  const t = useT();
  const [detail, setDetail] = useState(null);
  const [err,    setErr]    = useState("");
  // Silent reload: the dashboard stays mounted, so its payout success screen isn't lost
  const reload = useCallback(async () => {
    try { setDetail(await peerEsusuFn("get-group-detail", { group_id: groupId })); setErr(""); }
    catch (e) { setErr(friendlyError(e)); }
  }, [groupId]);
  useEffect(() => { reload(); }, [reload]);

  const group = detail?.group;
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">{group?.name || t("circles.circle")}</p>
          {group && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              {t("circles.myCircle")} · {fmt(group.contribution_amount)} / {perFreq(t, group.frequency)}{detail?.is_creator ? ` · ${t("circles.youRunIt")}` : ""}
              {circleFeeLabel(group, t) && <span className="block">{circleFeeLabel(group, t)}</span>}
            </p>
          )}
        </div>
        {onOpen && group && (
          <button onClick={onOpen} className="text-[10px] font-bold text-brand-500 dark:text-brand-400 px-2 py-1 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex-shrink-0">
            {t("circles.members")}
          </button>
        )}
      </div>
      {err && !detail && <p className="text-[12px] text-red-500">{err}</p>}
      {!detail && !err && <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-700/50 animate-pulse" />}
      {detail && group.status === "active" && (
        <CircleActiveView detail={detail} groupId={groupId} myUserId={myUserId} reload={reload} onChanged={onChanged} />
      )}
      {detail && group.status === "forming" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t((detail.members || []).length === 1 ? "circles.formingOne" : "circles.formingMany", { n: (detail.members || []).length })} {detail.is_creator ? t("circles.inviteAndStart") : t("circles.waitingCreator")}
        </p>
      )}
      {detail && (group.status === "completed" || group.status === "cancelled") && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {group.status === "completed" ? t("circles.completed") : t("circles.cancelled")}
        </p>
      )}
    </div>
  );
}

/* Active circles on the client's Home — the same section look as the business's esusu groups */
export function ActiveCirclesOnHome({ myUserId }) {
  const t = useT();
  const [ids, setIds] = useState([]);
  useEffect(() => {
    let live = true;
    peerEsusuFn("list-my-groups")
      .then((res) => {
        if (!live) return;
        const all = [...(res?.created || []), ...(res?.member_of || [])].filter((g) => g.status === "active");
        setIds([...new Set(all.map((g) => g.id))]);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!myUserId || ids.length === 0) return null;
  return (
    <>
      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1 mt-2">{t("circles.myCircles")}</p>
      {ids.map((id) => <PeerCircleDashboard key={id} groupId={id} myUserId={myUserId} />)}
    </>
  );
}

/* ── Circle detail ────────────────────────────────────────────────────── */
function CircleDetail({ groupId, myUserId, onClose, onChanged }) {
  const t = useT();
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState("");
  const [order,    setOrder]    = useState([]); // local reorder buffer while forming

  const load = useCallback(async () => {
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
      <BottomSheet open onClose={onClose} title={t("circles.circle")}>
        <p className="text-sm text-slate-400 text-center py-8">{t("common.loading")}</p>
      </BottomSheet>
    );
  }

  const { group, members, is_creator: isCreator, pending_invites: pendingInvites } = detail;
  const forming  = group.status === "forming";
  const active   = group.status === "active";

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

  const orderedMembers = order.map(id => members.find(m => m.id === id)).filter(Boolean);

  return (
    <>
      <BottomSheet open onClose={onClose} title={group.name}>
        {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}

        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-4 py-3 mb-4">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t("circles.perRotation")}</p>
            <p className="text-lg font-extrabold text-slate-800 dark:text-white">{fmt(group.contribution_amount)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{circleFeeLabel(group, t) || t("circles.noOrganiserFee")}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t("circles.status")}</p>
            <p className="text-sm font-bold text-brand-600 dark:text-brand-400 capitalize">{statusLabel(t, group.status)}</p>
          </div>
        </div>

        {forming && (
          <>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
              {t("circles.membersCount", { n: orderedMembers.length })} {isCreator && t("circles.reorderHint")}
            </p>
            <div className="space-y-2 mb-3">
              {orderedMembers.map((m, i) => (
                <div key={m.id} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl px-3 py-2.5">
                  <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {m.display_name}{m.user_id === myUserId ? ` ${t("circles.you")}` : ""}
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
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3">{t("circles.invitesAwaiting", { n: pendingInvites.length })}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setShowInvite(true)}
                    className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm active:scale-[0.98]">
                    {t("circles.inviteBtn")}
                  </button>
                  <button onClick={saveOrder} disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm disabled:opacity-50 active:scale-[0.98]">
                    {t("circles.saveOrder")}
                  </button>
                </div>
                <button onClick={startCircle} disabled={busy || orderedMembers.length < 2}
                  className="w-full mt-3 py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99]">
                  {busy ? t("circles.starting") : orderedMembers.length < 2 ? t("circles.needTwo") : t("circles.startCircle")}
                </button>
              </>
            )}
          </>
        )}

        {active && (
          <CircleActiveView detail={detail} groupId={groupId} myUserId={myUserId} reload={load} onChanged={onChanged} />
        )}
        {(group.status === "completed" || group.status === "cancelled") && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {group.status === "completed" ? t("circles.completed") : t("circles.cancelled")}
          </p>
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
export default function PeerEsusuScreen({ session, openGroupId: deepLinkGroupId, onDeepLinkHandled }) {
  const t = useT();
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

  // A notification tap (deep link {tab:"circles", groupId}) opens that circle
  useEffect(() => {
    if (!deepLinkGroupId) return;
    setOpenGroupId(deepLinkGroupId);
    onDeepLinkHandled?.();
  }, [deepLinkGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t("circles.myCircles")}</h1>
        <button onClick={() => setShowCreate(true)}
          className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center active:scale-95 transition-transform">
          <Icon name="plus" size={18} />
        </button>
      </div>

      {err && <p className="text-[12px] text-red-500">{err}</p>}

      {data?.invites?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t("circles.invitesForYou")}</p>
          {data.invites.map(inv => (
            <div key={inv.id} className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-2xl px-4 py-3.5">
              <p className="text-sm font-bold text-slate-800 dark:text-white">"{inv.peer_esusu_groups?.name}"</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2.5">
                {t("circles.invitedToJoin")}
                {inv.peer_esusu_groups?.contribution_amount ? ` · ${fmt(inv.peer_esusu_groups.contribution_amount)} / ${perFreq(t, inv.peer_esusu_groups.frequency)}` : ""}
                <span className="block font-semibold text-slate-600 dark:text-slate-300">
                  {circleFeeLabel(inv.peer_esusu_groups, t) || t("circles.noFeeFullPot")}
                </span>
              </p>
              <div className="flex gap-2">
                <button onClick={() => respondInvite(inv.id, false)} disabled={busyInvite === inv.id}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs disabled:opacity-50">
                  {t("circles.decline")}
                </button>
                <button onClick={() => respondInvite(inv.id, true)} disabled={busyInvite === inv.id}
                  className="flex-1 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-xs disabled:opacity-50">
                  {busyInvite === inv.id ? "…" : t("circles.accept")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">{t("common.loading")}</p>
        ) : groups.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-slate-400 mb-1">{t("circles.noCircles")}</p>
            <p className="text-[12px] text-slate-400">{t("circles.createOrWait")}</p>
          </div>
        ) : groups.map(g => g.status === "active" ? (
          <PeerCircleDashboard key={g.id} groupId={g.id} myUserId={myUserId} onChanged={load} onOpen={() => setOpenGroupId(g.id)} />
        ) : (
          <button key={g.id} onClick={() => setOpenGroupId(g.id)}
            className="w-full text-left bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3.5 flex items-center justify-between active:scale-[0.99] transition-transform">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{g.name}</p>
              <p className="text-[11px] text-slate-400 capitalize">{statusLabel(t, g.status)} · {fmt(g.contribution_amount)} / {perFreq(t, g.frequency)}</p>
              {circleFeeLabel(g, t) && <p className="text-[11px] text-slate-400">{circleFeeLabel(g, t)}</p>}
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
