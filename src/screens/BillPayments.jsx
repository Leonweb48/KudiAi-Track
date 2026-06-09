import { useState, useMemo, useCallback, useEffect } from "react";
import { fmt, today } from "../utils/helpers";
import { peyflex } from "../utils/peyflex";

/* ── Static data ─────────────────────────────────────────────────── */

const CATS = [
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", live: true  },
  { id: "data",        label: "Data",        g1: "#3b82f6", g2: "#1d4ed8", live: true  },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", live: true  },
  { id: "cable_tv",    label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", live: true  },
  { id: "internet",    label: "Internet",    g1: "#06b6d4", g2: "#0e7490", live: false },
  { id: "education",   label: "Education",   g1: "#10b981", g2: "#047857", live: false },
];

const NETWORKS = ["MTN", "Airtel", "Glo", "9mobile"];

// Plan codes come directly from the Peyflex API response
const ELEC_DISCOS = [
  { code: "aba-electric",          name: "Aba"           },
  { code: "portharcourt-electric", name: "Port Harcourt" },
  { code: "kano-electric",         name: "Kano"          },
  { code: "kaduna-electric",       name: "Kaduna"        },
  { code: "jos-electric",          name: "Jos"           },
  { code: "ikeja-electric",        name: "Ikeja"         },
  { code: "ibadan-electric",       name: "Ibadan"        },
  { code: "enugu-electric",        name: "Enugu"         },
  { code: "eko-electric",          name: "Eko (Lagos)"   },
  { code: "benin-electric",        name: "Benin"         },
  { code: "yola-electric",         name: "Yola"          },
  { code: "abuja-electric",        name: "Abuja"         },
];

const CABLE_PROVIDERS = ["DSTV", "GOtv", "StarTimes"];
const INTERNET_PROVIDERS = ["Spectranet", "Smile", "ipNX", "Swift", "Glo Fiber", "MTN Home"];
const EDU_FEES = ["School Fees", "WAEC", "JAMB", "NECO", "NYSC", "Post-UTME", "Transcript", "Hostel Fees", "Other"];

/* ── Icons ───────────────────────────────────────────────────────── */

function Ico({ d, size = 22, c = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const CAT_ICONS = {
  airtime:     "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z",
  data:        "M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17",
  electricity: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  cable_tv:    "M21 3H3a2 2 0 00-2 2v12a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2z|M10 20H14|M12 17v3",
  internet:    "M12 2a10 10 0 100 20 10 10 0 000-20z|M2 12h20|M12 2a15.3 15.3 0 010 20|M12 2a15.3 15.3 0 000 20",
  education:   "M22 10v6M2 10l10-5 10 5-10 5-10-5z|M6 12v5c3 3 9 3 12 0v-5",
};

/* ── Helpers ─────────────────────────────────────────────────────── */

const rcpId = () => "RCP-" + Math.random().toString(36).slice(2, 8).toUpperCase();

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

function catMeta(id) { return CATS.find(c => c.id === id) || CATS[0]; }

function initForm(catId) {
  switch (catId) {
    case "airtime":     return { network: "MTN", phone: "", amount: "" };
    case "data":        return { network: "MTN", phone: "", planId: "", planName: "", amount: "" };
    case "electricity": return { disco: "eko-electric", discoName: "Eko (Lagos)", meterType: "prepaid", meter: "", phone: "", amount: "" };
    case "cable_tv":    return { provider: "DSTV", smartcard: "", planId: "", planName: "", amount: "", phone: "" };
    case "internet":    return { provider: "Spectranet", account: "", plan: "", amount: "" };
    case "education":   return { institution: "", student: "", regNo: "", feeType: "School Fees", amount: "" };
    default: return {};
  }
}

function buildNames(catId, form) {
  switch (catId) {
    case "airtime":     return { item_name: `${form.network} Airtime`,                        customer_name: form.phone,     note: `Network: ${form.network}` };
    case "data":        return { item_name: `${form.network} ${form.planName || ""} Data`,    customer_name: form.phone,     note: `Network: ${form.network} | Plan: ${form.planName}` };
    case "electricity": return { item_name: `Electricity – ${form.discoName || form.disco}`, customer_name: form.meter,     note: `Meter: ${form.meter} | ${form.meterType}` };
    case "cable_tv":    return { item_name: `${form.provider} – ${form.planName || form.planId}`, customer_name: form.smartcard, note: `Provider: ${form.provider}` };
    case "internet":    return { item_name: `${form.provider} Internet${form.plan ? ` – ${form.plan}` : ""}`, customer_name: form.account, note: `Provider: ${form.provider}` };
    case "education":   return { item_name: form.feeType,                                    customer_name: form.student,   note: `Institution: ${form.institution} | Reg: ${form.regNo}` };
    default:            return { item_name: "Bill Payment", customer_name: "", note: "" };
  }
}

/* ── Shared form inputs ──────────────────────────────────────────── */

function FInput({ label, value, onChange, type = "text", placeholder = "", req = false }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}{req ? " *" : ""}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
    </div>
  );
}

function FSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <select value={value} onChange={onChange}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
        {options.map(o => typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value || o.p} value={o.value || o.p}>{o.label || o.p}{o.a ? ` – ₦${o.a.toLocaleString()}` : ""}</option>
        )}
      </select>
    </div>
  );
}

function NetPills({ value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Network *</label>
      <div className="grid grid-cols-4 gap-2">
        {NETWORKS.map(n => (
          <button key={n} onClick={() => onChange(n)} type="button"
            className={`py-2 text-xs font-bold rounded-xl border-2 transition-colors ${value === n ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Payment form ────────────────────────────────────────────────── */

function PaymentForm({ catId, form, setForm, verified, verifying, onVerifyMeter, dataPlans, dataPlansLoading, cablePlans, cablePlansLoading }) {
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (catId === "airtime") return (
    <>
      <NetPills value={form.network} onChange={v => s("network", v)} />
      <FInput label="Phone Number" value={form.phone} onChange={e => s("phone", e.target.value)} type="tel" placeholder="08012345678" req />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="100" req />
    </>
  );

  if (catId === "data") return (
    <>
      <NetPills value={form.network} onChange={v => { s("network", v); s("planId", ""); s("planName", ""); s("amount", ""); }} />
      <FInput label="Phone Number" value={form.phone} onChange={e => s("phone", e.target.value)} type="tel" placeholder="08012345678" req />
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
        {dataPlansLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : dataPlans.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {dataPlans.map(pl => {
              const pid = pl.plan_id || pl.plan_code;
              const pname = pl.plan_name || pid;
              const pamount = pl.plan_amount || pl.amount || "";
              return (
                <button key={pid} type="button"
                  onClick={() => { s("planId", pid); s("planName", pname); s("amount", String(pamount)); }}
                  className={`py-2 px-1 rounded-xl border-2 text-center transition-colors ${form.planId === pid ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                  <p className="text-[11px] font-bold leading-tight">{pname}</p>
                  {pamount ? <p className="text-[10px] font-medium mt-0.5">₦{Number(pamount).toLocaleString()}</p> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-4">No plans loaded — check network connection</p>
        )}
      </div>
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" req />
    </>
  );

  if (catId === "electricity") return (
    <>
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Distribution Company *</label>
        <select value={form.disco}
          onChange={e => {
            const d = ELEC_DISCOS.find(x => x.code === e.target.value);
            s("disco", e.target.value);
            s("discoName", d?.name || e.target.value);
          }}
          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
          {ELEC_DISCOS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Meter Type *</label>
        <div className="grid grid-cols-2 gap-2">
          {["prepaid", "postpaid"].map(t => (
            <button key={t} type="button" onClick={() => s("meterType", t)}
              className={`py-2 text-xs font-bold rounded-xl border-2 capitalize transition-colors ${form.meterType === t ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Meter Number *</label>
        <div className="flex gap-2">
          <input type="text" value={form.meter} onChange={e => s("meter", e.target.value)}
            placeholder="e.g. 45145984782"
            className="flex-1 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
          <button type="button" onClick={onVerifyMeter} disabled={verifying || !form.meter || !form.disco}
            className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap">
            {verifying ? "…" : "Verify"}
          </button>
        </div>
        {verified && (
          <div className="mt-2 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
            <Ico d="M20 6L9 17l-5-5" size={14} c="#16a34a" />
            <p className="text-xs text-green-700 dark:text-green-400 font-semibold">{verified.customer_name}</p>
          </div>
        )}
      </div>

      <FInput label="Phone Number" value={form.phone} onChange={e => s("phone", e.target.value)} type="tel" placeholder="08012345678" req />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="2000" req />
    </>
  );

  if (catId === "cable_tv") return (
    <>
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Provider *</label>
        <div className="grid grid-cols-3 gap-2">
          {CABLE_PROVIDERS.map(p => (
            <button key={p} type="button"
              onClick={() => { s("provider", p); s("planId", ""); s("planName", ""); s("amount", ""); }}
              className={`py-2 text-xs font-bold rounded-xl border-2 transition-colors ${form.provider === p ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <FInput label="Smart Card Number" value={form.smartcard} onChange={e => s("smartcard", e.target.value)} placeholder="1234567890" req />

      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Package *</label>
        {cablePlansLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
          </div>
        ) : cablePlans.length > 0 ? (
          <div className="space-y-2">
            {cablePlans.map(pl => {
              const pid = pl.plan_id || pl.plan_code;
              const pname = pl.plan_name || pid;
              const pamount = pl.plan_amount || pl.amount || "";
              return (
                <button key={pid} type="button"
                  onClick={() => { s("planId", pid); s("planName", pname); s("amount", String(pamount)); }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 transition-colors ${form.planId === pid ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30" : "border-slate-200 dark:border-slate-700"}`}>
                  <span className={`text-sm font-semibold ${form.planId === pid ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-300"}`}>{pname}</span>
                  {pamount ? <span className={`text-sm font-bold ${form.planId === pid ? "text-violet-600" : "text-slate-500"}`}>₦{Number(pamount).toLocaleString()}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-4">No packages loaded — check connection</p>
        )}
      </div>

      <FInput label="Phone Number" value={form.phone} onChange={e => s("phone", e.target.value)} type="tel" placeholder="08012345678" req />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" req />
    </>
  );

  if (catId === "internet") return (
    <>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">This is recorded locally. Direct ISP payment not yet available via API.</p>
      </div>
      <FSelect label="Provider *" value={form.provider} onChange={e => s("provider", e.target.value)} options={INTERNET_PROVIDERS} />
      <FInput label="Account / Phone Number" value={form.account} onChange={e => s("account", e.target.value)} placeholder="Account number" req />
      <FInput label="Plan (optional)" value={form.plan} onChange={e => s("plan", e.target.value)} placeholder="e.g. 10Mbps Monthly" />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="5000" req />
    </>
  );

  if (catId === "education") return (
    <>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">This is recorded locally. Direct institution payment not yet available via API.</p>
      </div>
      <FInput label="Institution Name" value={form.institution} onChange={e => s("institution", e.target.value)} placeholder="University of Lagos" req />
      <FInput label="Student Name" value={form.student} onChange={e => s("student", e.target.value)} placeholder="Full name" req />
      <FInput label="Reg / Matric Number" value={form.regNo} onChange={e => s("regNo", e.target.value)} placeholder="ENG/2024/001" />
      <FSelect label="Fee Type *" value={form.feeType} onChange={e => s("feeType", e.target.value)} options={EDU_FEES} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="50000" req />
    </>
  );

  return null;
}

/* ── Receipt modal ───────────────────────────────────────────────── */

function ReceiptModal({ receipt, onClose }) {
  const cat = catMeta(receipt.category);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md px-6 pt-6 pb-10">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
            style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">Payment Successful</h2>
          <p className="text-2xl font-black text-green-600 mt-1">{fmt(receipt.amount)}</p>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 space-y-2.5 mb-5">
          {[
            ["Receipt No",   receipt.receiptId || receipt.id],
            ["Reference",    receipt.apiRef],
            ["Date & Time",  fmtDT(receipt.created_at || new Date().toISOString())],
            ["Service",      cat.label],
            ["Description",  receipt.item_name],
            ["Beneficiary",  receipt.customer_name],
            ...(receipt.token ? [["Token / Units", receipt.token]] : []),
            ...(receipt.staffName ? [["Processed by", receipt.staffName]] : []),
            ...(receipt.businessName ? [["Business", receipt.businessName]] : []),
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3">
              <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">{k}</span>
              <span className={`text-xs font-semibold text-slate-700 dark:text-slate-300 text-right break-all ${k === "Token / Units" ? "font-mono text-amber-600 dark:text-amber-400 text-sm" : ""}`}>{v}</span>
            </div>
          ))}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span className="text-xs text-slate-400">Status</span>
            <span className="text-xs font-bold text-green-600 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">✓ Successful</span>
          </div>
        </div>

        <button onClick={onClose}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-3.5 text-sm transition-colors">
          Done
        </button>
      </div>
    </div>
  );
}

/* ── Bill history row ────────────────────────────────────────────── */

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

/* ── Main component ──────────────────────────────────────────────── */

export default function BillPayments({ store, staffName = null, businessName = null, readOnly = false }) {
  const { transactions, addTransaction } = store;

  const [selectedCat,  setSelectedCat]  = useState(null);
  const [form,         setForm]         = useState({});
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [receipt,      setReceipt]      = useState(null);

  // Electricity meter verification
  const [verifying,    setVerifying]    = useState(false);
  const [verified,     setVerified]     = useState(null); // { customer_name }

  // Dynamic plan lists
  const [dataPlans,        setDataPlans]        = useState([]);
  const [dataPlansLoading, setDataPlansLoading] = useState(false);
  const [cablePlans,       setCablePlans]       = useState([]);
  const [cablePlansLoading,setCablePlansLoading]= useState(false);

  // Filters
  const [filterCat,  setFilterCat]  = useState("all");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [amountMin,  setAmountMin]  = useState("");
  const [amountMax,  setAmountMax]  = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const bills = useMemo(() => {
    let list = transactions.filter(t => t.payment_type === "bill_payment");
    if (filterCat !== "all") list = list.filter(t => t.category === filterCat);
    if (dateFrom)            list = list.filter(t => (t.transaction_date || "") >= dateFrom);
    if (dateTo)              list = list.filter(t => (t.transaction_date || "") <= dateTo);
    if (amountMin)           list = list.filter(t => t.amount >= parseFloat(amountMin));
    if (amountMax)           list = list.filter(t => t.amount <= parseFloat(amountMax));
    return list;
  }, [transactions, filterCat, dateFrom, dateTo, amountMin, amountMax]);

  const totalBills = bills.reduce((s, b) => s + b.amount, 0);

  const loadDataPlans = useCallback(async (network) => {
    setDataPlansLoading(true);
    setDataPlans([]);
    try {
      const res = await peyflex("data-plans", { network });
      setDataPlans(res?.plans || []);
    } catch {
      setDataPlans([]);
    } finally {
      setDataPlansLoading(false);
    }
  }, []);

  const loadCablePlans = useCallback(async (provider) => {
    setCablePlansLoading(true);
    setCablePlans([]);
    try {
      const res = await peyflex("cabletv-plans", { provider });
      setCablePlans(res?.plans || []);
    } catch {
      setCablePlans([]);
    } finally {
      setCablePlansLoading(false);
    }
  }, []);

  const openSheet = (catId) => {
    if (readOnly) return;
    setSelectedCat(catId);
    setForm(initForm(catId));
    setError("");
    setVerified(null);
    setDataPlans([]);
    setCablePlans([]);
    if (catId === "data") loadDataPlans("MTN");
    if (catId === "cable_tv") loadCablePlans("DSTV");
  };

  const closeSheet = () => {
    setSelectedCat(null);
    setForm({});
    setError("");
    setVerified(null);
  };

  // Unified form setter — triggers plan reloads when network/provider changes
  const handleSetForm = useCallback((updater) => {
    setForm(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (selectedCat === "data" && next.network !== prev.network) {
        loadDataPlans(next.network);
      }
      if (selectedCat === "cable_tv" && next.provider !== prev.provider) {
        loadCablePlans(next.provider);
      }
      return next;
    });
  }, [selectedCat, loadDataPlans, loadCablePlans]);

  // Reset meter verification when key electricity fields change
  const { meter, disco, meterType } = form;
  useEffect(() => {
    if (selectedCat !== "electricity") return;
    setVerified(null);
  }, [selectedCat, meter, disco, meterType]);

  const handleVerifyMeter = async () => {
    if (!form.meter || !form.disco) return;
    setVerifying(true);
    setVerified(null);
    setError("");
    try {
      const res = await peyflex("electricity-verify", {
        meter: form.meter,
        plan: form.disco,
        type: form.meterType || "prepaid",
      });
      if (res?.status === "SUCCESS") {
        setVerified({ customer_name: res.customer_name });
      } else {
        setError(res?.message || "Meter verification failed");
      }
    } catch (err) {
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handlePay = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }

    const cat = catMeta(selectedCat);

    if (cat.live) {
      if (selectedCat === "airtime"     && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "data"        && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "data"        && !form.planId)    { setError("Select a data plan"); return; }
      if (selectedCat === "electricity" && !form.meter)     { setError("Meter number required"); return; }
      if (selectedCat === "electricity" && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "electricity" && !verified)       { setError("Please verify meter before paying"); return; }
      if (selectedCat === "cable_tv"    && !form.smartcard) { setError("Smart card number required"); return; }
      if (selectedCat === "cable_tv"    && !form.planId)    { setError("Select a package"); return; }
      if (selectedCat === "cable_tv"    && !form.phone)     { setError("Phone number required"); return; }
    } else {
      if (selectedCat === "internet"  && !form.account) { setError("Account number required"); return; }
      if (selectedCat === "education" && !form.student) { setError("Student name required"); return; }
    }

    setSaving(true);
    setError("");

    let apiRef = null;
    let elecToken = null;

    try {
      if (cat.live) {
        let res;
        if (selectedCat === "airtime") {
          res = await peyflex("airtime", { phone: form.phone, network: form.network, amount: form.amount });
        } else if (selectedCat === "data") {
          res = await peyflex("data", { phone: form.phone, plan: form.planId, amount: form.amount });
        } else if (selectedCat === "electricity") {
          res = await peyflex("electricity", { meter: form.meter, plan: form.disco, amount: form.amount, type: form.meterType, phone: form.phone });
        } else if (selectedCat === "cable_tv") {
          res = await peyflex("cabletv", { smartcard: form.smartcard, plan: form.planId, amount: form.amount, phone: form.phone });
        }

        if (!res || res.status !== "SUCCESS") {
          throw new Error(res?.message || "Payment failed. Check your Peyflex wallet balance.");
        }
        apiRef = res.reference || null;
        elecToken = res.token || null;
      }

      const { item_name, customer_name, note } = buildNames(selectedCat, form);
      const payload = {
        type:             "out",
        category:         selectedCat,
        payment_type:     "bill_payment",
        item_name,
        customer_name,
        amount,
        note:             `${note}${apiRef ? ` | Ref: ${apiRef}` : ""}`,
        transaction_date: today(),
      };

      await addTransaction(payload);

      setSaving(false);
      closeSheet();
      setReceipt({
        ...payload,
        receiptId:    rcpId(),
        apiRef,
        token:        elecToken,
        created_at:   new Date().toISOString(),
        staffName,
        businessName,
      });
    } catch (err) {
      setSaving(false);
      setError(err.message || "Payment failed. Please try again.");
    }
  };

  const activeFilterCount = [filterCat !== "all", dateFrom, dateTo, amountMin, amountMax].filter(Boolean).length;

  return (
    <div className="pb-32 screen-enter">

      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Bill Payments</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Pay utilities, data, education &amp; more</p>
        {readOnly && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
            View-only access. Ask your manager for permission to process bill payments.
          </p>
        )}
      </div>

      <div className="px-4 pt-4 space-y-5">

        {/* Summary strip */}
        <div className="bg-green-600 rounded-2xl px-5 py-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Total Bills Paid</p>
            <p className="text-2xl font-black mt-0.5">{fmt(totalBills)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Transactions</p>
            <p className="text-2xl font-black mt-0.5">{bills.length}</p>
          </div>
        </div>

        {/* Category cards */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-3 gap-3">
            {CATS.map(cat => {
              const count = transactions.filter(t => t.payment_type === "bill_payment" && t.category === cat.id).length;
              return (
                <button key={cat.id} onClick={() => openSheet(cat.id)} disabled={readOnly}
                  className="rounded-2xl p-4 flex flex-col items-center gap-2 shadow-md active:scale-95 transition-all duration-150 text-white disabled:opacity-50 disabled:cursor-not-allowed relative"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  {!cat.live && (
                    <span className="absolute top-1.5 right-1.5 text-[8px] font-bold bg-white/25 px-1.5 py-0.5 rounded-full leading-none">LOCAL</span>
                  )}
                  <Ico d={CAT_ICONS[cat.id]} size={26} c="rgba(255,255,255,0.95)" />
                  <p className="text-[11px] font-bold">{cat.label}</p>
                  {count > 0 && <p className="text-[9px] font-semibold bg-white/25 px-1.5 py-0.5 rounded-full">{count} paid</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bill history + filters */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
              Payment History {bills.length > 0 && <span className="text-slate-400 font-normal">({bills.length})</span>}
            </h2>
            <button onClick={() => setShowFilter(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${activeFilterCount > 0 ? "bg-green-600 text-white border-green-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              <Ico d="M4 6h16|M8 12h8|M12 18h0" size={13} />
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 mb-3 scrollbar-hide">
            {["all", ...CATS.map(c => c.id)].map(id => (
              <button key={id} onClick={() => setFilterCat(id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${filterCat === id ? "bg-green-600 text-white" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                {id === "all" ? "All" : catMeta(id).label}
              </button>
            ))}
          </div>

          {showFilter && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FInput label="Min Amount" value={amountMin} onChange={e => setAmountMin(e.target.value)} type="number" placeholder="0" />
                <FInput label="Max Amount" value={amountMax} onChange={e => setAmountMax(e.target.value)} type="number" placeholder="Any" />
              </div>
              <button onClick={() => { setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); setFilterCat("all"); setShowFilter(false); }}
                className="text-xs text-red-500 font-semibold underline">Clear all filters</button>
            </div>
          )}

          {bills.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Ico d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4" size={22} c="#94a3b8" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No bill payments yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap any service above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bills.map(b => <BillRow key={b.id || b.item_name + b.created_at} bill={b} />)}
            </div>
          )}
        </div>
      </div>

      {/* Payment bottom sheet */}
      {selectedCat && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})` }}>
                  <Ico d={CAT_ICONS[selectedCat]} size={17} c="white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800 dark:text-white">Pay {catMeta(selectedCat).label}</h2>
                  {catMeta(selectedCat).live && (
                    <p className="text-[10px] text-green-600 font-semibold">Live via Peyflex</p>
                  )}
                </div>
              </div>
              <button onClick={closeSheet} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <PaymentForm
                catId={selectedCat}
                form={form}
                setForm={handleSetForm}
                verified={verified}
                verifying={verifying}
                onVerifyMeter={handleVerifyMeter}
                dataPlans={dataPlans}
                dataPlansLoading={dataPlansLoading}
                cablePlans={cablePlans}
                cablePlansLoading={cablePlansLoading}
              />

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
                  style={{ background: `linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})` }}>
                  {saving ? "Processing…" : `Pay ${form.amount ? fmt(parseFloat(form.amount) || 0) : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
