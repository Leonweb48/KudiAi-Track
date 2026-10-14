import { useState, useEffect } from "react";
import { canSellPlans } from "../utils/platform";
import { useDeepLink } from "../utils/deepLinkBus";
import { fmt, today } from "../utils/helpers";
import { TxRow } from "../components/shared/TxRow";
import Field from "../components/shared/Field";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { useCampaigns }    from "../hooks/useCampaigns";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import { canDo, featureLimit, getLowestPlanWithFeature } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";
import { getLang, speakConfirmation } from "../utils/i18n";
import AssignRecordModal from "../components/AssignRecordModal";

const CATEGORIES = [
  "Electronics", "Clothing", "Food & Beverages", "Cosmetics",
  "Household", "Medicines", "Stationery", "Agriculture", "Auto Parts", "Other",
];
// The stored category stays English; a built-in one is shown in the chosen language, a custom one as typed
const catLabel = (t, c) => {
  const i = CATEGORIES.indexOf(c);
  return i >= 0 ? t(`stock.cat${i}`) : c;
};

// utils/plans.js upgradeLabel / planAvailableText, with the words in the chosen language
function planUpgradeLabel(t, featureKey) {
  if (!canSellPlans()) return "";
  const p = getLowestPlanWithFeature(featureKey);
  if (!p) return t("finance.planUpgradePlan");
  const price = p.price_monthly ? t("finance.planPricePerMonth", { amount: Number(p.price_monthly).toLocaleString() }) : t("finance.planFree");
  return t("finance.planUpgradeTo", { plan: p.name, price });
}
function planAvailable(t, featureKey) {
  if (!canSellPlans()) return t("finance.planNotInCurrent");
  const p = getLowestPlanWithFeature(featureKey);
  return p ? t("finance.planAvailableOn", { plan: p.name }) : t("finance.planUpgradeToAccess");
}

function fmtQty(n) { return Number(n || 0).toLocaleString("en-NG"); }

function qtyColor(qty, threshold) {
  if (qty === 0)          return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
  if (qty <= threshold)   return "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400";
  return "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400";
}

function margin(cost, sell) {
  if (!cost || cost <= 0) return null;
  return Math.round(((sell - cost) / cost) * 100);
}

/* ── Initials tile helpers ────────────────────────────────────── */
const TILE_CLASSES = [
  "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300",
  "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
  "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
];

function productInitials(name) {
  const words = (name || "").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || "?").slice(0, 2).toUpperCase();
}

function tileColorIdx(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + (name || "").charCodeAt(i)) & 0xffff;
  return h % TILE_CLASSES.length;
}

/* ── Product skeleton card ────────────────────────────────────── */
function ProductSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-card animate-pulse">
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex-shrink-0"/>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="h-3.5 bg-slate-100 dark:bg-slate-700 rounded-full w-3/4 mb-2"/>
                <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full w-1/3"/>
              </div>
              <div className="h-7 w-12 bg-slate-100 dark:bg-slate-700 rounded-xl flex-shrink-0"/>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full w-1/2"/>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full w-1/4 ml-auto"/>
        </div>
        <div className="mt-2.5 h-2 bg-slate-100 dark:bg-slate-700 rounded-full"/>
      </div>
      <div className="border-t border-slate-100 dark:border-slate-700 h-11 flex items-center px-5 gap-5">
        <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full w-10"/>
        <div className="w-px h-5 bg-slate-100 dark:bg-slate-700"/>
        <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full w-14"/>
      </div>
    </div>
  );
}

/* ── Product Form ─────────────────────────────────────────────── */
function ProductForm({ initial, onSave, onClose, saving, branches = [], staffBranchId = null }) {
  const t = useT();
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    product_name:        initial?.product_name        || "",
    sku:                 initial?.sku                 || "",
    category:            initial?.category             || "",
    cost_price:          initial?.cost_price           ?? "",
    selling_price:       initial?.selling_price        ?? "",
    quantity:            initial?.quantity             ?? "",
    low_stock_threshold: initial?.low_stock_threshold  ?? 5,
    branch_id:           initial?.branch_id            || staffBranchId || "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const m = margin(parseFloat(form.cost_price), parseFloat(form.selling_price));

  const submit = (e) => {
    e.preventDefault();
    if (!form.product_name.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-sub-sheet flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pb-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white">{isEdit ? t("stock.editProduct") : t("stock.addProduct")}</p>
      </div>

      <form onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        <Field label={t("stock.productName")} value={form.product_name} onChange={e => set("product_name", e.target.value)} required placeholder={t("stock.productNamePh")} />
        <Field label={t("stock.skuBarcode")} value={form.sku} onChange={e => set("sku", e.target.value)} placeholder={t("stock.skuPh")} />

        <div>
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">{t("stock.category")}</p>
          <select value={form.category} onChange={e => set("category", e.target.value)}
            className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500/40">
            <option value="">{t("stock.selectCategory")}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{catLabel(t, c)}</option>)}
          </select>
        </div>

        {branches.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              {staffBranchId ? t("stock.branchYours") : t("stock.branch")}
            </p>
            <select value={form.branch_id} onChange={e => set("branch_id", e.target.value)}
              disabled={!!staffBranchId}
              className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-70">
              {!staffBranchId && <option value="">{t("stock.noBranch")}</option>}
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("stock.costPrice")} type="number" value={form.cost_price} onChange={e => set("cost_price", e.target.value)} min="0" step="0.01" placeholder="0.00" />
          <Field label={t("stock.sellingPrice")} type="number" value={form.selling_price} onChange={e => set("selling_price", e.target.value)} min="0" step="0.01" placeholder="0.00" />
        </div>

        {m !== null && (
          <div className={`text-xs font-bold px-3 py-2 rounded-xl text-center ${m > 0 ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-600"}`}>
            {t("stock.profitMargin", { m })} {m > 0 ? t("stock.perUnit", { amount: (parseFloat(form.selling_price||0) - parseFloat(form.cost_price||0)).toLocaleString() }) : t("stock.loss")}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={isEdit ? t("stock.currentStock") : t("stock.openingStock")} type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} min="0" step="1" placeholder="0" />
          <Field label={t("stock.lowStockAlert")} type="number" value={form.low_stock_threshold} onChange={e => set("low_stock_threshold", e.target.value)} min="0" step="1" placeholder="5" />
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500">{t("stock.alertFires")}</p>

        <button type="submit" disabled={saving || !form.product_name.trim()}
          className="w-full py-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl transition active:scale-[0.98] flex items-center justify-center gap-2 mt-2">
          {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>{t("common.saving")}</> : isEdit ? t("stock.updateProduct") : t("stock.addProduct")}
        </button>
        <div className="h-6"/>
      </form>
    </div>
  );
}

/* ── Movement Modal ───────────────────────────────────────────── */
function MovementModal({ product, movType, onRecord, onClose, saving }) {
  const t = useT();
  const [qty,   setQty]   = useState("");
  const [price, setPrice] = useState(movType === "sale" ? String(product.selling_price || "") : String(product.cost_price || ""));
  const [notes, setNotes] = useState("");

  const TYPE_META = {
    sale:       { label: t("stock.recordSale"),      color: "bg-brand-500",                   hint: t("stock.hintSale") },
    restock:    { label: t("stock.recordRestock"),   color: "bg-blue-600",                    hint: t("stock.hintRestock") },
    adjustment: { label: t("stock.stockAdjustment"), color: "bg-slate-700 dark:bg-slate-600", hint: t("stock.hintAdjust") },
  };
  const meta = TYPE_META[movType];
  const preview = (() => {
    const q = parseInt(qty) || 0;
    const delta = movType === "sale" ? -Math.abs(q) : movType === "restock" ? Math.abs(q) : q;
    const newQ = Math.max(0, product.quantity + delta);
    return { delta, newQ };
  })();

  return (
    <div className="fixed inset-0 z-sub-sheet bg-black/50 flex items-end">
      <div className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700"/>
        </div>
        <div className="flex items-center justify-between mb-4 pt-2">
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">{meta.label}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[220px]">{product.product_name}</p>
          </div>
          <button onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">{t("stock.currentStock")}</p>
            <p className="text-xl font-black text-slate-800 dark:text-white">{fmtQty(product.quantity)}</p>
          </div>
          {qty && (
            <>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-slate-400"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <div className="text-right">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">{t("stock.after")}</p>
                <p className={`text-xl font-black ${preview.newQ <= product.low_stock_threshold ? "text-amber-500" : "text-green-600"}`}>{fmtQty(preview.newQ)}</p>
              </div>
            </>
          )}
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">{meta.hint}</p>

        <div className="space-y-3 mb-5">
          <Field
            label={movType === "adjustment" ? t("stock.qtyPlusMinus") : t("stock.quantity")}
            type="number"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="0"
            step="1"
          />
          <Field
            label={movType === "sale" ? t("stock.salePricePerUnit") : t("stock.unitPrice")}
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            min="0" step="0.01"
          />
          <Field label={t("stock.notesOptional")} value={notes} onChange={e => setNotes(e.target.value)} placeholder={movType === "restock" ? t("stock.notesPhRestock") : t("stock.notesPhSale")} />
        </div>

        <button onClick={() => onRecord({ product_id: product.id, type: movType, quantity: qty, unit_price: price, notes })}
          disabled={saving || !qty}
          className={`w-full py-3.5 ${meta.color} disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl transition active:scale-[0.98] flex items-center justify-center gap-2`}>
          {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>{t("stock.recording")}</> : meta.label}
        </button>
      </div>
    </div>
  );
}

/* ── Product Detail ───────────────────────────────────────────── */
function ProductDetail({ product, movements, onClose, onEdit, onDelete, onAdjust, isOwner }) {
  const t = useT();
  const pMovements = movements.filter(m => m.product_id === product.id).slice(0, 30);
  const totalSold      = pMovements.filter(m => m.type === "sale").reduce((s,m) => s + Math.abs(m.quantity), 0);
  const totalRestocked = pMovements.filter(m => m.type === "restock").reduce((s,m) => s + Math.abs(m.quantity), 0);
  const totalRevenue   = pMovements.filter(m => m.type === "sale").reduce((s,m) => s + Math.abs(m.quantity) * (m.unit_price || 0), 0);
  const m = margin(product.cost_price, product.selling_price);

  return (
    <div className="fixed inset-0 z-sub-sheet flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pb-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white flex-1 truncate">{product.product_name}</p>
        {isOwner && (
          <div className="flex gap-2">
            {onAdjust && (
              <button onClick={() => onAdjust(product)} className="px-3 py-1.5 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl active:scale-95">{t("stock.adjust")}</button>
            )}
            <button onClick={() => onEdit(product)} className="px-3 py-1.5 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl active:scale-95">{t("common.edit")}</button>
            <button onClick={() => onDelete(product)} className="px-3 py-1.5 text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl active:scale-95">{t("common.delete")}</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-10">
        {/* Product info */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <p className="text-lg font-extrabold text-slate-800 dark:text-white leading-tight">{product.product_name}</p>
              {product.sku && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-mono">SKU: {product.sku}</p>}
              {product.category && <span className="mt-1.5 inline-block text-[10px] font-bold px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">{catLabel(t, product.category)}</span>}
            </div>
            <span className={`text-sm font-extrabold px-3 py-1.5 rounded-xl flex-shrink-0 ${qtyColor(product.quantity, product.low_stock_threshold)}`}>
              {t("stock.nUnits", { n: fmtQty(product.quantity) })}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">{t("stock.cost")}</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{fmt(product.cost_price)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">{t("stock.sellPrice")}</p>
              <p className="text-sm font-bold text-brand-500">{fmt(product.selling_price)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">{t("stock.margin")}</p>
              <p className={`text-sm font-black ${m !== null && m > 0 ? "text-brand-500" : "text-red-500"}`}>{m !== null ? `${m}%` : "—"}</p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label:t("stock.unitsSold"),    value:fmtQty(totalSold),     color:"text-brand-500" },
            { label:t("stock.restocked"),    value:fmtQty(totalRestocked), color:"text-blue-600" },
            { label:t("stock.totalRevenue"), value:fmt(totalRevenue),      color:"text-brand-500" },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{s.label}</p>
              <p className={`text-sm font-extrabold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Stock value */}
        <div className="bg-navy rounded-2xl p-4">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wide">{t("stock.stockValue")}</p>
          <AmountDisplay amount={product.cost_price * product.quantity} size="stat" align="left" className="text-white mt-0.5" />
          <p className="text-xs text-slate-400 mt-0.5">{t("stock.retailValueOf", { amount: fmt(product.selling_price * product.quantity) })}</p>
        </div>

        {/* Movement history */}
        <div>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">{t("stock.movementHistory")}</p>
          {pMovements.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">{t("stock.noMovements")}</p>
            : (
              <div className="space-y-2">
                {pMovements.map(mv => <TxRow key={mv.id} tx={mv} variant="stock" />)}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

/* ── Analytics ────────────────────────────────────────────────── */
function AnalyticsView({ analytics, products, onClose }) {
  const t = useT();
  const [tab, setTab] = useState("best");
  const { bestSelling, slowMoving, mostProfitable } = analytics;

  const TABS = [
    { id:"best",   label:t("stock.bestSelling")     },
    { id:"slow",   label:t("stock.slowMoving")      },
    { id:"profit", label:t("stock.mostProfitable")  },
  ];

  const rows = tab === "best"   ? bestSelling
             : tab === "slow"   ? slowMoving
             : mostProfitable;

  const maxVal = rows.length
    ? Math.max(...rows.map(p => tab === "best" ? p.unitsSold : tab === "slow" ? p.quantity : p.margin), 1)
    : 1;

  const metricLabel = tab === "best"   ? t("stock.unitsSold")
                    : tab === "slow"   ? t("stock.inStock")
                    : t("stock.marginPct");

  const metricVal = (p) => tab === "best"   ? t("stock.nUnits", { n: fmtQty(p.unitsSold) })
                         : tab === "slow"   ? t("stock.nUnits", { n: fmtQty(p.quantity) })
                         : `${Math.round(p.margin)}%`;

  const barVal = (p) => tab === "best" ? p.unitsSold : tab === "slow" ? p.quantity : p.margin;

  const emptyMsg = tab === "best"   ? t("stock.emptyBest")
                 : tab === "slow"   ? t("stock.emptySlow")
                 : t("stock.emptyProfit");

  return (
    <div className="fixed inset-0 z-sub-sheet flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pb-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white">{t("stock.inventoryAnalytics")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{t("stock.products")}</p>
            <p className="text-xl font-black text-slate-800 dark:text-white mt-0.5">{products.length}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800 p-3">
            <p className="text-[9px] text-green-700 dark:text-green-400 uppercase font-bold tracking-wide">{t("stock.retailValue")}</p>
            <AmountDisplay amount={analytics.totalRetail} size="stat" align="left" className="text-green-700 dark:text-green-400 mt-0.5" />
          </div>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{t("stock.stockCost")}</p>
            <AmountDisplay amount={analytics.totalCost} size="stat" align="left" className="text-slate-700 dark:text-slate-300 mt-0.5" />
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800 p-3">
            <p className="text-[9px] text-amber-600 dark:text-amber-400 uppercase font-bold tracking-wide">{t("stock.lowStock")}</p>
            <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{analytics.lowStock.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-4">
          {TABS.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all ${
                tab === tb.id ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">
          {tab === "best"   && t("stock.descBest")}
          {tab === "slow"   && t("stock.descSlow")}
          {tab === "profit" && t("stock.descProfit")}
        </p>

        {rows.length === 0
          ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 bg-slate-50 dark:bg-slate-800">
                {tab === "slow" ? (
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-brand-500">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                ) : (
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-slate-400 dark:text-slate-500">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMsg}</p>
            </div>
          )
          : (
            <div className="space-y-3">
              {rows.map((p, i) => {
                const pct = Math.round((barVal(p) / maxVal) * 100);
                return (
                  <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[10px] font-black text-slate-500 dark:text-slate-400 flex-shrink-0">{i+1}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{p.product_name}</p>
                          {p.category && <p className="text-[10px] text-slate-400 dark:text-slate-500">{catLabel(t, p.category)}</p>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-slate-800 dark:text-white">{metricVal(p)}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">{metricLabel}</p>
                      </div>
                    </div>
                    {/* Bar */}
                    <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${tab === "slow" ? "bg-amber-400" : "bg-green-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {tab === "profit" && (
                      <div className="flex justify-between mt-1.5">
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">{t("stock.costToSell", { cost: fmt(p.cost_price), sell: fmt(p.selling_price) })}</p>
                        <p className="text-[10px] font-bold text-green-600">{t("stock.perUnitShort", { amount: fmt(p.profit) })}</p>
                      </div>
                    )}
                    {tab === "best" && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">{t("stock.revenueOf", { amount: fmt(p.revenue) })}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )
        }
        <div className="h-8"/>
      </div>
    </div>
  );
}

/* ── Product Card ─────────────────────────────────────────────── */
function ProductCard({ product, onView, onSale, onRestock, isOwner, onEdit, onAssign, staffBranchId }) {
  const t = useT();
  const m    = margin(product.cost_price, product.selling_price);
  const low  = product.quantity <= product.low_stock_threshold;
  const zero = product.quantity === 0;
  const isMainStock = Boolean(staffBranchId && !product.branch_id);
  const initials  = productInitials(product.product_name);
  const tileCls   = TILE_CLASSES[tileColorIdx(product.product_name)];
  const stockVal  = fmt(product.cost_price * product.quantity);
  const bandPct   = Math.max(2, Math.min(100, Math.round((product.quantity / Math.max(product.low_stock_threshold * 3, 1)) * 100)));

  return (
    <div onClick={() => onView(product)}
      className={`bg-white dark:bg-slate-800 rounded-2xl border transition cursor-pointer active:scale-[0.99] shadow-card ${
        zero ? "border-red-200 dark:border-red-900/50" : low ? "border-amber-200 dark:border-amber-800/50" : "border-slate-100 dark:border-slate-700"
      }`}>
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          {/* Initials tile */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[11px] font-black ${tileCls}`}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-slate-800 dark:text-white leading-tight truncate">{product.product_name}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {isMainStock && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">{t("stock.businessStock")}</span>}
                  {product.category && <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">{catLabel(t, product.category)}</span>}
                  {product.sku && <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[70px]">{product.sku}</span>}
                </div>
              </div>
              <span className={`text-xs font-extrabold px-2.5 py-1 rounded-xl flex-shrink-0 ${qtyColor(product.quantity, product.low_stock_threshold)}`}>
                {fmtQty(product.quantity)}
              </span>
            </div>
          </div>
        </div>

        {/* Price + margin + stock value */}
        <div className="flex items-center gap-1.5 mt-2.5 min-w-0">
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
            {fmt(product.cost_price)} → <span className="font-bold text-slate-600 dark:text-slate-300">{fmt(product.selling_price)}</span>
          </p>
          {m !== null && (
            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
              m > 0 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
            }`}>{m > 0 ? "+" : ""}{m}%</span>
          )}
          <span className="text-[9px] text-slate-400 dark:text-slate-500 ml-auto flex-shrink-0">{stockVal}</span>
        </div>

        {/* Stock level band — 8px */}
        <div className="mt-2 h-2 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${zero ? "bg-red-400" : low ? "bg-amber-400" : "bg-brand-500"}`}
            style={{ width: `${bandPct}%` }}
          />
        </div>
      </div>

      {/* Actions row */}
      <div className="border-t border-slate-100 dark:border-slate-700 flex">
        <button onClick={e => { e.stopPropagation(); onSale(product); }}
          className="flex-1 py-2.5 text-xs font-bold text-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition rounded-bl-2xl flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          {t("stock.sale")}
        </button>
        {!isMainStock && (
          <>
            <div className="w-px bg-slate-100 dark:bg-slate-700"/>
            <button onClick={e => { e.stopPropagation(); onRestock(product); }}
              className="flex-1 py-2.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
              {t("stock.restock")}
            </button>
          </>
        )}
        {isOwner && (
          <>
            <div className="w-px bg-slate-100 dark:bg-slate-700"/>
            <button onClick={e => { e.stopPropagation(); onEdit(product); }}
              className="flex-1 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {t("common.edit")}
            </button>
            <div className="w-px bg-slate-100 dark:bg-slate-700"/>
            <button onClick={e => { e.stopPropagation(); onAssign(product); }}
              className="flex-1 py-2.5 text-xs font-bold text-violet-500 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition rounded-br-2xl flex items-center justify-center gap-1.5 min-h-[44px] active:scale-95">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
              {t("stock.assign")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Costing sheet — lets owner set cost_price + opening qty on an auto-stub ── */
function CostingSheet({ prod, onSave, onClose, onDiscard, saving, discarding }) {
  const t = useT();
  const [costPrice, setCostPrice] = useState("");
  const [openQty,   setOpenQty]   = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const sp = (prod.selling_price || 0).toLocaleString("en-NG");
  const m  = costPrice ? Math.round(((parseFloat(costPrice) > 0)
    ? ((prod.selling_price - parseFloat(costPrice)) / parseFloat(costPrice)) * 100
    : 0)) : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50" style={{ zIndex: "var(--z-sheet)" }} onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl"
        style={{ zIndex: "calc(var(--z-sheet) + 1)", paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}>
        <div className="flex justify-center pt-3 pb-0.5">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="px-5 pt-3 pb-2">
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-0.5">{t("stock.setCostPrice")}</p>
              <h3 className="text-base font-bold text-slate-800 dark:text-white truncate">{prod.product_name}</h3>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] text-slate-400 uppercase font-bold">{t("stock.selling")}</p>
              <p className="text-sm font-extrabold text-green-600 dark:text-green-400">₦{sp}</p>
            </div>
          </div>

          {prod.timesSold > 0 && (
            <div className="mt-1 mb-4 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-700 dark:text-slate-200">{t(prod.timesSold !== 1 ? "stock.nSales" : "stock.nSale", { n: prod.timesSold })}</span>
                {" · "}
                {t("stock.revenueBeforeCosting", { amount: `₦${(prod.totalRevenue || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}` })}
              </p>
            </div>
          )}

          <div className="space-y-4 mt-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                {t("stock.costPricePerUnit")}
              </label>
              <input
                type="number" inputMode="decimal" placeholder="0.00"
                value={costPrice} onChange={e => setCostPrice(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              {m !== null && (
                <p className={`text-[11px] mt-1 font-semibold ${m > 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {m > 0 ? t("stock.marginFuture", { m }) : t("stock.sellingBelowCost")}
                </p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                {t("stock.currentStockOnHand")}
              </label>
              <input
                type="number" inputMode="numeric" placeholder="0"
                value={openQty} onChange={e => setOpenQty(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3 leading-relaxed">
            {t("stock.costingNote")}
          </p>

          <div className="flex gap-3 mt-5">
            <button onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-sm active:scale-95 transition">
              {t("common.cancel")}
            </button>
            <button onClick={() => onSave(costPrice, openQty)}
              disabled={!costPrice || saving}
              className="flex-1 h-11 rounded-xl bg-brand-500 text-white font-bold text-sm active:scale-95 transition disabled:opacity-40">
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>

          {onDiscard && (
            confirmingDiscard ? (
              <div className="mt-3 px-3 py-2.5 bg-red-50 dark:bg-red-900/20 rounded-xl">
                <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">
                  {t("stock.discardConfirm", { name: prod.product_name })}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmingDiscard(false)}
                    className="flex-1 h-9 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("stock.keepIt")}
                  </button>
                  <button onClick={() => onDiscard(prod)} disabled={discarding}
                    className="flex-1 h-9 rounded-lg bg-red-500 text-white text-xs font-bold active:scale-95 transition disabled:opacity-40">
                    {discarding ? t("stock.discarding") : t("stock.yesDiscard")}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmingDiscard(true)}
                className="w-full mt-3 h-9 text-xs font-semibold text-red-500 dark:text-red-400 active:opacity-70 transition">
                {t("stock.discardInstead")}
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

/* ── Main Screen ──────────────────────────────────────────────── */
export default function Inventory({ inventory, isOwner = true, canAdd, plan = "starter", onUpgrade, branches = [], staffBranchId = null, staffList = [], onRecordSale }) {
  // canAdd allows staff to add new products without full owner privileges
  const canAddStock = canAdd !== undefined ? canAdd : isOwner;
  const t = useT();
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar"], "business", "business.inventory");
  const invAnnBars = camSlots.announcement_bar || [];
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("all");
  const [showForm,    setShowForm]    = useState(false);
  const [editProd,    setEditProd]    = useState(null);
  const [detailProd,  setDetailProd]  = useState(null);
  const [movModal,    setMovModal]    = useState(null); // { product, type }
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [costingProd, setCostingProd] = useState(null);
  const [assigningProduct, setAssigningProduct] = useState(null);
  const [discardingStub, setDiscardingStub] = useState(false);

  const { products, movements, loading, dbError, analytics, stubStats,
          addProduct, updateProduct, deleteProduct, recordMovement,
          completeCosting, clearDbError } = inventory;
  const { lowStock, totalCost, totalRetail } = analytics;

  // Notification deep link ({ tab:"inventory", id }) → open that product. Held
  // until the product is in the list (it may still be loading), abandoned after
  // a few seconds. Declared above the plan-gate early return below (hook order).
  const [pendingOpenProdId, setPendingOpenProdId] = useState(null);
  useDeepLink(["inventory"], (dl) => { if (dl.id) setPendingOpenProdId(dl.id); });
  useEffect(() => {
    if (!pendingOpenProdId) return;
    const p = (products || []).find(x => x.id === pendingOpenProdId);
    if (p) { setDetailProd(p); setPendingOpenProdId(null); return; }
    const giveUp = setTimeout(() => setPendingOpenProdId(null), 6000);
    return () => clearTimeout(giveUp);
  }, [pendingOpenProdId, products]);

  if (!canDo(plan, "inventory")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-5">
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-green-600">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{t("stock.inventoryManagement")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs leading-relaxed">
          {t("stock.gateBody")} {planAvailable(t, "inventory")}
        </p>
        {canSellPlans() && (
          <button onClick={onUpgrade} className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition shadow-md">
            {planUpgradeLabel(t, "inventory")}
          </button>
        )}
      </div>
    );
  }

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();

  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    const matchSearch = !s || p.product_name.toLowerCase().includes(s) || (p.sku || "").toLowerCase().includes(s);
    const matchCat = catFilter === "all"       ? true
                   : catFilter === "low_stock" ? p.quantity <= p.low_stock_threshold
                   : p.category === catFilter;
    return matchSearch && matchCat;
  });

  const openAddForm = () => {
    const invLimit = featureLimit(plan, "inventory");
    if (invLimit !== Infinity && products.length >= invLimit) {
      onUpgrade?.();
      return;
    }
    setEditProd(null);
    setShowForm(true);
  };

  const handleSave = async (formData) => {
    setSaving(true);
    const isNew = !editProd?.id;
    let ok;
    if (editProd?.id) ok = await updateProduct(editProd.id, formData);
    else               ok = await addProduct(formData);
    setSaving(false);
    if (ok) {
      setShowForm(false);
      setEditProd(null);
      if (isNew) speakConfirmation("stockIn", getLang());
    }
  };

  const handleRecord = async (movData) => {
    setSaving(true);
    const movType = movData.type;
    const product = products.find(p => p.id === movData.product_id);
    const ok = await recordMovement(movData);
    setSaving(false);
    // A sale recorded HERE must also be booked as a sale (Today's sales, profit, the Sales list). recordMovement only
    // moves stock — the Sales screen books its own sales and calls it just to deduct stock, so the booking can't live
    // there. Cost price is snapshotted now, like any sale (profit never re-derived from a later cost price).
    if (ok && movType === "sale" && onRecordSale && product) {
      const qty   = Math.abs(parseInt(movData.quantity) || 0);
      const price = parseFloat(movData.unit_price) || 0;
      if (qty > 0 && price > 0) {
        onRecordSale({
          type: "in", category: "sale", amount: qty * price, unit_price: price,
          item_name: product.product_name, quantity: qty,
          cost_price: product.cost_price ?? null,
          customer_name: "", payment_type: "cash",
          note: String(movData.notes || "").trim() || "Sold from Stock",
          transaction_date: today(),
        });
      }
    }
    if (ok) {
      setMovModal(null);
      if (movType === "restock") speakConfirmation("stockIn", getLang());
    }
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    setSaving(true);
    await deleteProduct(confirmDel.id);
    setSaving(false);
    setConfirmDel(null);
    setDetailProd(null);
  };

  const handleCompleteCosting = async (costPrice, openQty) => {
    if (!costingProd) return;
    setSaving(true);
    const ok = await completeCosting(costingProd.id, costPrice, openQty);
    setSaving(false);
    if (ok) setCostingProd(null);
  };

  const handleDiscardStub = async (prod) => {
    setDiscardingStub(true);
    const ok = await deleteProduct(prod.id);
    setDiscardingStub(false);
    if (ok) setCostingProd(null);
  };

  return (
    <div className="pb-28 screen-enter">
      <AnnouncementBarSlot campaigns={invAnnBars} loading={camLoading} recordEvent={recordCamEvent} />
      {/* Header */}
      <div className="sticky top-0 z-sticky bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white">{t("inv.title")}</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">{t(products.length !== 1 ? "stock.nProducts" : "stock.nProduct", { n: products.length })}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAnalytics(true)}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition text-slate-600 dark:text-slate-300">
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </button>
            {canAddStock && (
              <button onClick={openAddForm}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 text-white text-xs font-extrabold rounded-xl active:scale-95 transition shadow-sm">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                {t("stock.addStock")}
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("stock.searchPh")}
            className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"/>
        </div>

        {/* Category filters */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id:"all",       label:t("stock.filterAll", { n: products.length }) },
            ...(lowStock.length > 0 ? [{ id:"low_stock", label:t("stock.filterLow", { n: lowStock.length }) }] : []),
            ...categories.map(c => ({ id:c, label:catLabel(t, c) })),
          ].map(f => (
            <button key={f.id} onClick={() => setCatFilter(f.id)}
              className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all ${
                catFilter === f.id
                  ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm"
                  : f.id === "low_stock" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{t("stock.stockCost")}</p>
            <AmountDisplay amount={totalCost} size="row" align="left" className="text-slate-700 dark:text-slate-300 mt-0.5" />
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800 p-3">
            <p className="text-[9px] text-green-700 dark:text-green-400 uppercase font-bold tracking-wide">{t("stock.retailValue")}</p>
            <AmountDisplay amount={totalRetail} size="row" align="left" className="text-green-700 dark:text-green-400 mt-0.5" />
          </div>
          <div className={`rounded-xl border p-3 ${lowStock.length > 0 ? "bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700"}`}>
            <p className={`text-[9px] uppercase font-bold tracking-wide ${lowStock.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>{t("stock.lowStock")}</p>
            <p className={`text-sm font-extrabold mt-0.5 ${lowStock.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>{lowStock.length}</p>
          </div>
        </div>

        {/* Low stock banner */}
        {lowStock.length > 0 && (
          <button onClick={() => setCatFilter("low_stock")}
            className="w-full mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-amber-500 flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{t(lowStock.length > 1 ? "stock.lowBannerMany" : "stock.lowBannerOne", { n: lowStock.length })}</p>
              <p className="text-xs text-amber-600/70 dark:text-amber-500/70 mt-0.5 truncate">{lowStock.slice(0,3).map(p => p.product_name).join(", ")}{lowStock.length > 3 ? "…" : ""}</p>
            </div>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="text-amber-500 flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}

        {/* Loading — skeleton cards (zero layout shift) */}
        {loading && (
          <div className="space-y-3">
            <ProductSkeleton />
            <ProductSkeleton />
            <ProductSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && products.length === 0 && (
          <div className="text-center py-14">
            <div className="w-20 h-20 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-green-500">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <p className="text-slate-600 dark:text-slate-300 font-bold text-sm mb-1">{t("stock.noProductsYet")}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">
              {canAddStock ? t("stock.addFirstHint") : t("stock.noneAddedYet")}
            </p>
            {canAddStock && (
              <button onClick={openAddForm}
                className="px-5 py-2.5 bg-brand-500 text-white font-bold text-sm rounded-xl active:scale-95 transition">
                {t("stock.addFirstProduct")}
              </button>
            )}
          </div>
        )}

        {/* No search results */}
        {!loading && products.length > 0 && filtered.length === 0 && (
          <div className="text-center py-10">
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t("stock.noMatch")}</p>
            <button onClick={() => { setSearch(""); setCatFilter("all"); }} className="mt-2 text-xs text-green-600 font-bold active:scale-95">{t("stock.clearFilters")}</button>
          </div>
        )}

        {/* Needs Costing queue — owner only, pinned above product list */}
        {isOwner && catFilter === "all" && !loading && (stubStats || []).length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                {t("stock.needsCosting", { n: stubStats.length })}
              </span>
              <div className="flex-1 h-px bg-blue-100 dark:bg-blue-800/40" />
            </div>
            <div className="space-y-2">
              {stubStats.map(p => (
                <button key={p.id} onClick={() => setCostingProd(p)}
                  className="w-full text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{p.product_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {p.timesSold > 0
                        ? `${t(p.timesSold !== 1 ? "stock.nSales" : "stock.nSale", { n: p.timesSold })} · ${t("stock.revenueAmount", { amount: `₦${(p.totalRevenue || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}` })}`
                        : t("stock.noSalesYet")}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-sm font-extrabold text-green-600 dark:text-green-400">
                      ₦{(p.selling_price || 0).toLocaleString("en-NG")}
                    </p>
                    <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">{t("stock.setCost")}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product list — low-stock items pinned at top when showing all */}
        {!loading && filtered.length > 0 && (() => {
          const renderCard = p => (
            <ProductCard
              key={p.id}
              product={p}
              isOwner={isOwner}
              staffBranchId={staffBranchId}
              onView={setDetailProd}
              onEdit={prod => { setEditProd(prod); setShowForm(true); }}
              onSale={prod => setMovModal({ product: prod, type: "sale" })}
              onRestock={prod => setMovModal({ product: prod, type: "restock" })}
              onAssign={setAssigningProduct}
            />
          );
          // When showing "all", stubs are already shown in the Needs Costing section above
          const stubIds = isOwner ? new Set((stubStats || []).map(p => p.id)) : new Set();
          const displayList = catFilter === "all" ? filtered.filter(p => !stubIds.has(p.id)) : filtered;
          if (catFilter !== "all") return <div className="space-y-3">{displayList.map(renderCard)}</div>;
          const lowIds       = new Set(lowStock.map(p => p.id));
          const lowFiltered  = displayList.filter(p => lowIds.has(p.id));
          const restFiltered = displayList.filter(p => !lowIds.has(p.id));
          if (!displayList.length) return null;
          if (!lowFiltered.length) return <div className="space-y-3">{displayList.map(renderCard)}</div>;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">{t("stock.lowStock")}</span>
                <div className="flex-1 h-px bg-amber-200 dark:bg-amber-800/50"/>
              </div>
              {lowFiltered.map(renderCard)}
              {restFiltered.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t("stock.allProducts")}</span>
                    <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700"/>
                  </div>
                  {restFiltered.map(renderCard)}
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* DB error */}
      {dbError && (
        <div className="fixed bottom-28 left-4 right-4 max-w-md mx-auto z-toast bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{t("stock.error")}</p>
            <p className="text-xs opacity-80 mt-0.5 break-words">{dbError}</p>
          </div>
          <button onClick={clearDbError} className="text-white/70 hover:text-white flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <ProductForm
          initial={editProd}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditProd(null); }}
          saving={saving}
          branches={branches}
          staffBranchId={staffBranchId}
        />
      )}

      {movModal && (
        <MovementModal
          product={movModal.product}
          movType={movModal.type}
          onRecord={handleRecord}
          onClose={() => setMovModal(null)}
          saving={saving}
        />
      )}

      {detailProd && (
        <ProductDetail
          product={detailProd}
          movements={movements}
          isOwner={isOwner}
          onClose={() => setDetailProd(null)}
          onEdit={prod => { setEditProd(prod); setDetailProd(null); setShowForm(true); }}
          onDelete={prod => { setConfirmDel(prod); setDetailProd(null); }}
          onAdjust={prod => setMovModal({ product: prod, type: "adjustment" })}
        />
      )}

      {showAnalytics && (
        <AnalyticsView analytics={analytics} products={products} onClose={() => setShowAnalytics(false)} />
      )}

      {costingProd && (
        <CostingSheet
          prod={costingProd}
          onSave={handleCompleteCosting}
          onClose={() => setCostingProd(null)}
          onDiscard={handleDiscardStub}
          saving={saving}
          discarding={discardingStub}
        />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-modal bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl">
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">{t("stock.deleteProductQ")}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              <span className="font-bold text-slate-700 dark:text-slate-200">{confirmDel.product_name}</span>{t("stock.deleteBody")}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)} className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm active:scale-95">{t("common.cancel")}</button>
              <button onClick={handleDelete} disabled={saving}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm active:scale-95 disabled:opacity-50">
                {saving ? t("stock.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {assigningProduct && (
        <AssignRecordModal
          type="product"
          record={{ ...assigningProduct, full_name: assigningProduct.product_name }}
          branchList={branches}
          staffList={staffList}
          onSave={async (brId) => {
            await inventory.assignProduct(assigningProduct.id, brId);
          }}
          onClose={() => setAssigningProduct(null)}
        />
      )}

    </div>
  );
}
