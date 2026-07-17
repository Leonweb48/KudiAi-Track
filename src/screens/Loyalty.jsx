import { useState, useEffect, useMemo } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import { canDo, featureLimit, upgradeLabel, planAvailableText } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";

const TIER = (totalPts) => {
  if (totalPts >= 500) return { label: "Gold",   color: "text-yellow-500 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-900/20" };
  if (totalPts >= 100) return { label: "Silver", color: "text-slate-500 dark:text-slate-300",   bg: "bg-slate-100 dark:bg-slate-700/50"  };
  return                      { label: "Bronze", color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/20"   };
};

const fmtN = n => `₦${Number(n || 0).toLocaleString()}`;

function StatBox({ label, value, color }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-3 text-center">
      <p className={`text-lg font-bold leading-tight ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

function FieldRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

function KVRow({ left, right, rightCls = "" }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-500 dark:text-slate-400">{left}</span>
      <span className={rightCls || "font-semibold text-slate-700 dark:text-slate-200"}>{right}</span>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder, type = "text", min, max, step, maxLength, extraClass = "" }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} min={min} max={max} step={step} maxLength={maxLength}
        className={`w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-green-500/30 ${extraClass}`}
      />
    </div>
  );
}

function NumberInput({ label, hint, value, onChange, min, max, step }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">{label}</label>
      <input
        type="number" value={value} onChange={e => onChange(e.target.value)}
        min={min} max={max} step={step}
        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-green-500/30"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const TYPE_STYLE = {
  points_earned:    { sym: "+", cls: "text-green-600 dark:text-green-400",  bg: "bg-green-100 dark:bg-green-900/30"  },
  points_redeemed:  { sym: "−", cls: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-100 dark:bg-amber-900/30"  },
  cashback_earned:  { sym: "+", cls: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-100 dark:bg-blue-900/30"    },
  cashback_redeemed:{ sym: "−", cls: "text-red-500 dark:text-red-400",      bg: "bg-red-100 dark:bg-red-900/30"      },
  referral_bonus:   { sym: "★", cls: "text-yellow-600 dark:text-yellow-400",bg: "bg-yellow-100 dark:bg-yellow-900/30"},
};

function HistoryRow({ item }) {
  const { sym, cls, bg } = TYPE_STYLE[item.type] || TYPE_STYLE.points_earned;
  const date = new Date(item.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${bg}`}>
        <span className={`text-sm font-bold ${cls}`}>{sym}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{item.description}</p>
        <p className="text-xs text-slate-400 mt-0.5">{date}</p>
      </div>
      <div className="text-right flex-shrink-0">
        {item.points_delta !== 0 && (
          <p className={`text-sm font-bold ${item.points_delta > 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
            {item.points_delta > 0 ? "+" : ""}{item.points_delta} pts
          </p>
        )}
        {Number(item.cashback_delta) !== 0 && (
          <p className={`text-xs font-semibold ${Number(item.cashback_delta) > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-500 dark:text-red-400"}`}>
            {Number(item.cashback_delta) > 0 ? "+" : ""}₦{Math.abs(Number(item.cashback_delta)).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function AddModal({ onClose, onAdd, settings }) {
  const [f, setF]       = useState({ customer_name: "", phone: "", email: "", referral_code_used: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState("");
  const set = (k, v)    => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!f.customer_name.trim()) { setErr("Customer name is required"); return; }
    setSaving(true); setErr("");
    const res = await onAdd(f);
    setSaving(false);
    if (res) { onClose(); }
    else { setErr("Could not add customer. Try again or check the referral code."); }
  };

  return (
    <Modal title="Add Loyalty Customer" onClose={onClose}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</p>}
        <LabeledInput label="Customer Name *" value={f.customer_name} onChange={v => set("customer_name", v)} placeholder="Full name" />
        <LabeledInput label="Phone (optional)" value={f.phone} onChange={v => set("phone", v)} placeholder="08012345678" type="tel" />
        <LabeledInput label="Email (optional)" value={f.email} onChange={v => set("email", v)} placeholder="email@example.com" type="email" />
        {settings?.is_active && (
          <div>
            <LabeledInput
              label="Referral Code Used (optional)"
              value={f.referral_code_used}
              onChange={v => set("referral_code_used", v.toUpperCase())}
              placeholder="e.g. ABCDEF"
              maxLength={6}
              extraClass="font-mono uppercase tracking-widest"
            />
            <p className="text-xs text-slate-400 mt-1">Enter the referral code of whoever introduced this customer.</p>
          </div>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? "Adding…" : "Add Customer"}
        </button>
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSave }) {
  const [f, setF]         = useState({ ...settings });
  const [saving, setSaving] = useState(false);
  const set = (k, v)      => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      is_active:             f.is_active,
      points_per_100_naira:  Number(f.points_per_100_naira)  || 0,
      cashback_percentage:   Number(f.cashback_percentage)   || 0,
      referral_bonus_points: Number(f.referral_bonus_points) || 0,
      min_purchase_amount:   Number(f.min_purchase_amount)   || 0,
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Loyalty Settings" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Program Active</p>
            <p className="text-xs text-slate-400 mt-0.5">Award points and cashback on purchases</p>
          </div>
          <button
            onClick={() => set("is_active", !f.is_active)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${f.is_active ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${f.is_active ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
        <NumberInput label="Points per ₦100 spent" hint="e.g. 1 = one point for every ₦100" value={f.points_per_100_naira} onChange={v => set("points_per_100_naira", v)} min={0} />
        <NumberInput label="Cashback Percentage (%)" hint="e.g. 2 = 2% cashback on every purchase (0 to disable)" value={f.cashback_percentage} onChange={v => set("cashback_percentage", v)} min={0} max={50} step={0.5} />
        <NumberInput label="Referral Bonus (points)" hint="Points awarded to a customer when they refer someone new" value={f.referral_bonus_points} onChange={v => set("referral_bonus_points", v)} min={0} />
        <NumberInput label="Minimum Purchase Amount (₦)" hint="Customer must spend at least this much to earn rewards (0 = no minimum)" value={f.min_purchase_amount} onChange={v => set("min_purchase_amount", v)} min={0} />
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </Modal>
  );
}

function AwardModal({ customer, settings, onAward, onClose }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const num  = parseFloat(amount) || 0;
  const pts  = settings.points_per_100_naira > 0 ? Math.floor(num / 100 * settings.points_per_100_naira) : 0;
  const cash = settings.cashback_percentage  > 0 ? Math.round(num * settings.cashback_percentage / 100 * 100) / 100 : 0;

  const handleAward = async () => {
    if (!num) return;
    setSaving(true);
    await onAward(customer.id, num);
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={`Award Points — ${customer.customer_name}`} onClose={onClose}>
      <div className="space-y-4">
        <LabeledInput label="Purchase Amount (₦)" value={amount} onChange={setAmount} placeholder="e.g. 5000" type="number" min={0} />
        {num > 0 && (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 space-y-2">
            {pts  > 0 && <KVRow left="Points to award"   right={`+${pts} pts`}   rightCls="font-bold text-green-700 dark:text-green-400" />}
            {cash > 0 && <KVRow left="Cashback to credit" right={`+${fmtN(cash)}`} rightCls="font-bold text-green-700 dark:text-green-400" />}
            {pts === 0 && cash === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">No reward for this amount — check program rates in settings.</p>
            )}
          </div>
        )}
        <button onClick={handleAward} disabled={!num || saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? "Awarding…" : "Award"}
        </button>
      </div>
    </Modal>
  );
}

function RedeemModal({ customer, onRedeem, onClose }) {
  const [pts,  setPts]  = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState("");
  const num      = parseInt(pts) || 0;
  const maxPts   = customer.points_balance || 0;
  const canRedeem = num > 0 && num <= maxPts;

  const handleRedeem = async () => {
    if (!canRedeem) { setErr(`Max available: ${maxPts} pts`); return; }
    setSaving(true);
    const ok = await onRedeem(customer.id, num, desc || "Points redeemed");
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`Redeem Points — ${customer.customer_name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-400">Available balance</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">{maxPts} pts</p>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <LabeledInput label="Points to Redeem" value={pts} onChange={setPts} placeholder={`Max: ${maxPts}`} type="number" min={1} max={maxPts} />
        <LabeledInput label="Notes (optional)" value={desc} onChange={setDesc} placeholder="e.g. Discount applied" />
        <button onClick={handleRedeem} disabled={!canRedeem || saving}
          className="w-full py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? "Redeeming…" : "Redeem Points"}
        </button>
      </div>
    </Modal>
  );
}

const COMING_SOON = true;

export default function Loyalty({ loyalty, plan, onUpgrade, onClose }) {
  const t = useT();
  const {
    customers, settings, loading: loyaltyLoading,
    addCustomer, awardPoints, redeemPoints,
    saveSettings, getHistory, deleteCustomer,
  } = loyalty;

  const [view,       setView]       = useState("list");
  const [selected,   setSelected]   = useState(null);
  const [detailTab,  setDetailTab]  = useState("profile");
  const [history,    setHistory]    = useState([]);
  const [histLoading,setHistLoading]= useState(false);
  const [showAdd,    setShowAdd]    = useState(false);
  const [showSettings,setShowSettings] = useState(false);
  const [showAward,  setShowAward]  = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [search,     setSearch]     = useState("");
  const [copied,     setCopied]     = useState(false);

  const selectedId = selected?.id;

  useEffect(() => {
    setSelected(prev => {
      if (!prev) return prev;
      return customers.find(c => c.id === prev.id) || prev;
    });
  }, [customers]);

  useEffect(() => {
    if (view !== "detail" || detailTab !== "history" || !selectedId) return;
    setHistLoading(true);
    getHistory(selectedId).then(h => { setHistory(h); setHistLoading(false); });
  }, [view, detailTab, selectedId, getHistory]);

  const canUseLoyalty = canDo(plan, "loyalty");

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.customer_name.toLowerCase().includes(q) ||
      c.loyalty_id.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    );
  }, [customers, search]);

  const stats = useMemo(() => ({
    total:     customers.length,
    totalPts:  customers.reduce((s, c) => s + (c.total_points_earned  || 0), 0),
    totalCash: customers.reduce((s, c) => s + Number(c.total_cashback_earned || 0), 0),
  }), [customers]);

  if (COMING_SOON) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4 flex items-center gap-3" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
          {onClose && (
            <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Icon name="x" size={20} />
            </button>
          )}
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">Loyalty Program</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-xs">
            <div className="w-20 h-20 bg-brand-50 dark:bg-brand-900/20 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-500 dark:text-brand-400">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <span className="inline-block px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-xs font-bold tracking-wide mb-4">
              COMING SOON
            </span>
            <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-3">Loyalty Program</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              We're building something great — reward your best customers with points, cashback, tiers, and referral bonuses. Stay tuned.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!canUseLoyalty) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4 flex items-center gap-3" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
          {onClose && (
            <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Icon name="x" size={20} />
            </button>
          )}
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">{t("loyalty.program")}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Icon name="gift" size={32} className="text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">{t("loyalty.program")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Reward loyal customers with points, cashback, and referral bonuses. {planAvailableText("loyalty")}
            </p>
            <button onClick={onUpgrade}
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm shadow-sm">
              {upgradeLabel("loyalty")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleCopy = (code) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openDetail = (customer) => {
    setSelected(customer);
    setDetailTab("profile");
    setHistory([]);
    setView("detail");
  };

  const goBack = () => { setView("list"); setSelected(null); };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.customer_name} from the loyalty program?\n\nAll their points, cashback, and history will be deleted.`)) return;
    await deleteCustomer(selected.id);
    goBack();
  };

  // ── DETAIL VIEW ────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const tier = TIER(selected.total_points_earned || 0);
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-24">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <Icon name="arrow" size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-slate-800 dark:text-white truncate leading-tight">{selected.customer_name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono text-slate-400">{selected.loyalty_id}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>{tier.label}</span>
              </div>
            </div>
            <button onClick={handleDelete} className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="flex gap-1 mt-3">
            {[
              { id:"profile", label: t("loyalty.tabProfile") },
              { id:"rewards", label: t("loyalty.tabRewards") },
              { id:"history", label: t("loyalty.tabHistory") },
            ].map(tab => (
              <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-colors ${
                  detailTab === tab.id
                    ? "bg-green-600 text-white"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 pt-4 space-y-3">
          {detailTab === "profile" && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 space-y-4">
              <FieldRow label="Phone"         value={selected.phone || "—"} />
              <FieldRow label="Email"         value={selected.email || "—"} />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400">Referral Code</span>
                  <button onClick={() => handleCopy(selected.referral_code)}
                    className="text-xs font-semibold text-green-600 dark:text-green-400">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5 font-mono text-sm font-bold text-slate-700 dark:text-white tracking-widest text-center">
                  {selected.referral_code}
                </div>
                <p className="text-xs text-slate-400 mt-1.5 text-center">Share this code for referral rewards</p>
              </div>
              {selected.referred_by && <FieldRow label="Referred by (code)" value={selected.referred_by} />}
              <FieldRow label="Total Referrals Made" value={`${selected.total_referrals || 0} customer${(selected.total_referrals || 0) !== 1 ? "s" : ""}`} />
              <FieldRow label="Member Since" value={new Date(selected.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} />
            </div>
          )}

          {detailTab === "rewards" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatBox label="Points Balance"        value={`${selected.points_balance || 0} pts`}   color="text-green-600 dark:text-green-400" />
                <StatBox label="Cashback Balance"      value={fmtN(selected.cashback_balance)}          color="text-blue-600 dark:text-blue-400"   />
                <StatBox label="Total Pts Earned"      value={`${selected.total_points_earned || 0}`}   color="text-slate-600 dark:text-slate-300"  />
                <StatBox label="Total Cashback Earned" value={fmtN(selected.total_cashback_earned)}     color="text-slate-600 dark:text-slate-300"  />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowAward(true)}
                  className="py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors">
                  {t("loyalty.awardPoints")}
                </button>
                <button onClick={() => setShowRedeem(true)} disabled={!(selected.points_balance > 0)}
                  className="py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-40 transition-colors">
                  {t("loyalty.redeemPoints")}
                </button>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Current Program Rates</p>
                <KVRow left="Points per ₦100" right={`${settings.points_per_100_naira} pt${settings.points_per_100_naira !== 1 ? "s" : ""}`} />
                <KVRow left="Cashback rate"    right={settings.cashback_percentage > 0 ? `${settings.cashback_percentage}%` : "Disabled"} />
                <KVRow left="Min purchase"     right={Number(settings.min_purchase_amount) > 0 ? fmtN(settings.min_purchase_amount) : "None"} />
              </div>
            </>
          )}

          {detailTab === "history" && (
            histLoading ? (
              <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-14">
                <p className="text-slate-400 text-sm font-medium">No reward history yet</p>
                <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">Award points to see history here</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm divide-y divide-slate-50 dark:divide-slate-700/50 overflow-hidden">
                {history.map(h => <HistoryRow key={h.id} item={h} />)}
              </div>
            )
          )}
        </div>

        {showAward  && <AwardModal  customer={selected} settings={settings} onAward={awardPoints}   onClose={() => setShowAward(false)}  />}
        {showRedeem && <RedeemModal customer={selected}                     onRedeem={redeemPoints} onClose={() => setShowRedeem(false)} />}
      </div>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-6">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
        <div className="flex items-center gap-2">
          {onClose && (
            <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0">
              <Icon name="x" size={20} />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">{t("loyalty.program")}</h1>
            {!settings.is_active && (
              <p className="text-xs text-amber-500 font-semibold mt-0.5">{t("loyalty.inactive")}</p>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <Icon name="settings" size={19} />
          </button>
          <button onClick={() => {
              const loyaltyLimit = featureLimit(plan, "loyalty");
              if (loyaltyLimit !== Infinity && customers.length >= loyaltyLimit) { onUpgrade?.(); return; }
              setShowAdd(true);
            }}
            className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-xl text-sm font-bold shadow-sm">
            <Icon name="plus" size={15} />
            Add
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatBox label={t("loyalty.customers")} value={stats.total}               color="text-slate-700 dark:text-white" />
          <StatBox label="Points Given" value={stats.totalPts.toLocaleString()}     color="text-green-600 dark:text-green-400" />
          <StatBox label="Cashback"     value={fmtN(stats.totalCash)}              color="text-blue-600 dark:text-blue-400" />
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("loyalty.searchPlaceholder")}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-green-500/30"
          />
        </div>

        {loyaltyLoading ? (
          <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Icon name="gift" size={26} className="text-green-500 dark:text-green-400" />
            </div>
            <p className="font-semibold text-slate-600 dark:text-slate-300 text-sm">
              {search ? t("loyalty.noMatches") : t("loyalty.noCustomersYet")}
            </p>
            {!search && <p className="text-xs text-slate-400 mt-1">{t("loyalty.tapAdd")}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const tier = TIER(c.total_points_earned || 0);
              return (
                <button key={c.id} onClick={() => openDetail(c)}
                  className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3.5 flex items-center gap-3 text-left hover:shadow-md transition-shadow">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-green-600 dark:text-green-400">{c.customer_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-white text-sm truncate">{c.customer_name}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${tier.bg} ${tier.color}`}>{tier.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs font-mono text-slate-400">{c.loyalty_id}</span>
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{c.points_balance || 0} pts</span>
                      {Number(c.cashback_balance || 0) > 0 && (
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{fmtN(c.cashback_balance)}</span>
                      )}
                    </div>
                  </div>
                  <Icon name="arrow" size={15} className="text-slate-300 dark:text-slate-600 transform rotate-180 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showAdd      && <AddModal      onClose={() => setShowAdd(false)}      onAdd={addCustomer} settings={settings} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} settings={settings} onSave={saveSettings} />}
    </div>
  );
}
