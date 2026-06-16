import { useState, useMemo, useCallback, useEffect } from "react";
import { fmt, today } from "../utils/helpers";
import { clubkonnect } from "../utils/clubkonnect";
import { BillReceipt } from "../components/shared/Receipt";

/* ── Categories (Airtime + Data only via ClubKonnect) ──────────────── */

const CATS = [
  { id: "airtime", label: "Airtime", g1: "#ef4444", g2: "#dc2626" },
  { id: "data",    label: "Data",    g1: "#3b82f6", g2: "#1d4ed8" },
];

const NETWORKS = ["MTN", "Airtel", "Glo", "9mobile"];

const NET_CONFIG = {
  MTN:       { bg: "#FFC300", fg: "#000", abbr: "MTN"     },
  Airtel:    { bg: "#EF3340", fg: "#fff", abbr: "Airtel"  },
  Glo:       { bg: "#007838", fg: "#fff", abbr: "Glo"     },
  "9mobile": { bg: "#006B54", fg: "#fff", abbr: "9mobile" },
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

const rcpId = () => "RCP-" + Math.random().toString(36).slice(2, 8).toUpperCase();

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

function detectNetwork(phone) {
  const clean = phone.replace(/\D/g, "");
  let prefix;
  if (clean.startsWith("234") && clean.length >= 6) prefix = "0" + clean.slice(3, 6);
  else if (clean.length >= 4) prefix = clean.slice(0, 4);
  else return null;
  const MTN    = ["0703","0706","0803","0806","0810","0813","0814","0816","0903","0906","0913","0916"];
  const AIRTEL = ["0701","0708","0802","0808","0812","0901","0902","0904","0907","0911","0912","0917"];
  const GLO    = ["0705","0805","0807","0811","0815","0905","0915"];
  const NMOB   = ["0809","0817","0818","0908","0909","0919"];
  if (MTN.includes(prefix))    return "MTN";
  if (AIRTEL.includes(prefix)) return "Airtel";
  if (GLO.includes(prefix))    return "Glo";
  if (NMOB.includes(prefix))   return "9mobile";
  return null;
}

function catMeta(id) { return CATS.find(c => c.id === id) || CATS[0]; }

/* ── Icons ────────────────────────────────────────────────────────────── */

function Ico({ d, size = 22, c = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const CAT_ICONS = {
  airtime: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z",
  data:    "M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17",
};

/* ── Network selector ────────────────────────────────────────────────── */

function NetworkSelector({ value, onChange, detected }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Network *</label>
        {detected && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            Auto-detected
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {NETWORKS.map(n => {
          const cfg = NET_CONFIG[n];
          const sel = value === n;
          return (
            <button key={n} type="button" onClick={() => onChange(n)}
              className={`relative flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 transition-all duration-150 active:scale-95 border-2 ${sel ? "shadow-md" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}
              style={sel ? { borderColor: cfg.bg + "99", background: cfg.bg + "18" } : {}}>
              <div className="w-full h-8 rounded-xl flex items-center justify-center" style={{ background: cfg.bg }}>
                <span className="text-[10px] font-black tracking-wide leading-none" style={{ color: cfg.fg }}>{cfg.abbr}</span>
              </div>
              <span className={`text-[9px] font-bold leading-none ${sel ? "text-slate-700 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{n}</span>
              {sel && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm" style={{ background: cfg.bg }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={cfg.fg} strokeWidth={4} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Phone input with auto-detect badge ──────────────────────────────── */

function PhoneInput({ value, onChange }) {
  const detected = value.length >= 4 ? detectNetwork(value) : null;
  const cfg = detected ? NET_CONFIG[detected] : null;
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Phone Number *</label>
      <div className="relative">
        <input type="tel" value={value} onChange={onChange} placeholder="08012345678"
          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 pr-20" />
        {cfg && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black px-2 py-0.5 rounded-full leading-none"
            style={{ background: cfg.bg, color: cfg.fg }}>{cfg.abbr}</span>
        )}
      </div>
    </div>
  );
}

/* ── Overview card ────────────────────────────────────────────────────── */

function Overview({ bills }) {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const todayTotal = bills.filter(b => (b.transaction_date || "") === todayStr).reduce((s, b) => s + b.amount, 0);
  const weekTotal  = bills.filter(b => (b.transaction_date || "") >= weekAgoStr).reduce((s, b) => s + b.amount, 0);
  const airtimeTotal = bills.filter(b => b.category === "airtime").reduce((s, b) => s + b.amount, 0);
  const dataTotal    = bills.filter(b => b.category === "data").reduce((s, b) => s + b.amount, 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 overflow-hidden shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/60">
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(todayTotal)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last 7 Days</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(weekTotal)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/60 border-t border-slate-100 dark:border-slate-700/60">
        {[{ label: "Airtime", val: airtimeTotal, c: "#ef4444" }, { label: "Data", val: dataTotal, c: "#3b82f6" }].map(x => (
          <div key={x.label} className="px-5 py-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full" style={{ background: x.c }} />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{x.label}</p>
            </div>
            <p className="text-base font-black text-slate-700 dark:text-slate-200">{fmt(x.val)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── History row ──────────────────────────────────────────────────────── */

function BillRow({ bill }) {
  const cat = catMeta(bill.category);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-center gap-3 shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
        <Ico d={CAT_ICONS[bill.category] || CAT_ICONS.airtime} size={18} c="white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{bill.item_name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {bill.customer_name && `${bill.customer_name} · `}{fmtDT(bill.created_at)}
        </p>
        {bill.note && <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate italic">{bill.note}</p>}
      </div>
      <p className="text-sm font-extrabold text-red-500 flex-shrink-0">{fmt(bill.amount)}</p>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────── */

export default function BillPayments({ store, staffName = null, businessName = null }) {
  const { transactions, addTransaction } = store;

  const [selectedCat, setSelectedCat] = useState(null);
  const [form,        setForm]        = useState({});
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [receipt,     setReceipt]     = useState(null);

  const [dataPlans,        setDataPlans]        = useState([]);
  const [dataPlansLoading, setDataPlansLoading] = useState(false);

  const bills = useMemo(
    () => transactions.filter(t => t.payment_type === "bill_payment"),
    [transactions]
  );

  const loadDataPlans = useCallback(async (network) => {
    setDataPlansLoading(true); setDataPlans([]);
    try { const res = await clubkonnect("data-plans", { network }); setDataPlans(res?.plans || []); }
    catch { setDataPlans([]); }
    finally { setDataPlansLoading(false); }
  }, []);

  const openSheet = (catId) => {
    setSelectedCat(catId);
    setForm({ network: "MTN", phone: "", amount: "", planId: "", planName: "" });
    setError("");
    setDataPlans([]);
    if (catId === "data") loadDataPlans("MTN");
  };

  const closeSheet = () => { setSelectedCat(null); setForm({}); setError(""); };

  const handleSetForm = useCallback((updater) => {
    setForm(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (selectedCat === "data" && next.network !== prev.network) {
        loadDataPlans(next.network);
        return { ...next, planId: "", planName: "", amount: "" };
      }
      return next;
    });
  }, [selectedCat, loadDataPlans]);

  const handlePay = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }
    if (!form.phone)            { setError("Phone number is required"); return; }
    if (selectedCat === "data" && !form.planId) { setError("Select a data plan"); return; }

    setSaving(true); setError("");
    try {
      let ref = null;
      if (selectedCat === "airtime") {
        const res = await clubkonnect("airtime", { phone: form.phone, network: form.network, amount: String(form.amount) });
        ref = res.reference;
      } else {
        const res = await clubkonnect("data", { phone: form.phone, network: form.network, planId: form.planId });
        ref = res.reference;
      }

      const isAirtime = selectedCat === "airtime";
      const payload = {
        type: "out", category: selectedCat, payment_type: "bill_payment",
        item_name:     isAirtime ? `${form.network} Airtime` : `${form.network} ${form.planName} Data`,
        customer_name: form.phone,
        amount,
        note: isAirtime
          ? `Network: ${form.network}${ref ? ` | Ref: ${ref}` : ""}`
          : `Network: ${form.network} | Plan: ${form.planName}${ref ? ` | Ref: ${ref}` : ""}`,
        transaction_date: today(),
      };

      await addTransaction(payload);
      setSaving(false); closeSheet();
      setReceipt({ ...payload, receiptId: rcpId(), apiRef: ref, created_at: new Date().toISOString(), staffName, businessName });
    } catch (err) {
      setSaving(false);
      setError(err.message || "Payment failed. Please try again.");
    }
  };

  const cat = selectedCat ? catMeta(selectedCat) : null;
  const detected = form.phone?.length >= 4 ? detectNetwork(form.phone) : null;

  return (
    <div className="pb-32 screen-enter">

      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Airtime & Data</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Instant recharge via ClubKonnect</p>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Summary strip */}
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl px-5 py-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Total Spent</p>
            <p className="text-2xl font-black mt-0.5">{fmt(bills.reduce((s, b) => s + b.amount, 0))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Transactions</p>
            <p className="text-2xl font-black mt-0.5">{bills.length}</p>
          </div>
        </div>

        {/* Overview */}
        {bills.length > 0 && <Overview bills={bills} />}

        {/* Service cards */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-2 gap-4">
            {CATS.map(c => {
              const count = bills.filter(b => b.category === c.id).length;
              return (
                <button key={c.id} onClick={() => openSheet(c.id)}
                  className="rounded-2xl p-5 flex flex-col items-center gap-2.5 shadow-md active:scale-95 transition-all duration-150 text-white relative"
                  style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }}>
                  <Ico d={CAT_ICONS[c.id]} size={32} c="rgba(255,255,255,0.95)" />
                  <p className="text-sm font-bold">{c.label}</p>
                  {count > 0 && <p className="text-[9px] font-semibold bg-white/25 px-2 py-0.5 rounded-full">{count} sent</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* History */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">
            History {bills.length > 0 && <span className="text-slate-400 font-normal">({bills.length})</span>}
          </h2>
          {bills.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Ico d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z" size={22} c="#94a3b8" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No recharges yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap Airtime or Data above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bills.map(b => <BillRow key={b.id || b.item_name + b.created_at} bill={b} />)}
            </div>
          )}
        </div>
      </div>

      {/* Payment bottom sheet */}
      {selectedCat && cat && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92vh] flex flex-col">

            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  <Ico d={CAT_ICONS[selectedCat]} size={17} c="white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800 dark:text-white">
                    {selectedCat === "airtime" ? "Airtime Recharge" : "Data Bundle"}
                  </h2>
                  <p className="text-[10px] text-green-600 font-semibold">Live via ClubKonnect</p>
                </div>
              </div>
              <button onClick={closeSheet} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Network selector */}
              <NetworkSelector
                value={form.network}
                onChange={v => handleSetForm(f => ({ ...f, network: v }))}
                detected={detected && detected === form.network ? detected : null}
              />

              {/* Phone */}
              <PhoneInput value={form.phone} onChange={e => {
                const phone = e.target.value;
                const net = detectNetwork(phone);
                handleSetForm(f => ({ ...f, phone, ...(net ? { network: net } : {}) }));
              }} />

              {/* Airtime amount */}
              {selectedCat === "airtime" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (₦) *</label>
                  <input type="number" value={form.amount}
                    onChange={e => handleSetForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="100"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {/* Quick amounts */}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {[50, 100, 200, 500, 1000].map(a => (
                      <button key={a} type="button"
                        onClick={() => handleSetForm(f => ({ ...f, amount: String(a) }))}
                        className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${form.amount === String(a) ? "bg-green-600 text-white border-green-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        ₦{a}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Data plan selector */}
              {selectedCat === "data" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
                  {dataPlansLoading ? (
                    <div className="grid grid-cols-3 gap-2">
                      {[1,2,3,4,5,6].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
                    </div>
                  ) : dataPlans.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {dataPlans.map(pl => (
                        <button key={pl.plan_id} type="button"
                          onClick={() => handleSetForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))}
                          className={`py-2 px-1 rounded-xl border-2 text-center transition-colors ${form.planId === pl.plan_id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                          <p className="text-[11px] font-bold leading-tight">{pl.plan_name}</p>
                          {pl.plan_amount ? <p className="text-[10px] font-medium mt-0.5">₦{Number(pl.plan_amount).toLocaleString()}</p> : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <input type="text" value={form.planName || ""}
                        onChange={e => handleSetForm(f => ({ ...f, planId: e.target.value, planName: e.target.value }))}
                        placeholder="Enter plan, e.g. 1GB Daily"
                        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-[11px] text-slate-400">Plans unavailable — enter plan name manually</p>
                    </div>
                  )}
                  {form.planId && form.amount && (
                    <div className="mt-2">
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (₦)</label>
                      <input type="number" value={form.amount}
                        onChange={e => handleSetForm(f => ({ ...f, amount: e.target.value }))}
                        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                </div>
              )}

              {staffName && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8" size={14} c="#3b82f6" />
                  <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Processed by <strong>{staffName}</strong></p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

              <div className="pb-6">
                <button onClick={handlePay} disabled={saving}
                  className="w-full text-white font-bold rounded-xl py-3.5 text-sm transition-all disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  {saving ? "Processing…" : `Pay ${form.amount ? fmt(parseFloat(form.amount) || 0) : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receipt && <BillReceipt bill={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
