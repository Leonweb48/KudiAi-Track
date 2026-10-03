import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { supabase } from "../utils/supabase";
import { businessHolder, formatWATDate, monthKeyLabel } from "../utils/statementPdfLayout";
import { statementMonths, watToday } from "../utils/statementPeriod";
import { letterheadFrom } from "../shared/businessReport.js";
import { saveWalletMonthPdf } from "../utils/generateWalletStatementPdf";

// The owner's monthly reports (Reports page): for every month, the General Business Report and the Wallet Statement —
// the same PDFs emailed on the 1st of the next month (server: supabase/functions/owner-reports, the same shared code) —
// with which months were sent, and the switch for the email.
//
// @param onBusinessPdf (month) => Promise — builds + saves that month's Business Report (Reports.jsx: the same fetch the
//                      server does, then the Reports PDF)

function Toggle({ on, onChange, disabled }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => !disabled && onChange(!on)} disabled={disabled}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"} disabled:opacity-50`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200" style={{ left: on ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );
}

export default function OwnerMonthlyReports({ profile, highlight = "", onBusinessPdf }) {
  // from the month the business joined (the last 12 months when that isn't known)
  const months = useMemo(() => statementMonths(profile?.created_at || (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11); return d.toISOString();
  })()), [profile?.created_at]);
  const current = watToday().slice(0, 7);
  const [sent, setSent] = useState({});              // month -> when it went out
  const [wallet, setWallet] = useState(undefined);   // undefined = loading, null = no wallet
  const [inv, setInv] = useState(null);
  const [emailOn, setEmailOn] = useState(profile?.monthly_reports_email !== false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");              // "2026-10:business" | "2026-10:wallet"
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile?.id) return undefined;
    let live = true;
    Promise.all([
      supabase.from("owner_monthly_reports").select("month, emailed_at, notified_at").eq("owner_id", profile.id),
      supabase.from("wallets").select("flw_account_number, flw_account_bank, flw_account_name").eq("user_id", profile.id).maybeSingle(),
      supabase.from("invoice_settings").select("logo_url, contact_email, contact_phone, address").eq("user_id", profile.id).maybeSingle(),
    ]).then(([r, w, i]) => {
      if (!live) return;
      const m = {};
      for (const row of r?.data || []) m[String(row.month).slice(0, 7)] = row.emailed_at || row.notified_at;
      setSent(m);
      setWallet(w?.data ? { number: w.data.flw_account_number || "", bank: w.data.flw_account_bank || "", name: w.data.flw_account_name || "" } : null);
      setInv(i?.data || null);
    }, () => { if (live) setWallet(null); });
    return () => { live = false; };
  }, [profile?.id]);

  const setEmail = async (on) => {
    setEmailOn(on); setSaving(true); setError("");
    const { error: e } = await supabase.from("profiles").update({ monthly_reports_email: on }).eq("id", profile.id);
    if (e) { setEmailOn(!on); setError("Couldn't save that — try again."); }
    setSaving(false);
  };

  const run = async (key, fn) => {
    setBusy(key); setError("");
    try { await fn(); }
    catch (e) { setError(e?.message || "Could not prepare the report"); }
    finally { setBusy(""); }
  };
  const business = (m) => run(`${m}:business`, () => onBusinessPdf(m));
  const walletPdf = (m) => run(`${m}:wallet`, () => {
    const lh = letterheadFrom(profile, inv);
    return saveWalletMonthPdf(profile.id, m, {
      holder: businessHolder({ name: lh.businessName, phone: lh.phone, email: lh.email, address: lh.address }),
      account: wallet,
    });
  });
  const email = profile?.email || "";

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/40 px-4 py-3">
        <p className="text-[12px] font-bold text-brand-700 dark:text-brand-300">Monthly reports</p>
        <p className="text-[11px] text-brand-700/80 dark:text-brand-300/80 mt-0.5 leading-relaxed">
          On the 1st of every month we send you last month's <strong>Business Report</strong>{wallet ? <> and <strong>Wallet Statement</strong></> : ""} as PDFs —
          here in the app{emailOn && email ? <> and to <strong>{email}</strong></> : ""}. Each has a QR code anyone can scan to check it's genuine.
        </p>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-brand-100 dark:border-brand-800/40">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">Email them to me</p>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">{emailOn ? "On — PDFs attached to an email on the 1st" : "Off — you'll still get them here in the app"}</p>
          </div>
          <Toggle on={emailOn} onChange={setEmail} disabled={saving} />
        </div>
      </div>
      {error && <p className="text-[12px] text-red-500 text-center">{error}</p>}
      <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 divide-y divide-slate-100 dark:divide-slate-700/60">
        {months.map((m) => (
          <div key={m} className={`px-4 py-3.5 ${highlight === m ? "bg-brand-50/60 dark:bg-brand-900/10" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                <Icon name="bills" size={16} className="text-slate-500 dark:text-slate-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{monthKeyLabel(m)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {m === current ? "So far this month" : sent[m] ? `Sent ${formatWATDate(sent[m])}` : "Business report" + (wallet ? " and wallet statement" : "")}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5 pl-12">
              <button onClick={() => business(m)} disabled={!!busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-600 text-white text-[12px] font-bold disabled:opacity-50 active:scale-95 transition">
                <Icon name="download" size={13} /> {busy === `${m}:business` ? "Preparing…" : "Business report"}
              </button>
              {wallet && (
                <button onClick={() => walletPdf(m)} disabled={!!busy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 dark:bg-slate-600 text-white text-[12px] font-bold disabled:opacity-50 active:scale-95 transition">
                  <Icon name="download" size={13} /> {busy === `${m}:wallet` ? "Preparing…" : "Wallet statement"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
