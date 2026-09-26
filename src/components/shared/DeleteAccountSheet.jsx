import { useEffect, useRef, useState, useCallback } from "react";
import { callAccountDelete, erasedLines } from "../../utils/accountDeletion";
import { performLogout } from "../../utils/logout";

/**
 * In-app account deletion (Google Play requires it). Opens on the account's status:
 *   blocked  — money / transfers / savings / staff / clients still open: says exactly what, deletes nothing
 *   confirm  — what is erased vs kept, then the account password + an "I understand" tick
 *   done     — signed out
 * The rules live on the server (account_deletion_check / account_erase); this screen only shows them.
 */
export default function DeleteAccountSheet({ onClose, onDeleted = performLogout }) {
  const [phase, setPhase] = useState("loading");     // loading | blocked | confirm | done | failed
  const [info, setInfo] = useState({ kinds: [], blockers: [] });
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading"); setError("");
    const r = await callAccountDelete({ action: "check" });
    if (!r.ok) { setError(r.data?.error || "We could not check your account. Try again."); setPhase("failed"); return; }
    setInfo({ kinds: r.data.kinds || [], blockers: r.data.blockers || [] });
    if (r.data.already_deleted) { setPhase("done"); return; }
    setPhase(r.data.can_delete ? "confirm" : "blocked");
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (busy || !password || !ack) return;
    setBusy(true); setError("");
    const r = await callAccountDelete({ action: "delete", confirm: true, password });
    setBusy(false);
    if (r.ok) { setPhase("done"); return; }
    if (r.status === 409 && r.data?.code === "blocked") { setInfo((i) => ({ ...i, blockers: r.data.blockers || [] })); setPhase("blocked"); return; }
    setError(r.data?.error || "Something went wrong. Nothing was deleted. Try again.");
  };

  // Signed out once, whether they tap Done or just wait: the account is already gone server-side.
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    Promise.resolve(onDeleted()).catch(() => {});
  }, [onDeleted]);
  useEffect(() => {
    if (phase !== "done") return undefined;
    const t = setTimeout(finish, 2500);
    return () => clearTimeout(t);
  }, [phase, finish]);

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Delete account">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl">
        {phase === "loading" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <div className="w-6 h-6 rounded-full border-[3px] border-slate-200 border-t-brand-500 animate-spin" />
            <p className="text-sm text-slate-500">Checking your account…</p>
          </div>
        )}

        {phase === "failed" && (
          <>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Delete your account</h2>
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
            <div className="mt-5 flex gap-2">
              <button onClick={onClose} className="flex-1 py-3 rounded-2xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Close</button>
              <button onClick={load} className="flex-1 py-3 rounded-2xl font-bold text-sm bg-brand-500 text-white">Try again</button>
            </div>
          </>
        )}

        {phase === "blocked" && (
          <>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">You can’t delete your account yet</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              To keep your money and other people’s records safe, sort out the following first. Then come back — it takes a minute.
            </p>
            <ul className="mt-4 space-y-2.5">
              {info.blockers.map((b) => (
                <li key={b.code} className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3.5">
                  <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{b.title}</p>
                  {b.hint && <p className="mt-0.5 text-[13px] text-amber-800/80 dark:text-amber-300/80">{b.hint}</p>}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <button onClick={onClose} className="flex-1 py-3 rounded-2xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Close</button>
              <button onClick={load} className="flex-1 py-3 rounded-2xl font-bold text-sm bg-brand-500 text-white">Check again</button>
            </div>
          </>
        )}

        {phase === "confirm" && (
          <>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Delete your account</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This is permanent. You will be signed out everywhere and will not be able to sign in again.
            </p>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">What gets erased</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-slate-700 dark:text-slate-300 list-disc pl-5">
              {erasedLines(info.kinds).map((l) => <li key={l}>{l}</li>)}
            </ul>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">What we keep</p>
            <p className="mt-1.5 text-[13px] text-slate-700 dark:text-slate-300">
              A record of financial transactions — amounts, dates and references — because financial regulations require it. It is no longer linked to your name.
            </p>

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-slate-400" htmlFor="del-pw">Confirm with your password</label>
            <input
              id="del-pw" type="password" autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="mt-1.5 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
              placeholder="Your password"
            />

            <label className="mt-3 flex items-start gap-2.5 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 w-4 h-4 accent-red-600" />
              <span>I understand this cannot be undone.</span>
            </label>

            {error && <p className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400" role="alert">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={onClose} disabled={busy} className="flex-1 py-3 rounded-2xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50">Cancel</button>
              <button
                onClick={submit} disabled={busy || !password || !ack}
                className="flex-1 py-3 rounded-2xl font-bold text-sm bg-red-600 text-white disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete my account"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div className="py-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-brand-500" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
            </div>
            <h2 className="mt-3 text-lg font-extrabold text-slate-900 dark:text-slate-100">Your account has been deleted</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your personal details have been erased. A confirmation is on its way to your email.</p>
            <button onClick={finish} className="mt-5 w-full py-3 rounded-2xl font-bold text-sm bg-brand-500 text-white">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The entry point every portal shows under its sign-out button: a quiet link that opens the sheet. */
export function DeleteAccountLink({ className = "" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className={`w-full text-center text-[13px] font-semibold text-red-500 dark:text-red-400 py-2 active:opacity-70 ${className}`}
      >
        Delete my account
      </button>
      {open && <DeleteAccountSheet onClose={() => setOpen(false)} />}
    </>
  );
}
