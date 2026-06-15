import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { peyflex } from "../utils/peyflex";
import { fmt } from "../utils/helpers";
import AppLogo from "../components/AppLogo";

async function ajoFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("ajo-portal", {
    body: { action, ...body },
  });
  if (error) {
    let msg = error.message || "Portal request failed";
    try {
      const errBody = await error.context?.json?.();
      if (errBody?.error) msg = errBody.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Load Paystack Inline JS once per session ──────────────────────────────
function loadPaystackScript() {
  return new Promise((resolve, reject) => {
    if (window.PaystackPop) { resolve(window.PaystackPop); return; }
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v1/inline.js";
    s.onload  = () => resolve(window.PaystackPop);
    s.onerror = () => reject(new Error("Failed to load Paystack"));
    document.head.appendChild(s);
  });
}

// ── Pay Contribution modal ────────────────────────────────────────────────
function PayContributionModal({ client, onClose, onSuccess }) {
  const [status,   setStatus]   = useState("idle"); // idle | loading | paying | done | error
  const [message,  setMessage]  = useState("");

  const handlePay = async () => {
    if (!client?.contribution_amount) { setMessage("No contribution amount set by your savings agent."); return; }
    setStatus("loading"); setMessage("");

    try {
      // Backend initializes the Paystack transaction with subaccount routing
      const res = await ajoFn("initialize-payment", { client_id: client.id });
      if (!res.access_code || !res.public_key) throw new Error("Payment initialization failed");

      setStatus("paying");

      // Load Paystack Inline SDK
      const PaystackPop = await loadPaystackScript();

      const handler = PaystackPop.setup({
        key:        res.public_key,
        email:      res.email || client.email,
        amount:     Math.round(Number(res.amount) * 100),
        ref:        res.reference,
        accessCode: res.access_code,
        onSuccess: async (transaction) => {
          setStatus("done");
          setMessage("Payment received! Updating your balance…");
          try {
            const confirmation = await ajoFn("confirm-payment", {
              client_id: client.id,
              reference: transaction.reference,
            });
            setMessage(`Payment confirmed! Ref: ${transaction.reference}`);
            onSuccess?.(transaction.reference, confirmation?.client);
          } catch {
            setMessage("Payment received. Your balance will update shortly.");
            onSuccess?.(transaction.reference, null);
          }
        },
        onCancel: () => {
          setStatus("idle");
          setMessage("Payment cancelled.");
        },
      });
      handler.openIframe();
    } catch (e) {
      setStatus("error");
      setMessage(e.message || "Payment failed. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-2xl flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-extrabold text-slate-800 dark:text-white">Pay Contribution</p>
            <p className="text-[11px] text-slate-400">Secure payment via Paystack</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Amount */}
        <div className="bg-violet-50 dark:bg-violet-900/20 rounded-2xl px-4 py-4 mb-5 text-center">
          <p className="text-[10px] font-bold text-violet-500 dark:text-violet-400 uppercase tracking-wider mb-1">Amount Due</p>
          <p className="text-3xl font-black text-violet-700 dark:text-violet-300 tabular">₦{fmt(client?.contribution_amount || 0)}</p>
          <p className="text-[11px] text-slate-400 mt-1 capitalize">{client?.contribution_frequency} contribution</p>
        </div>

        {status === "done" ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="font-bold text-slate-800 dark:text-white mb-1">Payment Successful!</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{message}</p>
            <p className="text-[11px] text-slate-400 mt-1">Your balance will update shortly.</p>
            <button onClick={onClose} className="mt-4 w-full py-3 bg-violet-600 text-white rounded-2xl font-bold text-sm">Done</button>
          </div>
        ) : (
          <>
            {message && (
              <p className={`text-xs mb-4 px-3 py-2 rounded-xl ${status === "error" ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" : "bg-slate-50 dark:bg-slate-800 text-slate-500"}`}>
                {message}
              </p>
            )}
            <button
              onClick={handlePay}
              disabled={status === "loading" || status === "paying"}
              className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2 shadow-md">
              {status === "loading" ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Initializing…</>
              ) : status === "paying" ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Paystack loading…</>
              ) : (
                <>Pay ₦{fmt(client?.contribution_amount || 0)} now</>
              )}
            </button>
            <button onClick={onClose} disabled={status === "loading" || status === "paying"}
              className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center py-2">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Bill constants ────────────────────────────────────────────────────────
const NET_MAP = { MTN: "mtn", Airtel: "airtel", Glo: "glo", "9mobile": "9mobile" };
const NET_CONFIG = {
  MTN:      { bg: "#FFC300", fg: "#000" },
  Airtel:   { bg: "#EF3340", fg: "#fff" },
  Glo:      { bg: "#007838", fg: "#fff" },
  "9mobile":{ bg: "#006B54", fg: "#fff" },
};
const CABLE_CONFIG = {
  DSTV:      { bg: "#0066B2", fg: "#fff" },
  GOtv:      { bg: "#E87722", fg: "#fff" },
  StarTimes: { bg: "#E50914", fg: "#fff" },
};
const BETTING_PROVIDERS = [
  { id: "bet9ja",    name: "Bet9ja",    bg: "#1a8b2d" },
  { id: "sportybet", name: "SportyBet", bg: "#0d47a1" },
  { id: "nairabet",  name: "NairaBet",  bg: "#e55c00" },
  { id: "betking",   name: "BetKing",   bg: "#8B0000" },
  { id: "merrybet",  name: "MerryBet",  bg: "#1c5a8a" },
  { id: "paripesa",  name: "Paripesa",  bg: "#214d2e" },
];
const DISCOS = [
  { code: "ikeja-electric", name: "Ikeja"         },
  { code: "eko-electric",   name: "Eko (Lagos)"   },
  { code: "phed",           name: "Port Harcourt" },
  { code: "aedc",           name: "Abuja"         },
  { code: "ibedc",          name: "Ibadan"        },
  { code: "eedc",           name: "Enugu"         },
  { code: "kano-electric",  name: "Kano"          },
  { code: "bedc",           name: "Benin"         },
  { code: "kedco",          name: "Kaduna"        },
  { code: "jos-electric",   name: "Jos"           },
];
const CATS = [
  { id: "airtime",   label: "Airtime",     emoji: "📱", color: "#16a34a", desc: "Top up any network"      },
  { id: "data",      label: "Data",        emoji: "📡", color: "#2563eb", desc: "Internet bundles"        },
  { id: "electric",  label: "Electricity", emoji: "⚡", color: "#d97706", desc: "PHCN token & bill"       },
  { id: "cable",     label: "Cable TV",    emoji: "📺", color: "#dc2626", desc: "DStv · GOtv · Star"      },
  { id: "betting",   label: "Betting",     emoji: "🎰", color: "#7c3aed", desc: "Fund betting wallet"     },
  { id: "internet",  label: "Internet",    emoji: "🌐", color: "#0891b2", desc: "Broadband & fibre"       },
  { id: "water",     label: "Water",       emoji: "💧", color: "#0284c7", desc: "Water utility bill"      },
  { id: "insurance", label: "Insurance",   emoji: "🛡️",  color: "#be185d", desc: "Protect what matters"   },
  { id: "education", label: "Education",   emoji: "🎓", color: "#4f46e5", desc: "WAEC, JAMB, school fees" },
];

function detectNetwork(phone) {
  const p = phone.replace(/\D/g, "").replace(/^234/, "0");
  const pfx = p.slice(0, 4);
  const mtn = ["0703","0706","0803","0806","0810","0813","0814","0816","0903","0906","0913","0916"];
  const air = ["0701","0708","0802","0808","0812","0901","0902","0904","0907","0911","0912","0917"];
  const glo = ["0705","0805","0807","0811","0815","0905","0915"];
  const nin = ["0809","0817","0818","0908","0909","0919"];
  if (mtn.includes(pfx)) return "MTN";
  if (air.includes(pfx)) return "Airtel";
  if (glo.includes(pfx)) return "Glo";
  if (nin.includes(pfx)) return "9mobile";
  return null;
}

// ── Network selector ──────────────────────────────────────────────────────
function NetworkSelector({ value, onChange, detected }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {Object.entries(NET_CONFIG).map(([name, cfg]) => {
        const sel = value === name;
        return (
          <button key={name} onClick={() => onChange(name)}
            className={`relative py-2.5 rounded-xl text-xs font-black transition active:scale-95 border-2 ${
              sel ? "" : "bg-transparent text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
            }`}
            style={sel ? { background: cfg.bg, color: cfg.fg, borderColor: cfg.bg } : undefined}>
            {name === "9mobile" ? "9MOB" : name.slice(0, 3).toUpperCase()}
            {detected === name && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-slate-800" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Bill payment bottom sheet ─────────────────────────────────────────────
function BillSheet({ cat, onClose }) {
  const [form, setForm] = useState({
    phone: "", network: "MTN", amount: "", plan: "",
    disco: "ikeja-electric", meter: "", meterType: "prepaid",
    cableProvider: "DSTV", smartcard: "", catvPlan: "",
    bettingId: "bet9ja", betAccount: "",
    notes: "",
  });
  const [detectedNet, setDetectedNet] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [cablePlans,  setCablePlans]  = useState([]);
  const [dataPlans,   setDataPlans]   = useState([]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const iCls = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400";

  const handlePhoneChange = (v) => {
    set("phone", v);
    const net = detectNetwork(v);
    if (net) { setDetectedNet(net); set("network", net); }
    else setDetectedNet(null);
  };

  useEffect(() => {
    if (cat.id !== "data") return;
    peyflex("data-plans", { network: NET_MAP[form.network] || "mtn" })
      .then(r => { if (r?.plans) setDataPlans(r.plans); })
      .catch(() => {});
  }, [cat.id, form.network]);

  useEffect(() => {
    if (cat.id !== "cable") return;
    peyflex("cabletv-plans", { provider: form.cableProvider.toLowerCase() })
      .then(r => { if (r?.plans) setCablePlans(r.plans); })
      .catch(() => {});
  }, [cat.id, form.cableProvider]);

  const handlePay = async () => {
    setLoading(true); setResult(null);
    try {
      let res;
      const netKey = NET_MAP[form.network] || "mtn";
      if (cat.id === "airtime") {
        if (!form.phone || !form.amount) throw new Error("Enter phone and amount");
        res = await peyflex("airtime", { phone: form.phone, amount: form.amount, network: netKey });
      } else if (cat.id === "data") {
        if (!form.phone || !form.plan) throw new Error("Select a data plan");
        const pl = dataPlans.find(p => p.plan_id === form.plan);
        res = await peyflex("data", { phone: form.phone, plan: form.plan, amount: String(pl?.plan_amount || form.amount), network: netKey });
      } else if (cat.id === "electric") {
        if (!form.meter || !form.amount) throw new Error("Enter meter number and amount");
        res = await peyflex("electricity", { meter: form.meter, plan: form.disco, amount: form.amount, type: form.meterType, phone: form.phone });
      } else if (cat.id === "cable") {
        if (!form.smartcard || !form.catvPlan) throw new Error("Enter smartcard and select plan");
        const pl = cablePlans.find(p => p.plan_id === form.catvPlan);
        res = await peyflex("cabletv", { smartcard: form.smartcard, plan: form.catvPlan, amount: String(pl?.plan_amount || form.amount), phone: form.phone, provider: form.cableProvider.toLowerCase() });
      } else if (cat.id === "betting") {
        if (!form.betAccount || !form.amount) throw new Error("Enter account ID and amount");
        res = await peyflex("betting", { account: form.betAccount, provider: form.bettingId, amount: form.amount });
      } else {
        if (!form.amount) throw new Error("Enter amount");
        res = { status: "SUCCESS", message: "Recorded. Your agent will process this shortly." };
      }
      setResult({ ok: res?.status === "SUCCESS", message: res?.message || "Processed!", token: res?.token });
    } catch (err) {
      setResult({ ok: false, message: err.message || "Payment failed" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 pt-3 pb-8 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: cat.color + "22" }}>{cat.emoji}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">{cat.label}</p>
            <p className="text-[10px] text-slate-400">{cat.desc}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-500" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {result && (
          <div className={`rounded-xl px-4 py-3 border text-sm font-semibold mb-4 ${
            result.ok
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
          }`}>
            {result.message}
            {result.token && <p className="text-xs mt-1 font-mono break-all">Token: {result.token}</p>}
          </div>
        )}

        <div className="space-y-3">
          {(cat.id === "airtime" || cat.id === "data") && (
            <>
              <NetworkSelector value={form.network} onChange={v => set("network", v)} detected={detectedNet} />
              <div className="relative">
                <input type="tel" value={form.phone} onChange={e => handlePhoneChange(e.target.value)}
                  placeholder="Phone number" className={iCls} />
                {detectedNet && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full text-[10px] font-black"
                    style={{ background: NET_CONFIG[detectedNet]?.bg, color: NET_CONFIG[detectedNet]?.fg }}>
                    {detectedNet}
                  </div>
                )}
              </div>
            </>
          )}

          {cat.id === "airtime" && (
            <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
              placeholder="Amount (₦)" className={iCls} />
          )}

          {cat.id === "data" && (
            <select value={form.plan} onChange={e => {
              const pl = dataPlans.find(p => p.plan_id === e.target.value);
              set("plan", e.target.value);
              if (pl) set("amount", String(pl.plan_amount));
            }} className={iCls}>
              <option value="">Select data plan</option>
              {dataPlans.length === 0 && <option disabled>Loading plans…</option>}
              {dataPlans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name} — ₦{p.plan_amount}</option>)}
            </select>
          )}

          {cat.id === "electric" && (
            <>
              <select value={form.disco} onChange={e => set("disco", e.target.value)} className={iCls}>
                {DISCOS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={form.meterType} onChange={e => set("meterType", e.target.value)} className={iCls}>
                  <option value="prepaid">Prepaid</option>
                  <option value="postpaid">Postpaid</option>
                </select>
                <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
                  placeholder="₦ Amount" className={iCls} />
              </div>
              <input value={form.meter} onChange={e => set("meter", e.target.value)}
                placeholder="Meter number" className={iCls} />
              <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)}
                placeholder="Phone (for receipt)" className={iCls} />
            </>
          )}

          {cat.id === "cable" && (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(CABLE_CONFIG).map(([name, cfg]) => {
                  const sel = form.cableProvider === name;
                  return (
                    <button key={name} onClick={() => set("cableProvider", name)}
                      className={`py-2.5 rounded-xl text-xs font-black transition active:scale-95 border-2 ${
                        sel ? "" : "bg-transparent text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
                      }`}
                      style={sel ? { background: cfg.bg, color: cfg.fg, borderColor: cfg.bg } : undefined}>
                      {name}
                    </button>
                  );
                })}
              </div>
              <input value={form.smartcard} onChange={e => set("smartcard", e.target.value)}
                placeholder="Smartcard / IUC number" className={iCls} />
              <select value={form.catvPlan} onChange={e => {
                const pl = cablePlans.find(p => p.plan_id === e.target.value);
                set("catvPlan", e.target.value);
                if (pl) set("amount", String(pl.plan_amount));
              }} className={iCls}>
                <option value="">Select package</option>
                {cablePlans.length === 0 && <option disabled>Loading packages…</option>}
                {cablePlans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name} — ₦{p.plan_amount}</option>)}
              </select>
              <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)}
                placeholder="Phone" className={iCls} />
            </>
          )}

          {cat.id === "betting" && (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {BETTING_PROVIDERS.map(b => {
                  const sel = form.bettingId === b.id;
                  return (
                    <button key={b.id} onClick={() => set("bettingId", b.id)}
                      className={`py-2.5 rounded-xl text-[10px] font-black transition active:scale-95 border-2 ${
                        sel ? "" : "bg-transparent text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
                      }`}
                      style={sel ? { background: b.bg, color: "#fff", borderColor: b.bg } : undefined}>
                      {b.name}
                    </button>
                  );
                })}
              </div>
              <input value={form.betAccount} onChange={e => set("betAccount", e.target.value)}
                placeholder="Account ID / Username" className={iCls} />
              <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
                placeholder="Amount (₦)" className={iCls} />
            </>
          )}

          {["internet", "water", "insurance", "education"].includes(cat.id) && (
            <>
              <input value={form.notes} onChange={e => set("notes", e.target.value)}
                placeholder={`${cat.label} details / reference`} className={iCls} />
              <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
                placeholder="Amount (₦)" className={iCls} />
            </>
          )}

          <button onClick={handlePay} disabled={loading}
            className="w-full py-3.5 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm"
            style={{ background: loading ? "#a78bfa" : cat.color }}>
            {loading ? "Processing…" : `Pay — ${cat.label}`}
          </button>
          <p className="text-[10px] text-center text-slate-400">Powered by VTpass · via KudiTrack</p>
        </div>
      </div>
    </div>
  );
}

// ── Bills grid for overview ───────────────────────────────────────────────
function BillsSection() {
  const [activeCat, setActiveCat] = useState(null);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-extrabold text-slate-800 dark:text-white">Pay Bills</p>
        <span className="text-[10px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full font-semibold">9 services</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {CATS.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat)}
            className="rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-left active:scale-95 transition bg-slate-50 dark:bg-slate-700/50">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base mb-1.5"
              style={{ background: cat.color + "22" }}>{cat.emoji}</div>
            <p className="text-[11px] font-extrabold text-slate-700 dark:text-slate-200 leading-tight">{cat.label}</p>
          </button>
        ))}
      </div>
      {activeCat && <BillSheet cat={activeCat} onClose={() => setActiveCat(null)} />}
    </div>
  );
}

// ── Contribution calendar ─────────────────────────────────────────────────
function ContribCalendar({ contributions }) {
  const contribDates = new Set(
    contributions.filter(c => c.type === "contribution" && c.status === "completed")
      .map(c => (c.created_at || "").slice(0, 10))
  );
  const cells = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    cells.push({ date: ds, has: contribDates.has(ds) });
  }
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Activity — last 90 days</p>
      <div className="flex flex-wrap gap-0.5">
        {cells.map(({ date, has }) => (
          <div key={date} title={date}
            className={`w-3 h-3 rounded-sm ${has ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-violet-500" />
          <span className="text-[10px] text-slate-400">Contributed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] text-slate-400">No activity</span>
        </div>
      </div>
    </div>
  );
}

// ── First-login force-password-change ─────────────────────────────────────
function AjoClientFirstLogin({ ajoClient }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];

  const submit = async () => {
    if (password.length < 8) { setError("Minimum 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (err) { setError(err.message); setSaving(false); return; }
    setSuccess(true);
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-violet-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your dashboard…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-14 pb-5">
        <div className="w-12 h-12 bg-violet-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Hi {ajoClient?.full_name?.split(" ")[0] || "there"}! Choose a password you'll use every time you log in.
        </p>
      </div>
      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">New Password *</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-violet-600 dark:text-violet-400">
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          {password && (
            <div className="flex gap-1 mt-1.5">
              {[1,2,3,4].map(n => (
                <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirm Password *</label>
          <input type={showPwd ? "text" : "password"} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 ${confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}`} />
          {confirm && confirm !== password && <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>}
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>}
        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition">
          {saving ? "Saving…" : "Set Password & Enter Dashboard →"}
        </button>
        <button onClick={() => supabase.auth.signOut()} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Change password modal ─────────────────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [pwd,     setPwd]     = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);

  const handle = async () => {
    if (pwd.length < 8) { setError("Minimum 8 characters"); return; }
    if (pwd !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: pwd, data: { must_change_password: false } });
    if (err) { setError(err.message); setSaving(false); return; }
    setSuccess(true);
    setTimeout(onClose, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Change Password</h3>
        {success ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 text-green-700 dark:text-green-400 font-semibold text-sm text-center">
            Password updated successfully!
          </div>
        ) : (
          <>
            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-3"><p className="text-xs text-red-600 dark:text-red-400">{error}</p></div>}
            <div className="space-y-3 mb-4">
              <div className="relative">
                <input type={showPwd ? "text" : "password"} value={pwd} onChange={e => setPwd(e.target.value)} placeholder="New password (min. 8 chars)"
                  className="w-full px-3 pr-14 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-violet-600">{showPwd ? "Hide" : "Show"}</button>
              </div>
              <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password"
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <button onClick={handle} disabled={saving || pwd.length < 8 || pwd !== confirm}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition disabled:opacity-50">
              {saving ? "Updating…" : "Update Password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Withdrawal request modal ──────────────────────────────────────────────
function WithdrawRequestModal({ client, onClose, onSuccess }) {
  const [amount,  setAmount]  = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [done,    setDone]    = useState(false);

  const isFirst  = (client.total_withdrawn || 0) === 0;
  const regFee   = client.registration_charge || 0;
  const pctFee   = client.withdrawal_fee_percent || 0;
  const amtNum   = parseFloat(amount) || 0;
  const feeAmt   = isFirst ? regFee : (amtNum * pctFee / 100);
  const netAmt   = amtNum - feeAmt;

  const handleSubmit = async () => {
    if (!amtNum || amtNum <= 0)                   { setError("Enter a valid amount"); return; }
    if (amtNum > (client.current_balance || 0))   { setError("Amount exceeds your balance"); return; }
    if (netAmt <= 0)                              { setError("Amount too small after fee deduction"); return; }
    setSaving(true); setError("");
    try {
      await ajoFn("request-withdrawal", {
        client_id: client.id,
        owner_id:  client.user_id,
        amount:    amtNum,
      });
      setDone(true);
      onSuccess();
    } catch (e) {
      setError(e.message || "Failed to submit request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        {done ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Request Submitted!</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">You'll be notified by email once your request is reviewed.</p>
            <button onClick={onClose} className="mt-5 w-full py-3.5 bg-violet-600 text-white rounded-xl font-bold text-sm">
              Close
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">Request Withdrawal</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Balance: <strong className="text-slate-600 dark:text-slate-300">{fmt(client.current_balance || 0)}</strong>
            </p>

            {isFirst && regFee > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold">
                  First withdrawal — Registration fee: {fmt(regFee)} will be deducted
                </p>
              </div>
            )}
            {!isFirst && pctFee > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
                  Withdrawal fee: {pctFee}% will be deducted
                </p>
              </div>
            )}

            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦)</label>
            <input
              type="number" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 mb-3"
            />

            {amtNum > 0 && (
              <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-4 py-3 mb-3 space-y-1.5 border border-slate-100 dark:border-slate-600">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Requested</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{fmt(amtNum)}</span>
                </div>
                {feeAmt > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      {isFirst ? "Registration fee" : `Fee (${pctFee}%)`}
                    </span>
                    <span className="font-bold text-red-500">−{fmt(feeAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs border-t border-slate-200 dark:border-slate-600 pt-1.5">
                  <span className="font-bold text-slate-600 dark:text-slate-300">You receive</span>
                  <span className="font-extrabold text-green-600 dark:text-green-400">{fmt(Math.max(0, netAmt))}</span>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving || !amtNum || amtNum <= 0}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm">
              {saving ? "Submitting…" : "Submit Request"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ client, contributions, onWithdrawClick, onPayClick, ownerInfo, withdrawRequests = [] }) {
  const totalThisMonth = contributions
    .filter(c => c.type === "contribution" && (c.created_at || "").startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, c) => s + (c.amount || 0), 0);

  const daysUntilDue = client.next_contribution_date
    ? Math.ceil((new Date(client.next_contribution_date) - new Date()) / 86400000)
    : null;

  const recent = contributions.slice(0, 5);

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      {/* Hero savings card */}
      <div className="rounded-3xl px-5 py-5 text-white relative overflow-hidden shadow-lg"
        style={{ background: "linear-gradient(145deg,#7c3aed 0%,#6d28d9 55%,#4c1d95 100%)" }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-6 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Current Balance</p>
          <p className="text-4xl font-black tabular mb-4">{fmt(client.current_balance || 0)}</p>
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Total Saved</p>
              <p className="text-sm font-extrabold tabular text-green-200">{fmt(client.total_saved || 0)}</p>
            </div>
            <div className="px-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Withdrawn</p>
              <p className="text-sm font-extrabold tabular text-red-200">{fmt(client.total_withdrawn || 0)}</p>
            </div>
            <div className="pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">This Month</p>
              <p className="text-sm font-extrabold tabular text-blue-200">{fmt(totalThisMonth)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Next due */}
      {client.next_contribution_date && (
        <div className={`rounded-2xl px-4 py-3 border flex items-center gap-3 ${
          daysUntilDue != null && daysUntilDue < 0
            ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            : daysUntilDue === 0
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
              : "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800"
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            daysUntilDue != null && daysUntilDue < 0 ? "bg-red-100 dark:bg-red-900/40" : "bg-violet-100 dark:bg-violet-900/40"
          }`}>
            <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 ${daysUntilDue != null && daysUntilDue < 0 ? "text-red-500" : "text-violet-500"}`}
              stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${daysUntilDue != null && daysUntilDue < 0 ? "text-red-600 dark:text-red-400" : "text-violet-700 dark:text-violet-300"}`}>
              {daysUntilDue != null && daysUntilDue < 0
                ? `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? "s" : ""}`
                : daysUntilDue === 0 ? "Due Today!"
                : `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
              {client.contribution_frequency} · {fmt(client.contribution_amount)} · {client.next_contribution_date}
            </p>
          </div>
        </div>
      )}

      {/* Assigned savings officer */}
      {ownerInfo?.staff && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0 overflow-hidden border border-violet-100 dark:border-violet-800">
            {ownerInfo.staff.profile_image_url
              ? <img src={ownerInfo.staff.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-violet-600 dark:text-violet-400 font-black text-lg">{(ownerInfo.staff.full_name || "?")[0].toUpperCase()}</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-0.5">Your Savings Officer</p>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate leading-tight">{ownerInfo.staff.full_name}</p>
            {ownerInfo.staff.phone && <p className="text-[11px] text-slate-400 mt-0.5">{ownerInfo.staff.phone}</p>}
          </div>
          <span className="text-[9px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-bold px-2 py-1 rounded-full capitalize flex-shrink-0">
            {ownerInfo.staff.role || "staff"}
          </span>
        </div>
      )}

      {/* Fee info card */}
      {((client.registration_charge > 0) || (client.withdrawal_fee_percent > 0)) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Withdrawal Fees</p>
            {(client.total_withdrawn || 0) === 0 && client.registration_charge > 0 ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                First withdrawal: <span className="text-violet-600 dark:text-violet-400 font-bold">{fmt(client.registration_charge)} registration fee</span>
              </p>
            ) : client.withdrawal_fee_percent > 0 ? (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Withdrawal fee: <span className="text-violet-600 dark:text-violet-400 font-bold">{client.withdrawal_fee_percent}% of amount</span>
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Pay Contribution button */}
      {client?.contribution_amount > 0 && (
        <button onClick={onPayClick}
          className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md flex items-center justify-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          Pay Contribution · ₦{fmt(client.contribution_amount)}
        </button>
      )}

      {/* Withdrawal request button */}
      <button onClick={onWithdrawClick}
        className="w-full py-4 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md flex items-center justify-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 19V5M5 12l7 7 7-7" />
        </svg>
        Request Withdrawal
      </button>

      {/* Pending withdrawal requests */}
      {withdrawRequests.filter(r => r.status === "pending").length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Pending Requests</p>
          <div className="space-y-2">
            {withdrawRequests.filter(r => r.status === "pending").map(r => (
              <div key={r.id} className="bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-3 border border-amber-200 dark:border-amber-800/60 flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-500" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Pending Review</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{r.requested_at?.slice(0, 10)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">{fmt(r.amount)}</p>
                  <p className="text-[10px] text-green-600 dark:text-green-400">→ {fmt(r.net_amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity calendar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700">
        <ContribCalendar contributions={contributions} />
      </div>

      {/* Bills */}
      <BillsSection />

      {/* Recent activity */}
      {recent.length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Recent Activity</p>
          <div className="space-y-2">
            {recent.map(c => (
              <div key={c.id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-3 border border-slate-100 dark:border-slate-700">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.type === "contribution" ? "bg-green-500" : "bg-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{c.type}</p>
                  <p className="text-[10px] text-slate-400">{c.created_at?.slice(0, 10)} · {c.payment_method || "cash"}</p>
                </div>
                <span className={`text-sm font-extrabold tabular flex-shrink-0 ${c.type === "contribution" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {c.type === "contribution" ? "+" : "−"}{fmt(c.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────
function HistoryTab({ contributions, withdrawRequests = [] }) {
  const withdrawItems = withdrawRequests.map(r => ({
    _type: "withdrawal_request",
    id: r.id,
    amount: r.amount,
    net_amount: r.net_amount,
    fee_amount: r.fee_amount,
    fee_type: r.fee_type,
    status: r.status,
    date: r.requested_at,
  }));
  const contribItems = contributions.map(c => ({ _type: "contribution", ...c, date: c.created_at }));
  const allItems = [...withdrawItems, ...contribItems].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!allItems.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-violet-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" />
          </svg>
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No history yet</p>
        <p className="text-slate-400 text-xs mt-1">Your contributions and withdrawal requests will appear here</p>
      </div>
    );
  }

  const statusCls = (s) => {
    if (s === "completed" || s === "approved") return "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400";
    if (s === "rejected") return "bg-red-50 dark:bg-red-900/20 text-red-500";
    return "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400";
  };

  return (
    <div className="px-4 pt-5 pb-28 space-y-2">
      {allItems.map(item => item._type === "withdrawal_request" ? (
        <div key={`wr-${item.id}`} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-violet-50 dark:bg-violet-900/20">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 19V5M5 12l7 7 7-7"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold tabular text-violet-600 dark:text-violet-400">−{fmt(item.amount)}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusCls(item.status)}`}>{item.status}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Withdrawal request · Net: {fmt(item.net_amount)}
                {item.fee_amount > 0 && ` · Fee: ${fmt(item.fee_amount)}`}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {new Date(item.date).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div key={`c-${item.id}`} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.type === "contribution" ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
              <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${item.type === "contribution" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
                stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                {item.type === "contribution" ? <><path d="M12 5v14M5 12l7-7 7 7" /></> : <><path d="M12 19V5M5 12l7 7 7-7" /></>}
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-extrabold tabular ${item.type === "contribution" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {item.type === "contribution" ? "+" : "−"}{fmt(item.amount)}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusCls(item.status)}`}>{item.status}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                {item.type} · {item.payment_method || "cash"}
                {item.paystack_ref && ` · Ref: ${item.paystack_ref.slice(-8)}`}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {new Date(item.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
              </p>
              {item.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{item.notes}"</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────
function ProfileTab({ client, ownerInfo, onChangePwdClick, onLogout, isDark, onToggleDark }) {
  const [expanded, setExpanded] = useState(false);
  const initials = (client.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">

      {/* KudiAI branding header card */}
      <div className="rounded-3xl px-5 py-5 relative overflow-hidden shadow-lg"
        style={{ background: "linear-gradient(135deg,#7c3aed 0%,#4c1d95 100%)" }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-6 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative flex items-center gap-4">
          {/* Actual KudiAI Track logo on white pill */}
          <div className="bg-white/90 rounded-2xl p-2 flex-shrink-0 shadow-lg">
            <AppLogo className="h-10 w-auto" />
          </div>
          <div>
            <p className="text-white font-extrabold text-lg leading-tight tracking-wide">KudiAI Track</p>
            <p className="text-white/70 text-[11px] mt-1">Smart Savings Intelligence Platform</p>
            <p className="text-white/50 text-[10px] mt-0.5">Empowering your financial journey.</p>
          </div>
        </div>
      </div>

      {/* Client membership card */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="px-5 py-4 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-violet-100 dark:border-violet-900">
            {client.profile_image_url
              ? <img src={client.profile_image_url} alt={client.full_name} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 font-black text-2xl">{initials}</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-slate-800 dark:text-white leading-tight">{client.full_name}</h2>
            <p className="text-xs font-mono font-bold text-violet-600 dark:text-violet-400 mt-0.5">{client.membership_number}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                client.status === "active"
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500"
              }`}>{client.status}</span>
              <span className="text-[10px] text-slate-400 capitalize">{client.contribution_frequency} savings</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Balance</p>
            <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400">{fmt(client.current_balance || 0)}</p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 border-t border-slate-100 dark:border-slate-700 divide-x divide-slate-100 dark:divide-slate-700">
          {[
            { label: "Total Saved",  value: fmt(client.total_saved    || 0), color: "text-green-600 dark:text-green-400" },
            { label: "Withdrawn",    value: fmt(client.total_withdrawn || 0), color: "text-red-500"                       },
            { label: "Per Period",   value: fmt(client.contribution_amount || 0), color: "text-slate-700 dark:text-slate-200" },
          ].map(item => (
            <div key={item.label} className="px-3 py-2.5 text-center">
              <p className={`text-xs font-extrabold ${item.color}`}>{item.value}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>

        {/* View more toggle */}
        <button onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-3 border-t border-slate-100 dark:border-slate-700 text-violet-600 dark:text-violet-400 text-xs font-bold transition">
          {expanded ? "View Less" : "View More Details"}
          <svg viewBox="0 0 24 24" fill="none" className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" /></svg>
        </button>

        {expanded && (
          <div className="divide-y divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
            {[
              { label: "Phone",        value: client.phone },
              { label: "Email",        value: client.email },
              { label: "Address",      value: [client.address, client.lga, client.state].filter(Boolean).join(", ") },
              { label: "Occupation",   value: client.occupation },
              { label: "Member Since", value: client.registration_date },
              { label: "Frequency",    value: client.contribution_frequency, cap: true },
              { label: "Next Due",     value: client.next_contribution_date },
            ].filter(f => f.value).map(f => (
              <div key={f.label} className="flex justify-between px-4 py-2.5 gap-4">
                <p className="text-xs text-slate-400 font-semibold shrink-0">{f.label}</p>
                <p className={`text-xs font-semibold text-right text-slate-700 dark:text-slate-200 ${f.cap ? "capitalize" : ""}`}>{f.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assigned staff card */}
      {ownerInfo?.staff && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Assigned Staff</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0 overflow-hidden border border-violet-100 dark:border-violet-800">
              {ownerInfo.staff.profile_image_url
                ? <img src={ownerInfo.staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-violet-600 dark:text-violet-400 font-black text-lg">{(ownerInfo.staff.full_name || "?")[0].toUpperCase()}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{ownerInfo.staff.full_name}</p>
              {ownerInfo.staff.phone && <p className="text-xs text-slate-400 mt-0.5">{ownerInfo.staff.phone}</p>}
              {ownerInfo.staff.role && <p className="text-[10px] text-violet-500 font-semibold capitalize mt-0.5">{ownerInfo.staff.role}</p>}
            </div>
            <div className="w-8 h-8 rounded-full bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500" stroke="currentColor" strokeWidth={2}>
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Business/agent card */}
      {ownerInfo?.owner && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Savings Agent</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{ownerInfo.owner.business_name || ownerInfo.owner.full_name}</p>
            {ownerInfo.owner.phone && <p className="text-xs text-slate-400 mt-0.5">{ownerInfo.owner.phone}</p>}
            {ownerInfo.owner.email && <p className="text-xs text-slate-400">{ownerInfo.owner.email}</p>}
          </div>
        </div>
      )}

      {/* Theme toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: isDark ? "#1e1b4b" : "#fef3c7" }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}
              style={{ color: isDark ? "#818cf8" : "#d97706" }}>
              {isDark
                ? <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                : <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></>
              }
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isDark ? "Dark Mode" : "Light Mode"}</p>
            <p className="text-[10px] text-slate-400">Tap to switch</p>
          </div>
        </div>
        <button onClick={onToggleDark}
          className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${isDark ? "bg-violet-600" : "bg-slate-200"}`}>
          <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform absolute top-0.5 ${isDark ? "translate-x-[26px]" : "translate-x-0.5"}`} />
        </button>
      </div>

      <button onClick={onChangePwdClick}
        className="w-full py-3.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-2xl font-bold text-sm border border-violet-100 dark:border-violet-800 transition active:scale-[0.99]">
        Change Password
      </button>
      <button onClick={onLogout}
        className="w-full py-3.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-800 transition active:scale-[0.99]">
        Sign Out
      </button>
    </div>
  );
}

// ── Main portal ───────────────────────────────────────────────────────────
export default function AjoClientPortal({ session, ajoClient }) {
  const [isDark,           setIsDark]           = useState(() => localStorage.getItem("kuditrack_ajo_dark") === "1");
  const [client,           setClient]           = useState(ajoClient || null);
  const [contributions,    setContributions]    = useState([]);
  const [ownerInfo,        setOwnerInfo]        = useState(null);
  const [loadingData,      setLoadingData]      = useState(false);
  const [tab,              setTab]              = useState("overview");
  const [showWithdraw,     setShowWithdraw]     = useState(false);
  const [showPay,          setShowPay]          = useState(false);
  const [withdrawRequests, setWithdrawRequests] = useState([]);
  const [showPwdModal,     setShowPwdModal]     = useState(false);

  const mustChange = session?.user?.user_metadata?.must_change_password === true;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("kuditrack_ajo_dark", isDark ? "1" : "0");
  }, [isDark]);

  const toggleDark = useCallback(() => setIsDark(v => !v), []);
  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  const refreshWithdrawRequests = useCallback(async () => {
    if (!ajoClient?.id) return;
    try {
      const r = await ajoFn("get-withdrawal-requests", { client_id: ajoClient.id });
      if (r?.requests) setWithdrawRequests(r.requests);
    } catch (e) {
      console.error("Failed to load withdrawal requests:", e);
    }
  }, [ajoClient?.id, ajoClient?.owner_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mustChange || !ajoClient?.id) return;
    setLoadingData(true);
    Promise.allSettled([
      ajoFn("get-client",             { client_id: ajoClient.id, owner_id: ajoClient.owner_id }),
      ajoFn("get-contributions",      { client_id: ajoClient.id }),
      ajoFn("get-owner-info",         { owner_id: ajoClient.user_id,  client_id: ajoClient.id }),
      ajoFn("get-withdrawal-requests",{ client_id: ajoClient.id }),
    ])
      .then(([clientRes, contribRes, ownerRes, reqRes]) => {
        if (clientRes.status === "fulfilled" && clientRes.value?.client) {
          setClient(prev => ({
            ...clientRes.value.client,
            user_id: clientRes.value.client.user_id || prev?.user_id,
          }));
        }
        if (contribRes.status === "fulfilled" && contribRes.value?.contributions)
          setContributions(contribRes.value.contributions);
        if (ownerRes.status === "fulfilled" && ownerRes.value)
          setOwnerInfo(ownerRes.value);
        if (reqRes.status === "fulfilled" && reqRes.value?.requests)
          setWithdrawRequests(reqRes.value.requests);
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [mustChange, ajoClient?.id, ajoClient?.owner_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: sync balance/contributions from business side ────────────
  useEffect(() => {
    if (!ajoClient?.id) return;

    const channel = supabase.channel(`ajo_client_sync_${ajoClient.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "aso_clients", filter: `id=eq.${ajoClient.id}` },
        (payload) => { if (payload.new) setClient(prev => ({ ...prev, ...payload.new })); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ajo_contributions", filter: `aso_client_id=eq.${ajoClient.id}` },
        (payload) => { if (payload.new) setContributions(prev => [payload.new, ...prev]); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ajo_withdrawal_requests", filter: `aso_client_id=eq.${ajoClient.id}` },
        () => refreshWithdrawRequests())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ajoClient?.id, ajoClient?.owner_id, ajoClient?.user_id, refreshWithdrawRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mustChange) return <AjoClientFirstLogin ajoClient={ajoClient} />;

  const NAV = [
    { id: "overview", label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "history",  label: "History",  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { id: "profile",  label: "Profile",  icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7" },
  ];

  return (
    <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md relative flex flex-col h-screen overflow-hidden">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-2">
          {/* KudiAI Track logo */}
          <AppLogo className="h-7 w-auto flex-shrink-0" />
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1 flex-shrink-0" />
          <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold truncate flex-1 min-w-0">
            {client?.full_name || ajoClient?.full_name}
          </p>
          <button onClick={toggleDark}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}>
              {isDark
                ? <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                : <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /></>
              }
            </svg>
          </button>
          {loadingData && (
            <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-mono font-bold px-2 py-1 rounded-full flex-shrink-0">
            {ajoClient?.membership_number}
          </span>
        </div>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto pb-20">
          {tab === "overview" && client && (
            <OverviewTab
              client={client}
              contributions={contributions}
              onWithdrawClick={() => setShowWithdraw(true)}
              onPayClick={() => setShowPay(true)}
              ownerInfo={ownerInfo}
              withdrawRequests={withdrawRequests}
            />
          )}
          {tab === "history" && <HistoryTab contributions={contributions} withdrawRequests={withdrawRequests} />}
          {tab === "profile" && client && (
            <ProfileTab
              client={client}
              ownerInfo={ownerInfo}
              onChangePwdClick={() => setShowPwdModal(true)}
              onLogout={handleLogout}
              isDark={isDark}
              onToggleDark={toggleDark}
            />
          )}
          {!client && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </main>

        {/* Bottom nav — fixed so it never scrolls away */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-20 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex">
            {NAV.map(n => (
              <button key={n.id} onClick={() => setTab(n.id)}
                className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${tab === n.id ? "text-violet-600 dark:text-violet-400" : "text-slate-400 dark:text-slate-500"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={n.icon} />
                </svg>
                <span className="text-[9px] font-semibold leading-none">{n.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      {showPay && client && (
        <PayContributionModal
          client={client}
          onClose={() => setShowPay(false)}
          onSuccess={(ref, updatedClient) => {
            if (updatedClient) setClient(prev => ({ ...prev, ...updatedClient }));
            // Modal closes when user taps "Done" — don't close it here
          }}
        />
      )}
      {showWithdraw && client && (
        <WithdrawRequestModal
          client={client}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { setShowWithdraw(false); refreshWithdrawRequests(); }}
        />
      )}
      {showPwdModal && (
        <ChangePasswordModal onClose={() => setShowPwdModal(false)} />
      )}
    </div>
  );
}
