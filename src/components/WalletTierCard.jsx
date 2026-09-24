import { useState } from "react";
import { BottomSheet } from "./WalletPanel";
import { useWalletTier } from "../hooks/useWalletTier";
import { TIER_INFO, formatKoboLimit } from "../utils/walletTier";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { digits11 } from "../utils/walletId";

const FIELD = "w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[15px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";
const BTN = "w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold text-[14px] transition-colors";

// Colour per tier: Tier 1 slate, Tier 2 blue, Tier 3 gold.
const TONE = {
  1: "bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200",
  2: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
  3: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
};

function Limits({ limits }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-3">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Max balance</p>
        <p className="mt-0.5 text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{formatKoboLimit(limits.maxBalanceKobo)}</p>
      </div>
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-3">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Daily limit</p>
        <p className="mt-0.5 text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{formatKoboLimit(limits.dailyKobo)}</p>
      </div>
    </div>
  );
}

// ── Tier 2: self-service ───────────────────────────────────────────────────────────────────────────────────────────
function Tier2Sheet({ open, onClose, tierApi, prefill }) {
  const [f, setF] = useState({ full_name: prefill?.fullName || "", address: prefill?.address || "", state: prefill?.state || "", lga: prefill?.lga || "", bvn: "", nin: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const lgas = getLGAs(f.state) || [];

  const submit = async () => {
    setErr("");
    if (f.full_name.trim().split(/\s+/).length < 2) { setErr("Enter your full name (first and last name)"); return; }
    if (f.address.trim().length < 8) { setErr("Enter your full residential address"); return; }
    if (!f.state) { setErr("Choose your state"); return; }
    if (!/^\d{11}$/.test(f.bvn)) { setErr("Your BVN must be exactly 11 digits"); return; }
    if (!/^\d{11}$/.test(f.nin)) { setErr("Your NIN must be exactly 11 digits"); return; }
    if (f.bvn === f.nin) { setErr("Your BVN and NIN are different numbers — check both"); return; }
    setBusy(true);
    try {
      await tierApi.upgradeToTier2({ ...f, full_name: f.full_name.trim(), address: f.address.trim() });
      setDone(true);
    } catch (e) {
      setErr(e?.message || "Could not upgrade your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={done ? "" : "Upgrade to Tier 2"}>
      {done ? (
        <div className="text-center py-3">
          <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">You're now on Tier 2</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5">Your wallet limits have gone up. We've emailed you a copy.</p>
          <button onClick={onClose} className={BTN + " mt-5"}>Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Confirm your details to raise your limits to {formatKoboLimit(tierApi.nextLimits?.maxBalanceKobo)} balance and {formatKoboLimit(tierApi.nextLimits?.dailyKobo)} a day.
          </p>
          <div><label className={LABEL}>Full name</label>
            <input value={f.full_name} onChange={(e) => set("full_name")(e.target.value)} placeholder="As on your ID" className={FIELD} /></div>
          <div><label className={LABEL}>Residential address</label>
            <input value={f.address} onChange={(e) => set("address")(e.target.value)} placeholder="House number, street, town" className={FIELD} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={LABEL}>State</label>
              <select value={f.state} onChange={(e) => { set("state")(e.target.value); set("lga")(""); }} className={FIELD}>
                <option value="">Select…</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><label className={LABEL}>LGA</label>
              <select value={f.lga} disabled={!f.state} onChange={(e) => set("lga")(e.target.value)} className={FIELD + " disabled:opacity-50"}>
                <option value="">{f.state ? "Select…" : "State first"}</option>
                {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
          </div>
          <div><label className={LABEL}>BVN</label>
            <input inputMode="numeric" value={f.bvn} onChange={(e) => set("bvn")(digits11(e.target.value))} placeholder="11-digit BVN" className={FIELD + " tracking-wider"} /></div>
          <div><label className={LABEL}>NIN</label>
            <input inputMode="numeric" value={f.nin} onChange={(e) => set("nin")(digits11(e.target.value))} placeholder="11-digit NIN" className={FIELD + " tracking-wider"} /></div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Tier 2 needs both numbers. They aren't stored by KudiAI in readable form. Enter them only here in the app — never share them by email, chat or phone.
          </p>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy} className={BTN}>{busy ? "Upgrading…" : "Upgrade to Tier 2"}</button>
        </div>
      )}
    </BottomSheet>
  );
}

// ── Tier 3: needs a person to review it ────────────────────────────────────────────────────────────────────────────
function Tier3Sheet({ open, onClose, tierApi }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async () => {
    setErr(""); setBusy(true);
    try { await tierApi.requestTier3(note.trim()); setSent(true); }
    catch (e) { setErr(e?.message || "Could not send your request. Please try again."); }
    finally { setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={sent ? "" : "Request Tier 3"}>
      {sent ? (
        <div className="text-center py-3">
          <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">Request received</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">Our team will contact you to collect your documents and review them.</p>
          <button onClick={onClose} className={BTN + " mt-5"}>Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Tier 3 lifts your limits to {formatKoboLimit(tierApi.nextLimits?.maxBalanceKobo)} balance and {formatKoboLimit(tierApi.nextLimits?.dailyKobo)} a day. Our team reviews it, so it isn't instant. Have these ready:
          </p>
          <ul className="space-y-1.5">
            {TIER_INFO[3].requirements.map((r) => (
              <li key={r} className="flex gap-2 text-[13px] text-slate-700 dark:text-slate-200"><span className="text-brand-600">•</span><span>{r}</span></li>
            ))}
          </ul>
          <div><label className={LABEL}>Anything we should know? <span className="font-normal text-slate-300">optional</span></label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className={FIELD} placeholder="e.g. the best time to reach you" /></div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy} className={BTN}>{busy ? "Sending…" : "Send request"}</button>
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * The wallet TIER card for a profile screen: which tier the holder is on, what it allows, and how to reach the next one.
 * Everyone starts at Tier 1. Shown to owners, Ajo/Esusu clients, staff and managers (anyone who can hold a wallet).
 * `prefill` = { fullName, address, state, lga } to pre-fill the Tier 2 form; `onOpenWallet` (optional) is offered when they have no wallet yet.
 */
export default function WalletTierCard({ userId, enabled = true, prefill, onOpenWallet, className = "" }) {
  const t = useWalletTier(userId, enabled);
  const [sheet, setSheet] = useState(null);       // "t2" | "t3"
  if (!enabled) return null;
  if (t.loading) return <div className={`h-40 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse ${className}`} />;

  const info = TIER_INFO[t.tier];
  return (
    <>
      <div className={`rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-card p-5 ${className}`}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Account tier</p>
          <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${TONE[t.tier]}`}>Tier {t.tier}</span>
        </div>
        <p className="mt-1.5 text-[19px] font-extrabold text-slate-900 dark:text-slate-50">{info.name}</p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= t.tier ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />)}
        </div>

        {!t.hasWallet ? (
          <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            You're on Tier 1. Open your wallet to start using it{onOpenWallet ? "." : " — find it in the Wallet section."}
          </p>
        ) : (
          <div className="mt-3"><Limits limits={t.limits} /></div>
        )}
        {!t.hasWallet && onOpenWallet && (
          <button onClick={onOpenWallet} className={BTN + " mt-3"}>Open my wallet</button>
        )}

        {t.hasWallet && t.next === 2 && (
          <div className="mt-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-900/40 p-4">
            <p className="text-[13.5px] font-extrabold text-sky-800 dark:text-sky-200">Upgrade to Tier 2 — {TIER_INFO[2].name}</p>
            <p className="mt-0.5 text-[12px] text-sky-700 dark:text-sky-300 leading-relaxed">
              Raise your limits to {formatKoboLimit(t.nextLimits.maxBalanceKobo)} balance and {formatKoboLimit(t.nextLimits.dailyKobo)} a day. You'll need:
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {TIER_INFO[2].requirements.map((r) => <li key={r} className="text-[12px] text-sky-800 dark:text-sky-200">• {r}</li>)}
            </ul>
            <button onClick={() => setSheet("t2")} className={BTN + " mt-3"}>Upgrade to Tier 2</button>
          </div>
        )}

        {t.hasWallet && t.next === 3 && (
          <div className="mt-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 p-4">
            <p className="text-[13.5px] font-extrabold text-amber-800 dark:text-amber-200">Upgrade to Tier 3 — {TIER_INFO[3].name}</p>
            <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300 leading-relaxed">
              Unlock {formatKoboLimit(t.nextLimits.maxBalanceKobo)} balance and up to {formatKoboLimit(t.nextLimits.dailyKobo)} a day. You'll need:
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {TIER_INFO[3].requirements.map((r) => <li key={r} className="text-[12px] text-amber-800 dark:text-amber-200">• {r}</li>)}
            </ul>
            {t.pending
              ? <p className="mt-3 text-[12.5px] font-bold text-amber-800 dark:text-amber-200">Request received — our team will contact you.</p>
              : <button onClick={() => setSheet("t3")} className={BTN + " mt-3"}>Request Tier 3</button>}
          </div>
        )}

        {t.hasWallet && t.next === null && (
          <p className="mt-4 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">You're on the highest tier — thank you for verifying.</p>
        )}
      </div>

      {sheet === "t2" && <Tier2Sheet open onClose={() => setSheet(null)} tierApi={t} prefill={prefill} />}
      {sheet === "t3" && <Tier3Sheet open onClose={() => setSheet(null)} tierApi={t} />}
    </>
  );
}
