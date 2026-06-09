import { useState, useEffect, useRef, useCallback } from "react";
import { usePaystackPayment } from "react-paystack";
import { supabase } from "../utils/supabase";
import { peyflex } from "../utils/peyflex";
import { fmt } from "../utils/helpers";

// ── Edge function proxy ───────────────────────────────────────────────────
async function ajoFn(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("ajo-portal", {
    body: { action, ...body },
  });
  if (error) throw new Error(error.message || "Portal request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

function savePortalSession(session) {
  localStorage.setItem("kt_portal_session", JSON.stringify({
    ...session,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }));
}

// ── Contribution calendar (last 90 days) ─────────────────────────────────
function ContribCalendar({ contributions }) {
  const contribDates = new Set(
    contributions
      .filter(c => c.type === "contribution" && c.status === "completed")
      .map(c => (c.created_at || "").slice(0, 10))
  );
  const cells = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    cells.push({ date: ds, has: contribDates.has(ds) });
  }
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
        Activity Calendar — last 90 days
      </p>
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

// ── Portal Login screen ───────────────────────────────────────────────────
function PortalLogin({ onLogin, onExit }) {
  const [membershipNo, setMembershipNo] = useState("");
  const [pin, setPin]                   = useState("");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  const handleLogin = useCallback(async () => {
    const mn = membershipNo.trim().toUpperCase();
    const p  = pin.trim();
    if (!mn || !p) { setError("Enter your membership number and PIN"); return; }
    setLoading(true);
    setError("");
    try {
      const { client } = await ajoFn("auth", { membership_number: mn, pin: p });
      const session = {
        client_id:         client.id,
        owner_id:          client.owner_id,
        membership_number: client.membership_number,
        full_name:         client.full_name,
        profile_image_url: client.profile_image_url,
      };
      savePortalSession(session);
      onLogin(session, client);
    } catch (err) {
      setError(err.message || "Login failed. Check your details.");
    } finally {
      setLoading(false);
    }
  }, [membershipNo, pin, onLogin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-violet-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-white">Ajo Client Portal</h1>
          <p className="text-violet-300 text-sm mt-1">Access your savings account</p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 text-center">Sign In</p>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-4">
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-3 mb-4">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Membership Number</label>
              <input
                type="text"
                value={membershipNo}
                onChange={e => setMembershipNo(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="AJO-202606-XXXXXX"
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 uppercase"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">PIN (4 digits)</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="••••"
                inputMode="numeric"
                maxLength={4}
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>

          <button onClick={handleLogin} disabled={loading}
            className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm disabled:opacity-50">
            {loading ? "Signing in…" : "Sign In"}
          </button>

          {onExit && (
            <button onClick={onExit} className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition">
              ← Back to Business Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Paystack payment button ───────────────────────────────────────────────
function PaystackPayBtn({ amount, email, referenceId, onSuccess, onClose, disabled }) {
  const config = {
    reference: referenceId,
    email:     email || "client@kuditrack.app",
    amount:    Math.round(amount * 100),
    publicKey: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || "",
    currency:  "NGN",
    channels:  ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
  };
  const initializePayment = usePaystackPayment(config);

  if (!process.env.REACT_APP_PAYSTACK_PUBLIC_KEY) {
    return (
      <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5 text-center">
        Online payment not configured. Contact your savings agent.
      </div>
    );
  }

  return (
    <button
      onClick={() => initializePayment(onSuccess, onClose)}
      disabled={disabled || amount <= 0}
      className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm flex items-center justify-center gap-2">
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
      </svg>
      Pay {amount > 0 ? fmt(amount) : ""} via Paystack
    </button>
  );
}

// ── Contribute modal ──────────────────────────────────────────────────────
function ContributeModal({ client, onSuccess, onClose }) {
  const [amount, setAmount] = useState(String(client.contribution_amount || ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refId = useRef(`KDT-AJO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);

  const handlePaystackSuccess = useCallback(async (transaction) => {
    setLoading(true);
    try {
      const { client: updated } = await ajoFn("record-contribution", {
        client_id:      client.id,
        owner_id:       client.owner_id,
        amount:         parseFloat(amount),
        payment_method: "paystack",
        paystack_ref:   transaction.reference || refId.current,
      });
      onSuccess(updated);
    } catch (err) {
      setError("Payment received but recording failed. Please contact your agent with reference: " + (transaction.reference || refId.current));
      setLoading(false);
    }
  }, [client.id, client.owner_id, amount, onSuccess]);

  const handlePaystackClose = useCallback(() => setLoading(false), []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">Make Contribution</h3>
        <p className="text-xs text-slate-400 mb-4 capitalize">
          Suggested: {fmt(client.contribution_amount || 0)} · {client.contribution_frequency}
        </p>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-3">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦)</label>
        <input type="number" value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="Enter amount"
          className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 mb-4" />

        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {["💳 Card", "🏦 Bank", "#️⃣ USSD", "📱 Mobile"].map(m => (
            <div key={m} className="bg-slate-50 dark:bg-slate-700 rounded-xl py-2 text-center text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              {m}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="w-full py-3.5 bg-violet-400 text-white rounded-xl font-bold text-sm text-center">
            Recording payment…
          </div>
        ) : (
          <PaystackPayBtn
            amount={parseFloat(amount) || 0}
            email={client.email}
            referenceId={refId.current}
            onSuccess={handlePaystackSuccess}
            onClose={handlePaystackClose}
          />
        )}
      </div>
    </div>
  );
}

// ── Simplified bill payments for client portal ────────────────────────────
const NETWORKS      = ["mtn", "airtel", "glo", "etisalat"];
const DISCOS        = [
  { code: "ikeja-electric", name: "Ikeja" }, { code: "eko-electric", name: "Eko (Lagos)" },
  { code: "phed", name: "Port Harcourt" },   { code: "aedc", name: "Abuja" },
  { code: "ibedc", name: "Ibadan" },         { code: "eedc", name: "Enugu" },
  { code: "kano-electric", name: "Kano" },   { code: "bedc", name: "Benin" },
];
const CABLE_PROVIDERS = ["dstv", "gotv", "startimes"];

function ClientBills() {
  const [billTab, setBillTab] = useState("airtime");
  const [form, setForm]       = useState({
    phone: "", network: "mtn", amount: "",
    disco: "ikeja-electric", meter: "", meterType: "prepaid",
    provider: "dstv", smartcard: "", plan: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handlePay = async () => {
    setLoading(true);
    setResult(null);
    try {
      let res;
      if (billTab === "airtime") {
        if (!form.phone || !form.amount) throw new Error("Enter phone and amount");
        res = await peyflex("airtime", { phone: form.phone, amount: form.amount, network: form.network });
      } else if (billTab === "data") {
        if (!form.phone || !form.plan) throw new Error("Enter phone and plan ID");
        res = await peyflex("data", { phone: form.phone, plan: form.plan, amount: form.amount, network: form.network });
      } else if (billTab === "electricity") {
        if (!form.meter || !form.amount) throw new Error("Enter meter number and amount");
        res = await peyflex("electricity", { meter: form.meter, disco: form.disco, meterType: form.meterType, amount: form.amount, phone: form.phone });
      } else {
        if (!form.smartcard || !form.plan) throw new Error("Enter smartcard number and plan");
        res = await peyflex("cabletv", { smartcard: form.smartcard, plan: form.plan, amount: form.amount, phone: form.phone, provider: form.provider });
      }
      setResult({ ok: res?.status === "SUCCESS", message: res?.message || "Payment successful!", token: res?.token });
    } catch (err) {
      setResult({ ok: false, message: err.message || "Payment failed. Check VTpass wallet." });
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="px-4 pt-4 pb-8 space-y-4">
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        {["airtime", "data", "electricity", "cable"].map(bt => (
          <button key={bt} onClick={() => { setBillTab(bt === "cable" ? "cable_tv" : bt); setResult(null); }}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition ${(billTab === bt || (billTab === "cable_tv" && bt === "cable")) ? "bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
            {bt.charAt(0).toUpperCase() + bt.slice(1)}
          </button>
        ))}
      </div>

      {result && (
        <div className={`rounded-xl px-4 py-3 border text-sm font-semibold ${result.ok ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"}`}>
          {result.message}
          {result.token && <p className="text-xs mt-1 font-mono break-all">Token: {result.token}</p>}
        </div>
      )}

      {billTab === "airtime" && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {NETWORKS.map(n => (
              <button key={n} onClick={() => set("network", n)}
                className={`py-2 rounded-xl text-xs font-bold border transition ${form.network === n ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"}`}>
                {n.toUpperCase()}
              </button>
            ))}
          </div>
          <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="Phone number" className={inputCls} />
          <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Amount (₦)" className={inputCls} />
        </div>
      )}

      {billTab === "data" && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {NETWORKS.map(n => (
              <button key={n} onClick={() => set("network", n)}
                className={`py-2 rounded-xl text-xs font-bold border transition ${form.network === n ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"}`}>
                {n.toUpperCase()}
              </button>
            ))}
          </div>
          <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="Phone number" className={inputCls} />
          <input value={form.plan} onChange={e => set("plan", e.target.value)} placeholder="Plan ID (e.g. 1000)" className={inputCls} />
          <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Amount (₦)" className={inputCls} />
        </div>
      )}

      {billTab === "electricity" && (
        <div className="space-y-3">
          <select value={form.disco} onChange={e => set("disco", e.target.value)} className={inputCls}>
            {DISCOS.map(d => <option key={d.code} value={d.code}>{d.name} Electric</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.meterType} onChange={e => set("meterType", e.target.value)} className={inputCls}>
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
            <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Amount (₦)" className={inputCls} />
          </div>
          <input value={form.meter} onChange={e => set("meter", e.target.value)} placeholder="Meter number" className={inputCls} />
          <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="Phone (for receipt)" className={inputCls} />
        </div>
      )}

      {billTab === "cable_tv" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {CABLE_PROVIDERS.map(p => (
              <button key={p} onClick={() => set("provider", p)}
                className={`py-2 rounded-xl text-xs font-bold border transition ${form.provider === p ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"}`}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <input value={form.smartcard} onChange={e => set("smartcard", e.target.value)} placeholder="Smartcard / IUC number" className={inputCls} />
          <input value={form.plan} onChange={e => set("plan", e.target.value)} placeholder="Package code (e.g. dstv-padi)" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Amount (₦)" className={inputCls} />
            <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="Phone" className={inputCls} />
          </div>
        </div>
      )}

      <button onClick={handlePay} disabled={loading}
        className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] disabled:opacity-50 shadow-sm">
        {loading ? "Processing…" : "Pay Now"}
      </button>
      <p className="text-[10px] text-center text-slate-400">Powered by VTpass · Live via KudiTrack</p>
    </div>
  );
}

// ── Change PIN modal ──────────────────────────────────────────────────────
function ChangePinModal({ clientId, onClose }) {
  const [f, setF] = useState({ old: "", new1: "", new2: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleChange = async () => {
    if (!/^\d{4}$/.test(f.new1)) { setError("New PIN must be exactly 4 digits"); return; }
    if (f.new1 !== f.new2) { setError("New PINs do not match"); return; }
    setLoading(true);
    setError("");
    try {
      await ajoFn("change-pin", { client_id: clientId, old_pin: f.old, new_pin: f.new1 });
      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      setError(err.message || "Failed to change PIN");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Change PIN</h3>

        {success ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 text-green-700 dark:text-green-400 font-semibold text-sm text-center">
            PIN changed successfully!
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-3">
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Current PIN</label>
                <input type="password" value={f.old} onChange={e => setF(p => ({ ...p, old: e.target.value.replace(/\D/g, "").slice(0, 4) }))} maxLength={4} inputMode="numeric" className={inputCls} placeholder="••••" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">New PIN</label>
                <input type="password" value={f.new1} onChange={e => setF(p => ({ ...p, new1: e.target.value.replace(/\D/g, "").slice(0, 4) }))} maxLength={4} inputMode="numeric" className={inputCls} placeholder="••••" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Confirm New PIN</label>
                <input type="password" value={f.new2} onChange={e => setF(p => ({ ...p, new2: e.target.value.replace(/\D/g, "").slice(0, 4) }))} maxLength={4} inputMode="numeric" className={inputCls} placeholder="••••" />
              </div>
            </div>
            <button onClick={handleChange} disabled={loading}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition disabled:opacity-50">
              {loading ? "Updating…" : "Update PIN"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Dashboard Overview ────────────────────────────────────────────────────
function OverviewTab({ client, contributions, onPayClick }) {
  const recent = contributions.slice(0, 10);
  const totalThisMonth = contributions
    .filter(c => c.type === "contribution" && (c.created_at || "").startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, c) => s + (c.amount || 0), 0);

  const daysUntilDue = client.next_contribution_date
    ? Math.ceil((new Date(client.next_contribution_date) - new Date()) / 86400000)
    : null;

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      {/* Hero */}
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
        <div className={`rounded-2xl px-4 py-3 border flex items-center gap-3 ${daysUntilDue != null && daysUntilDue < 0 ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" : daysUntilDue === 0 ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" : "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${daysUntilDue != null && daysUntilDue < 0 ? "bg-red-100 dark:bg-red-900/40" : "bg-violet-100 dark:bg-violet-900/40"}`}>
            <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 ${daysUntilDue != null && daysUntilDue < 0 ? "text-red-500" : "text-violet-500"}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${daysUntilDue != null && daysUntilDue < 0 ? "text-red-600 dark:text-red-400" : "text-violet-700 dark:text-violet-300"}`}>
              {daysUntilDue != null && daysUntilDue < 0 ? `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? "s" : ""}` : daysUntilDue === 0 ? "Due Today!" : `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
              {client.contribution_frequency} · {fmt(client.contribution_amount)} · {client.next_contribution_date}
            </p>
          </div>
          <button onClick={onPayClick}
            className="flex-shrink-0 px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold active:scale-95 transition">
            Pay Now
          </button>
        </div>
      )}

      {/* Quick pay button */}
      <button onClick={onPayClick}
        className="w-full py-4 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md flex items-center justify-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        Make Contribution
      </button>

      {/* Calendar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700">
        <ContribCalendar contributions={contributions} />
      </div>

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

// ── Full contribution history tab ─────────────────────────────────────────
function HistoryTab({ contributions }) {
  if (!contributions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-violet-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" />
          </svg>
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No history yet</p>
        <p className="text-slate-400 text-xs mt-1">Your contributions will appear here</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28 space-y-2">
      {contributions.map(c => (
        <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.type === "contribution" ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
              <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${c.type === "contribution" ? "text-green-600 dark:text-green-400" : "text-red-500"}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                {c.type === "contribution"
                  ? <><path d="M12 5v14M5 12l7-7 7 7" /></>
                  : <><path d="M12 19V5M5 12l7 7 7-7" /></>
                }
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-extrabold tabular ${c.type === "contribution" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {c.type === "contribution" ? "+" : "−"}{fmt(c.amount)}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${
                  c.status === "completed" ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                  : "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                }`}>{c.status}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                {c.type} · {c.payment_method || "cash"}
                {c.paystack_ref && ` · Ref: ${c.paystack_ref.slice(-8)}`}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{new Date(c.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
              {c.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{c.notes}"</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────
function ProfileTab({ client, ownerInfo, session, onChangePinClick, onLogout }) {
  const initials = (client.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      <div className="flex flex-col items-center py-5">
        <div className="w-20 h-20 rounded-full overflow-hidden mb-3 border-4 border-violet-200 dark:border-violet-800">
          {client.profile_image_url
            ? <img src={client.profile_image_url} alt={client.full_name} className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 font-black text-2xl">{initials}</div>
          }
        </div>
        <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">{client.full_name}</h2>
        <p className="text-xs text-violet-600 dark:text-violet-400 font-mono font-bold mt-1">{client.membership_number}</p>
        <span className={`mt-1 text-[10px] font-bold px-2.5 py-1 rounded-full capitalize ${client.status === "active" ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" : "bg-slate-100 dark:bg-slate-700 text-slate-500"}`}>
          {client.status}
        </span>
      </div>

      {/* Client details */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700">
        {[
          { label: "Phone",    value: client.phone },
          { label: "Email",    value: client.email },
          { label: "Address",  value: [client.address, client.state, client.lga].filter(Boolean).join(", ") },
          { label: "Frequency", value: client.contribution_frequency, cap: true },
          { label: "Contribution", value: fmt(client.contribution_amount || 0) },
          { label: "Member Since", value: client.registration_date },
        ].filter(f => f.value).map(f => (
          <div key={f.label} className="flex items-start justify-between px-4 py-3 gap-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold shrink-0">{f.label}</p>
            <p className={`text-sm font-semibold text-slate-700 dark:text-slate-200 text-right ${f.cap ? "capitalize" : ""}`}>{f.value}</p>
          </div>
        ))}
      </div>

      {/* Assigned staff */}
      {ownerInfo?.staff && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Assigned Staff</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {ownerInfo.staff.profile_image_url
                ? <img src={ownerInfo.staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-violet-600 dark:text-violet-400 font-black text-base">{(ownerInfo.staff.full_name || "?")[0].toUpperCase()}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{ownerInfo.staff.full_name}</p>
              {ownerInfo.staff.phone && <p className="text-xs text-slate-400">{ownerInfo.staff.phone}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Business owner */}
      {ownerInfo?.owner && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Savings Agent / Business</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{ownerInfo.owner.business_name || ownerInfo.owner.full_name}</p>
            {ownerInfo.owner.phone && <p className="text-xs text-slate-400 mt-0.5">{ownerInfo.owner.phone}</p>}
            {ownerInfo.owner.email && <p className="text-xs text-slate-400">{ownerInfo.owner.email}</p>}
          </div>
        </div>
      )}

      {/* QR code for client to share */}
      {session?.membership_number && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Portal QR Code</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 border border-slate-100 dark:border-slate-700 flex flex-col items-center gap-2">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`https://kuditrack-kappa.vercel.app/?portal=1`)}`}
              alt="Portal QR"
              className="w-32 h-32 rounded-xl"
            />
            <p className="text-[10px] text-slate-400 text-center">Scan to access portal · Share with care</p>
          </div>
        </div>
      )}

      <button onClick={onChangePinClick}
        className="w-full py-3 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-2xl font-bold text-sm border border-violet-100 dark:border-violet-800">
        Change PIN
      </button>

      <button onClick={onLogout}
        className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-800">
        Sign Out
      </button>
    </div>
  );
}

// ── Main portal component ─────────────────────────────────────────────────
export default function AjoClientPortal({ initialSession, onSessionChange, onExit }) {
  const [session,       setSession]       = useState(initialSession || null);
  const [client,        setClient]        = useState(null);
  const [contributions, setContributions] = useState([]);
  const [ownerInfo,     setOwnerInfo]     = useState(null);
  const [loadingData,   setLoadingData]   = useState(false);
  const [tab,           setTab]           = useState("overview");
  const [showPay,       setShowPay]       = useState(false);
  const [showPinModal,  setShowPinModal]  = useState(false);

  const handleLogin = useCallback((sess, clientData) => {
    setSession(sess);
    setClient(clientData);
    onSessionChange?.(sess);
  }, [onSessionChange]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("kt_portal_session");
    setSession(null);
    setClient(null);
    setContributions([]);
    setOwnerInfo(null);
    onSessionChange?.(null);
  }, [onSessionChange]);

  // Load fresh client data + history on mount / session change
  useEffect(() => {
    if (!session?.client_id) return;
    setLoadingData(true);

    Promise.all([
      ajoFn("get-client", { client_id: session.client_id, owner_id: session.owner_id }),
      ajoFn("get-contributions", { client_id: session.client_id, owner_id: session.owner_id }),
      ajoFn("get-owner-info", { owner_id: session.owner_id, client_id: session.client_id }),
    ])
      .then(([clientRes, contribRes, ownerRes]) => {
        if (clientRes?.client)         setClient(clientRes.client);
        if (contribRes?.contributions) setContributions(contribRes.contributions);
        if (ownerRes)                  setOwnerInfo(ownerRes);
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [session?.client_id, session?.owner_id]);

  const handleContribSuccess = useCallback((updatedClient) => {
    setClient(updatedClient);
    setShowPay(false);
    // Reload history
    if (session?.client_id) {
      ajoFn("get-contributions", { client_id: session.client_id, owner_id: session.owner_id })
        .then(r => { if (r?.contributions) setContributions(r.contributions); })
        .catch(console.error);
    }
  }, [session?.client_id, session?.owner_id]);

  if (!session) {
    return <PortalLogin onLogin={handleLogin} onExit={onExit} />;
  }

  const NAV = [
    { id: "overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", label: "Overview" },
    { id: "history",  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",            label: "History"  },
    { id: "bills",    icon: "M13 10V3L4 14h7v7l9-11h-7",                                                                                                                     label: "Bills"    },
    { id: "profile",  icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7",                                                                           label: "Profile"  },
  ];

  const initials = ((client || session).full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md relative flex flex-col h-screen">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
            {(client?.profile_image_url || session.profile_image_url)
              ? <img src={client?.profile_image_url || session.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 font-black text-sm">{initials}</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Ajo Client Portal</p>
            <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
              {(client || session).full_name}
            </p>
          </div>
          {loadingData && (
            <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          )}
          <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-mono font-bold px-2 py-1 rounded-full flex-shrink-0">
            {session.membership_number}
          </span>
        </div>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto">
          {tab === "overview" && client && (
            <OverviewTab
              client={client}
              contributions={contributions}
              onPayClick={() => setShowPay(true)}
            />
          )}
          {tab === "history"  && <HistoryTab contributions={contributions} />}
          {tab === "bills"    && <ClientBills />}
          {tab === "profile"  && client && (
            <ProfileTab
              client={client}
              ownerInfo={ownerInfo}
              session={session}
              onChangePinClick={() => setShowPinModal(true)}
              onLogout={handleLogout}
            />
          )}
          {!client && tab !== "bills" && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </main>

        {/* Bottom nav */}
        <nav className="border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 z-10">
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
        <ContributeModal
          client={client}
          onSuccess={handleContribSuccess}
          onClose={() => setShowPay(false)}
        />
      )}

      {showPinModal && client && (
        <ChangePinModal
          clientId={client.id}
          onClose={() => setShowPinModal(false)}
        />
      )}
    </div>
  );
}
