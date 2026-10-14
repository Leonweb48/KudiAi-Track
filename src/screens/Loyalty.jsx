import { useState, useEffect, useMemo } from "react";
import { canSellPlans } from "../utils/platform";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import { canDo, featureLimit, upgradeLabel, planAvailableText } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";

const TIER = (totalPts) => {
  if (totalPts >= 500) return { label: "Gold",   key: "business.loyalty.tierGold",   color: "text-yellow-500 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-900/20" };
  if (totalPts >= 100) return { label: "Silver", key: "business.loyalty.tierSilver", color: "text-slate-500 dark:text-slate-300",   bg: "bg-slate-100 dark:bg-slate-700/50"  };
  return                      { label: "Bronze", key: "business.loyalty.tierBronze", color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/20"   };
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
  const t = useT();
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
            {t("business.loyalty.pts", { n: `${item.points_delta > 0 ? "+" : ""}${item.points_delta}` })}
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
  const t = useT();
  const [f, setF]       = useState({ customer_name: "", phone: "", email: "", referral_code_used: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState("");
  const set = (k, v)    => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!f.customer_name.trim()) { setErr(t("business.loyalty.errNameRequired")); return; }
    setSaving(true); setErr("");
    const res = await onAdd(f);
    setSaving(false);
    if (res) { onClose(); }
    else { setErr(t("business.loyalty.errAddFailed")); }
  };

  return (
    <Modal title={t("loyalty.addCustomer")} onClose={onClose}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</p>}
        <LabeledInput label={t("business.loyalty.customerNameLabel")} value={f.customer_name} onChange={v => set("customer_name", v)} placeholder={t("business.loyalty.fullNamePlaceholder")} />
        <LabeledInput label={t("business.loyalty.phoneOptional")} value={f.phone} onChange={v => set("phone", v)} placeholder="08012345678" type="tel" />
        <LabeledInput label={t("business.loyalty.emailOptional")} value={f.email} onChange={v => set("email", v)} placeholder="email@example.com" type="email" />
        {settings?.is_active && (
          <div>
            <LabeledInput
              label={t("business.loyalty.referralCodeUsed")}
              value={f.referral_code_used}
              onChange={v => set("referral_code_used", v.toUpperCase())}
              placeholder={t("business.loyalty.referralCodePlaceholder")}
              maxLength={6}
              extraClass="font-mono uppercase tracking-widest"
            />
            <p className="text-xs text-slate-400 mt-1">{t("business.loyalty.referralCodeHint")}</p>
          </div>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? t("business.loyalty.adding") : t("business.loyalty.addCustomerBtn")}
        </button>
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSave }) {
  const t = useT();
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
    <Modal title={t("loyalty.loyaltySettings")} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("business.loyalty.programActive")}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("business.loyalty.programActiveHint")}</p>
          </div>
          <button
            onClick={() => set("is_active", !f.is_active)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${f.is_active ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${f.is_active ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
        <NumberInput label={t("business.loyalty.pointsPer100Label")} hint={t("business.loyalty.pointsPer100Hint")} value={f.points_per_100_naira} onChange={v => set("points_per_100_naira", v)} min={0} />
        <NumberInput label={t("business.loyalty.cashbackPctLabel")} hint={t("business.loyalty.cashbackPctHint")} value={f.cashback_percentage} onChange={v => set("cashback_percentage", v)} min={0} max={50} step={0.5} />
        <NumberInput label={t("business.loyalty.referralBonusLabel")} hint={t("business.loyalty.referralBonusHint")} value={f.referral_bonus_points} onChange={v => set("referral_bonus_points", v)} min={0} />
        <NumberInput label={t("business.loyalty.minPurchaseLabel")} hint={t("business.loyalty.minPurchaseHint")} value={f.min_purchase_amount} onChange={v => set("min_purchase_amount", v)} min={0} />
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? t("common.saving") : t("business.loyalty.saveSettings")}
        </button>
      </div>
    </Modal>
  );
}

function AwardModal({ customer, settings, onAward, onClose }) {
  const t = useT();
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
    <Modal title={t("business.loyalty.awardTitle", { name: customer.customer_name })} onClose={onClose}>
      <div className="space-y-4">
        <LabeledInput label={t("business.loyalty.purchaseAmountLabel")} value={amount} onChange={setAmount} placeholder={t("business.loyalty.purchaseAmountPlaceholder")} type="number" min={0} />
        {num > 0 && (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 space-y-2">
            {pts  > 0 && <KVRow left={t("business.loyalty.pointsToAward")} right={t("business.loyalty.pts", { n: `+${pts}` })}   rightCls="font-bold text-green-700 dark:text-green-400" />}
            {cash > 0 && <KVRow left={t("business.loyalty.cashbackToCredit")} right={`+${fmtN(cash)}`} rightCls="font-bold text-green-700 dark:text-green-400" />}
            {pts === 0 && cash === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("business.loyalty.noReward")}</p>
            )}
          </div>
        )}
        <button onClick={handleAward} disabled={!num || saving}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? t("business.loyalty.awarding") : t("business.loyalty.award")}
        </button>
      </div>
    </Modal>
  );
}

function RedeemModal({ customer, onRedeem, onClose }) {
  const t = useT();
  const [pts,  setPts]  = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState("");
  const num      = parseInt(pts) || 0;
  const maxPts   = customer.points_balance || 0;
  const canRedeem = num > 0 && num <= maxPts;

  const handleRedeem = async () => {
    if (!canRedeem) { setErr(t("business.loyalty.maxAvailable", { n: maxPts })); return; }
    setSaving(true);
    const ok = await onRedeem(customer.id, num, desc || "Points redeemed");
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal title={t("business.loyalty.redeemTitle", { name: customer.customer_name })} onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-400">{t("business.loyalty.availableBalance")}</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">{t("business.loyalty.pts", { n: maxPts })}</p>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <LabeledInput label={t("business.loyalty.pointsToRedeem")} value={pts} onChange={setPts} placeholder={t("business.loyalty.maxPlaceholder", { n: maxPts })} type="number" min={1} max={maxPts} />
        <LabeledInput label={t("business.loyalty.notesOptional")} value={desc} onChange={setDesc} placeholder={t("business.loyalty.notesPlaceholder")} />
        <button onClick={handleRedeem} disabled={!canRedeem || saving}
          className="w-full py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors">
          {saving ? t("business.loyalty.redeeming") : t("business.loyalty.redeemPointsBtn")}
        </button>
      </div>
    </Modal>
  );
}

// Live since 2026-10-13 (was a "coming soon" placeholder from July). Flip back to true to hide it again.
const COMING_SOON = false;

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
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">{t("loyalty.program")}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-xs">
            <div className="w-20 h-20 bg-brand-50 dark:bg-brand-900/20 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-500 dark:text-brand-400">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <span className="inline-block px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-xs font-bold tracking-wide mb-4">
              {t("business.loyalty.comingSoon")}
            </span>
            <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-3">{t("loyalty.program")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {t("business.loyalty.comingSoonBody")}
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
              {t("business.loyalty.upsellBody")} {planAvailableText("loyalty")}
            </p>
            {canSellPlans() && (
              <button onClick={onUpgrade}
                className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm shadow-sm">
                {upgradeLabel("loyalty")}
              </button>
            )}
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
    if (!window.confirm(`${t("business.loyalty.confirmRemove", { name: selected.customer_name })}\n\n${t("business.loyalty.confirmRemoveDetail")}`)) return;
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
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>{t(tier.key)}</span>
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
              <FieldRow label={t("business.loyalty.phone")} value={selected.phone || "—"} />
              <FieldRow label={t("business.loyalty.email")} value={selected.email || "—"} />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400">{t("business.loyalty.referralCode")}</span>
                  <button onClick={() => handleCopy(selected.referral_code)}
                    className="text-xs font-semibold text-green-600 dark:text-green-400">
                    {copied ? t("business.loyalty.copied") : t("business.loyalty.copy")}
                  </button>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2.5 font-mono text-sm font-bold text-slate-700 dark:text-white tracking-widest text-center">
                  {selected.referral_code}
                </div>
                <p className="text-xs text-slate-400 mt-1.5 text-center">{t("business.loyalty.shareCodeHint")}</p>
              </div>
              {selected.referred_by && <FieldRow label={t("business.loyalty.referredBy")} value={selected.referred_by} />}
              <FieldRow label={t("business.loyalty.totalReferrals")} value={t((selected.total_referrals || 0) !== 1 ? "business.loyalty.customersMany" : "business.loyalty.customersOne", { n: selected.total_referrals || 0 })} />
              <FieldRow label={t("business.loyalty.memberSince")} value={new Date(selected.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} />
            </div>
          )}

          {detailTab === "rewards" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatBox label={t("business.loyalty.pointsBalance")} value={t("business.loyalty.pts", { n: selected.points_balance || 0 })}   color="text-green-600 dark:text-green-400" />
                <StatBox label={t("business.loyalty.cashbackBalance")} value={fmtN(selected.cashback_balance)}          color="text-blue-600 dark:text-blue-400"   />
                <StatBox label={t("business.loyalty.totalPtsEarned")} value={`${selected.total_points_earned || 0}`}   color="text-slate-600 dark:text-slate-300"  />
                <StatBox label={t("business.loyalty.totalCashbackEarned")} value={fmtN(selected.total_cashback_earned)}     color="text-slate-600 dark:text-slate-300"  />
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
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{t("business.loyalty.currentRates")}</p>
                <KVRow left={t("business.loyalty.pointsPer100")} right={t(settings.points_per_100_naira !== 1 ? "business.loyalty.pts" : "business.loyalty.ptOne", { n: settings.points_per_100_naira })} />
                <KVRow left={t("business.loyalty.cashbackRate")} right={settings.cashback_percentage > 0 ? `${settings.cashback_percentage}%` : t("business.loyalty.disabled")} />
                <KVRow left={t("business.loyalty.minPurchase")} right={Number(settings.min_purchase_amount) > 0 ? fmtN(settings.min_purchase_amount) : t("business.loyalty.none")} />
              </div>
            </>
          )}

          {detailTab === "history" && (
            histLoading ? (
              <div className="text-center py-12 text-slate-400 text-sm">{t("common.loading")}</div>
            ) : history.length === 0 ? (
              <div className="text-center py-14">
                <p className="text-slate-400 text-sm font-medium">{t("business.loyalty.noHistory")}</p>
                <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">{t("business.loyalty.noHistoryHint")}</p>
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
            {t("loyalty.add")}
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatBox label={t("loyalty.customers")} value={stats.total}               color="text-slate-700 dark:text-white" />
          <StatBox label={t("business.loyalty.pointsGiven")} value={stats.totalPts.toLocaleString()}     color="text-green-600 dark:text-green-400" />
          <StatBox label={t("business.loyalty.cashback")} value={fmtN(stats.totalCash)}              color="text-blue-600 dark:text-blue-400" />
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
          <div className="text-center py-12 text-slate-400 text-sm">{t("common.loading")}</div>
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
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${tier.bg} ${tier.color}`}>{t(tier.key)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs font-mono text-slate-400">{c.loyalty_id}</span>
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{t("business.loyalty.pts", { n: c.points_balance || 0 })}</span>
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
