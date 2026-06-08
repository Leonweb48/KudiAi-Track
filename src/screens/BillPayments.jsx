import { useState, useMemo } from "react";
import { fmt, today } from "../utils/helpers";

/* ── Static data ─────────────────────────────────────────────────── */

const CATS = [
  { id:"airtime",     label:"Airtime",     g1:"#ef4444",g2:"#dc2626" },
  { id:"data",        label:"Data",        g1:"#3b82f6",g2:"#1d4ed8" },
  { id:"electricity", label:"Electricity", g1:"#f59e0b",g2:"#d97706" },
  { id:"cable_tv",    label:"Cable TV",    g1:"#8b5cf6",g2:"#6d28d9" },
  { id:"internet",    label:"Internet",    g1:"#06b6d4",g2:"#0e7490" },
  { id:"education",   label:"Education",   g1:"#10b981",g2:"#047857" },
];

const NETWORKS = ["MTN","Airtel","Glo","9mobile"];

const DATA_PLANS = {
  MTN:      [{p:"500MB",a:200},{p:"1GB",a:350},{p:"2GB",a:600},{p:"5GB",a:1500},{p:"10GB",a:2500},{p:"20GB",a:4500}],
  Airtel:   [{p:"500MB",a:200},{p:"1GB",a:350},{p:"2GB",a:600},{p:"5GB",a:1500},{p:"10GB",a:2500}],
  Glo:      [{p:"1GB",a:300},{p:"2GB",a:500},{p:"5GB",a:1200},{p:"10GB",a:2000},{p:"20GB",a:3500}],
  "9mobile":[{p:"500MB",a:200},{p:"1GB",a:400},{p:"2GB",a:700},{p:"5GB",a:1500}],
};

const DISCOS = ["Eko (EKEDC)","Ikeja (IKEDC)","Abuja (AEDC)","Port Harcourt (PHEDC)","Enugu (EEDC)","Ibadan (IBEDC)","Kano (KEDC)","Kaduna (KAEDCO)","Jos (JEDC)","Benin (BEDC)"];

const CABLE_PROVIDERS = ["DSTV","GOtv","StarTimes"];
const CABLE_PLANS = {
  DSTV:      [{p:"Padi",a:2150},{p:"Yanga",a:2950},{p:"Confam",a:5300},{p:"Compact",a:9000},{p:"Compact Plus",a:14250},{p:"Premium",a:24500}],
  GOtv:      [{p:"Smallie",a:900},{p:"Jinja",a:1640},{p:"Jolli",a:2460},{p:"Max",a:4150},{p:"Supa",a:6200}],
  StarTimes: [{p:"Nova",a:900},{p:"Basic",a:1700},{p:"Smart",a:2200},{p:"Classic",a:2500}],
};

const INTERNET_PROVIDERS = ["Spectranet","Smile","ipNX","Swift","Glo Fiber","MTN Home"];
const EDU_FEES            = ["School Fees","WAEC","JAMB","NECO","NYSC","Post-UTME","Transcript","Hostel Fees","Other"];

/* ── Icons ────────────────────────────────────────────────────────── */

function Ico({ d, size=22, c="currentColor", sw=2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p,i)=><path key={i} d={p}/>)}
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

const rcpId = () => "RCP-" + Math.random().toString(36).slice(2,8).toUpperCase();

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"})
    + " · " + d.toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"});
}

function catMeta(id) { return CATS.find(c=>c.id===id) || CATS[0]; }

function initForm(catId) {
  switch(catId) {
    case "airtime":     return { network:"MTN", phone:"", amount:"" };
    case "data":        return { network:"MTN", phone:"", plan:"1GB", amount:"350" };
    case "electricity": return { disco:DISCOS[0], meter:"", custName:"", amount:"" };
    case "cable_tv":    return { provider:"DSTV", smartcard:"", plan:"Compact", amount:"9000" };
    case "internet":    return { provider:"Spectranet", account:"", plan:"", amount:"" };
    case "education":   return { institution:"", student:"", regNo:"", feeType:"School Fees", amount:"" };
    default: return {};
  }
}

function buildNames(catId, form) {
  switch(catId) {
    case "airtime":     return { item_name:`${form.network} Airtime`,        customer_name:form.phone,      note:`Network: ${form.network}` };
    case "data":        return { item_name:`${form.network} ${form.plan} Data`, customer_name:form.phone,   note:`Network: ${form.network} | Plan: ${form.plan}` };
    case "electricity": return { item_name:`Electricity – ${form.disco}`,    customer_name:form.meter,      note:`Meter: ${form.meter} | Name: ${form.custName}` };
    case "cable_tv":    return { item_name:`${form.provider} ${form.plan}`,  customer_name:form.smartcard,  note:`Provider: ${form.provider}` };
    case "internet":    return { item_name:`${form.provider} Internet${form.plan?` – ${form.plan}`:""}`, customer_name:form.account, note:`Provider: ${form.provider}` };
    case "education":   return { item_name:`${form.feeType}`,                customer_name:form.student,    note:`Institution: ${form.institution} | Reg: ${form.regNo}` };
    default:            return { item_name:"Bill Payment", customer_name:"", note:"" };
  }
}

/* ── Shared form inputs ───────────────────────────────────────────── */

function FInput({ label, value, onChange, type="text", placeholder="", req=false }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}{req?" *":""}</label>
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
        {options.map(o=> typeof o==="string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value||o.p} value={o.value||o.p}>{o.label||o.p}{o.a?` – ₦${o.a.toLocaleString()}`:""}</option>
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
        {NETWORKS.map(n=>(
          <button key={n} onClick={()=>onChange(n)}
            className={`py-2 text-xs font-bold rounded-xl border-2 transition-colors ${value===n?"border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700":"border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Dynamic payment form ────────────────────────────────────────── */

function PaymentForm({ catId, form, setForm }) {
  const s = (k,v) => setForm(f=>({...f,[k]:v}));

  if (catId === "airtime") return (
    <>
      <NetPills value={form.network} onChange={v=>s("network",v)} />
      <FInput label="Phone Number" value={form.phone} onChange={e=>s("phone",e.target.value)} type="tel" placeholder="08012345678" req />
      <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" placeholder="100" req />
    </>
  );

  if (catId === "data") {
    const plans = DATA_PLANS[form.network] || [];
    return (
      <>
        <NetPills value={form.network} onChange={v=>{
          s("network",v);
          const ps=DATA_PLANS[v]||[];
          if(ps.length){s("plan",ps[0].p);s("amount",String(ps[0].a));}
        }} />
        <FInput label="Phone Number" value={form.phone} onChange={e=>s("phone",e.target.value)} type="tel" placeholder="08012345678" req />
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
          <div className="grid grid-cols-3 gap-2">
            {plans.map(pl=>(
              <button key={pl.p} onClick={()=>{s("plan",pl.p);s("amount",String(pl.a));}}
                className={`py-2 px-1 rounded-xl border-2 text-center transition-colors ${form.plan===pl.p?"border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700":"border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                <p className="text-xs font-bold">{pl.p}</p>
                <p className="text-[10px] font-medium">₦{pl.a.toLocaleString()}</p>
              </button>
            ))}
          </div>
        </div>
        <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" req />
      </>
    );
  }

  if (catId === "electricity") return (
    <>
      <FSelect label="Distribution Company *" value={form.disco} onChange={e=>s("disco",e.target.value)} options={DISCOS} />
      <FInput label="Meter Number" value={form.meter} onChange={e=>s("meter",e.target.value)} placeholder="12345678901" req />
      <FInput label="Customer Name" value={form.custName} onChange={e=>s("custName",e.target.value)} placeholder="Name on meter" />
      <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" placeholder="2000" req />
    </>
  );

  if (catId === "cable_tv") {
    const plans = CABLE_PLANS[form.provider] || [];
    return (
      <>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Provider *</label>
          <div className="grid grid-cols-3 gap-2">
            {CABLE_PROVIDERS.map(p=>(
              <button key={p} onClick={()=>{
                s("provider",p);
                const ps=CABLE_PLANS[p]||[];
                if(ps.length){s("plan",ps[0].p);s("amount",String(ps[0].a));}
              }}
                className={`py-2 text-xs font-bold rounded-xl border-2 transition-colors ${form.provider===p?"border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700":"border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <FInput label="Smart Card Number" value={form.smartcard} onChange={e=>s("smartcard",e.target.value)} placeholder="1234567890" req />
        <FSelect label="Package *" value={form.plan}
          onChange={e=>{
            s("plan",e.target.value);
            const pl=plans.find(x=>x.p===e.target.value);
            if(pl) s("amount",String(pl.a));
          }}
          options={plans.map(pl=>({value:pl.p,label:pl.p,a:pl.a,p:pl.p}))} />
        <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" req />
      </>
    );
  }

  if (catId === "internet") return (
    <>
      <FSelect label="Provider *" value={form.provider} onChange={e=>s("provider",e.target.value)} options={INTERNET_PROVIDERS} />
      <FInput label="Account / Phone Number" value={form.account} onChange={e=>s("account",e.target.value)} placeholder="Account number" req />
      <FInput label="Plan (optional)" value={form.plan} onChange={e=>s("plan",e.target.value)} placeholder="e.g. 10Mbps Monthly" />
      <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" placeholder="5000" req />
    </>
  );

  if (catId === "education") return (
    <>
      <FInput label="Institution Name" value={form.institution} onChange={e=>s("institution",e.target.value)} placeholder="University of Lagos" req />
      <FInput label="Student Name" value={form.student} onChange={e=>s("student",e.target.value)} placeholder="Full name" req />
      <FInput label="Reg / Matric Number" value={form.regNo} onChange={e=>s("regNo",e.target.value)} placeholder="ENG/2024/001" />
      <FSelect label="Fee Type *" value={form.feeType} onChange={e=>s("feeType",e.target.value)} options={EDU_FEES} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e=>s("amount",e.target.value)} type="number" placeholder="50000" req />
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

        {/* Success icon */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
            style={{background:`linear-gradient(135deg,${cat.g1},${cat.g2})`}}>
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">Payment Successful</h2>
          <p className="text-2xl font-black text-green-600 mt-1">{fmt(receipt.amount)}</p>
        </div>

        {/* Receipt body */}
        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 space-y-2.5 mb-5">
          {[
            ["Receipt No",   receipt.id],
            ["Date & Time",  fmtDT(receipt.created_at || new Date().toISOString())],
            ["Service",      cat.label],
            ["Description",  receipt.item_name],
            ["Beneficiary",  receipt.customer_name],
            ...(receipt.staffName ? [["Processed by", receipt.staffName]] : []),
            ...(receipt.businessName ? [["Business",    receipt.businessName]] : []),
          ].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} className="flex items-start justify-between gap-3">
              <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">{k}</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 text-right break-all">{v}</span>
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

/* ── Bill history row ─────────────────────────────────────────────── */

function BillRow({ bill }) {
  const cat = catMeta(bill.category);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-center gap-3 shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{background:`linear-gradient(135deg,${cat.g1},${cat.g2})`}}>
        <Ico d={CAT_ICONS[bill.category]||CAT_ICONS.airtime} size={18} c="white" />
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

export default function BillPayments({ store, staffName = null, businessName = null }) {
  const { transactions, addTransaction } = store;

  const [selectedCat, setSelectedCat] = useState(null);
  const [form,        setForm]         = useState({});
  const [saving,      setSaving]       = useState(false);
  const [error,       setError]        = useState("");
  const [receipt,     setReceipt]      = useState(null);

  // Filters
  const [filterCat,  setFilterCat]  = useState("all");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [amountMin,  setAmountMin]  = useState("");
  const [amountMax,  setAmountMax]  = useState("");
  const [showFilter, setShowFilter] = useState(false);

  // All bill payment transactions
  const bills = useMemo(() => {
    let list = transactions.filter(t => t.payment_type === "bill_payment");
    if (filterCat !== "all")  list = list.filter(t => t.category === filterCat);
    if (dateFrom)             list = list.filter(t => (t.transaction_date||"") >= dateFrom);
    if (dateTo)               list = list.filter(t => (t.transaction_date||"") <= dateTo);
    if (amountMin)            list = list.filter(t => t.amount >= parseFloat(amountMin));
    if (amountMax)            list = list.filter(t => t.amount <= parseFloat(amountMax));
    return list;
  }, [transactions, filterCat, dateFrom, dateTo, amountMin, amountMax]);

  const totalBills = bills.reduce((s,b) => s + b.amount, 0);

  const openSheet = (catId) => {
    setSelectedCat(catId);
    setForm(initForm(catId));
    setError("");
  };

  const closeSheet = () => { setSelectedCat(null); setForm({}); setError(""); };

  const handlePay = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }

    // Basic required field checks
    if (selectedCat === "airtime"     && !form.phone)     { setError("Phone number required"); return; }
    if (selectedCat === "data"        && !form.phone)     { setError("Phone number required"); return; }
    if (selectedCat === "electricity" && !form.meter)     { setError("Meter number required"); return; }
    if (selectedCat === "cable_tv"    && !form.smartcard) { setError("Smart card number required"); return; }
    if (selectedCat === "internet"    && !form.account)   { setError("Account number required"); return; }
    if (selectedCat === "education"   && !form.student)   { setError("Student name required"); return; }

    setSaving(true);
    setError("");
    const { item_name, customer_name, note } = buildNames(selectedCat, form);

    const payload = {
      type:             "out",
      category:         selectedCat,
      payment_type:     "bill_payment",
      item_name,
      customer_name,
      amount,
      note,
      transaction_date: today(),
    };

    await addTransaction(payload);
    setSaving(false);
    closeSheet();

    // Show receipt
    setReceipt({
      ...payload,
      id:           rcpId(),
      created_at:   new Date().toISOString(),
      staffName,
      businessName,
    });
  };

  const activeFilterCount = [filterCat!=="all", dateFrom, dateTo, amountMin, amountMax].filter(Boolean).length;

  return (
    <div className="pb-32 screen-enter">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Bill Payments</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Pay utilities, data, education &amp; more</p>
      </div>

      <div className="px-4 pt-4 space-y-5">

        {/* ── Summary strip ────────────────────────────────────────── */}
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

        {/* ── Category cards ───────────────────────────────────────── */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-3 gap-3">
            {CATS.map(cat => {
              const count = transactions.filter(t => t.payment_type==="bill_payment" && t.category===cat.id).length;
              return (
                <button key={cat.id} onClick={() => openSheet(cat.id)}
                  className="rounded-2xl p-4 flex flex-col items-center gap-2 shadow-md active:scale-95 transition-all duration-150 text-white"
                  style={{background:`linear-gradient(135deg,${cat.g1},${cat.g2})`}}>
                  <Ico d={CAT_ICONS[cat.id]} size={26} c="rgba(255,255,255,0.95)" />
                  <p className="text-[11px] font-bold">{cat.label}</p>
                  {count > 0 && <p className="text-[9px] font-semibold bg-white/25 px-1.5 py-0.5 rounded-full">{count} paid</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Bill history + filters ───────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
              Payment History {bills.length > 0 && <span className="text-slate-400 font-normal">({bills.length})</span>}
            </h2>
            <button onClick={() => setShowFilter(v=>!v)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${activeFilterCount>0 ? "bg-green-600 text-white border-green-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              <Ico d="M4 6h16|M8 12h8|M12 18h0" size={13} />
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </div>

          {/* Type pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-3 scrollbar-hide">
            {["all", ...CATS.map(c=>c.id)].map(id=>(
              <button key={id} onClick={() => setFilterCat(id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${filterCat===id ? "bg-green-600 text-white" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                {id==="all" ? "All" : catMeta(id).label}
              </button>
            ))}
          </div>

          {/* Advanced filter sheet */}
          {showFilter && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date From</label>
                  <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date To</label>
                  <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FInput label="Min Amount" value={amountMin} onChange={e=>setAmountMin(e.target.value)} type="number" placeholder="0" />
                <FInput label="Max Amount" value={amountMax} onChange={e=>setAmountMax(e.target.value)} type="number" placeholder="Any" />
              </div>
              <button onClick={()=>{setDateFrom("");setDateTo("");setAmountMin("");setAmountMax("");setFilterCat("all");setShowFilter(false);}}
                className="text-xs text-red-500 font-semibold underline">Clear all filters</button>
            </div>
          )}

          {/* History list */}
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
              {bills.map(b=><BillRow key={b.id||b.item_name+b.created_at} bill={b} />)}
            </div>
          )}
        </div>
      </div>

      {/* ── Payment bottom sheet ──────────────────────────────────── */}
      {selectedCat && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92vh] flex flex-col">
            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{background:`linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})`}}>
                  <Ico d={CAT_ICONS[selectedCat]} size={17} c="white" />
                </div>
                <h2 className="text-base font-bold text-slate-800 dark:text-white">Pay {catMeta(selectedCat).label}</h2>
              </div>
              <button onClick={closeSheet}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
              </button>
            </div>

            {/* Form */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <PaymentForm catId={selectedCat} form={form} setForm={setForm} />

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
                  style={{background:`linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})`}}>
                  {saving ? "Processing…" : `Pay ${form.amount ? fmt(parseFloat(form.amount)||0) : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Receipt modal ─────────────────────────────────────────── */}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
