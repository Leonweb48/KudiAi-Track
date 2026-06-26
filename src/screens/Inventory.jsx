import { useState } from "react";
import { fmt } from "../utils/helpers";
import { canDo, featureLimit, upgradeLabel, planAvailableText } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";
import { getLang, speakConfirmation } from "../utils/i18n";

const CATEGORIES = [
  "Electronics", "Clothing", "Food & Beverages", "Cosmetics",
  "Household", "Medicines", "Stationery", "Agriculture", "Auto Parts", "Other",
];

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

function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

/* ── Mini input ─────────────────────────────────────────────────── */
function Field({ label, type = "text", value, onChange, required, placeholder, min, step }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">{label}{required && " *"}</p>
      <input
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        min={min}
        step={step}
        className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/40"
      />
    </div>
  );
}

/* ── Product Form ─────────────────────────────────────────────── */
function ProductForm({ initial, onSave, onClose, saving, branches = [], staffBranchId = null }) {
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
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pt-11 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white">{isEdit ? "Edit Product" : "Add Product"}</p>
      </div>

      <form onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        <Field label="Product Name" value={form.product_name} onChange={e => set("product_name", e.target.value)} required placeholder="e.g. Samsung Galaxy A15" />
        <Field label="SKU / Barcode" value={form.sku} onChange={e => set("sku", e.target.value)} placeholder="e.g. SAM-A15-64GB" />

        <div>
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Category</p>
          <select value={form.category} onChange={e => set("category", e.target.value)}
            className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500/40">
            <option value="">Select category…</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {branches.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              Branch{staffBranchId ? " (Your Branch)" : ""}
            </p>
            <select value={form.branch_id} onChange={e => set("branch_id", e.target.value)}
              disabled={!!staffBranchId}
              className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-70">
              {!staffBranchId && <option value="">No Branch (Main Inventory)</option>}
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost Price (₦)" type="number" value={form.cost_price} onChange={e => set("cost_price", e.target.value)} min="0" step="0.01" placeholder="0.00" />
          <Field label="Selling Price (₦)" type="number" value={form.selling_price} onChange={e => set("selling_price", e.target.value)} min="0" step="0.01" placeholder="0.00" />
        </div>

        {m !== null && (
          <div className={`text-xs font-bold px-3 py-2 rounded-xl text-center ${m > 0 ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-600"}`}>
            Profit Margin: {m}% {m > 0 ? `(₦${(parseFloat(form.selling_price||0) - parseFloat(form.cost_price||0)).toLocaleString()} per unit)` : "(Loss)"}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={isEdit ? "Current Stock" : "Opening Stock"} type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} min="0" step="1" placeholder="0" />
          <Field label="Low Stock Alert" type="number" value={form.low_stock_threshold} onChange={e => set("low_stock_threshold", e.target.value)} min="0" step="1" placeholder="5" />
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500">Alert fires when quantity falls at or below the threshold value.</p>

        <button type="submit" disabled={saving || !form.product_name.trim()}
          className="w-full py-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl transition active:scale-[0.98] flex items-center justify-center gap-2 mt-2">
          {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Saving…</> : isEdit ? "Update Product" : "Add Product"}
        </button>
        <div className="h-6"/>
      </form>
    </div>
  );
}

/* ── Movement Modal ───────────────────────────────────────────── */
function MovementModal({ product, movType, onRecord, onClose, saving }) {
  const [qty,   setQty]   = useState("");
  const [price, setPrice] = useState(movType === "sale" ? String(product.selling_price || "") : String(product.cost_price || ""));
  const [notes, setNotes] = useState("");

  const TYPE_META = {
    sale:       { label: "Record Sale",         color: "bg-green-600",  hint: "Enter qty sold. Stock will decrease." },
    restock:    { label: "Record Restock",       color: "bg-blue-600",   hint: "Enter qty received. Stock will increase." },
    adjustment: { label: "Stock Adjustment",     color: "bg-slate-700 dark:bg-slate-600", hint: "Positive to add, negative to remove." },
  };
  const meta = TYPE_META[movType];
  const preview = (() => {
    const q = parseInt(qty) || 0;
    const delta = movType === "sale" ? -Math.abs(q) : movType === "restock" ? Math.abs(q) : q;
    const newQ = Math.max(0, product.quantity + delta);
    return { delta, newQ };
  })();

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end">
      <div className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl px-5 pt-5 pb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">{meta.label}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[220px]">{product.product_name}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Current Stock</p>
            <p className="text-xl font-black text-slate-800 dark:text-white">{fmtQty(product.quantity)}</p>
          </div>
          {qty && (
            <>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-slate-400"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <div className="text-right">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">After</p>
                <p className={`text-xl font-black ${preview.newQ <= product.low_stock_threshold ? "text-amber-500" : "text-green-600"}`}>{fmtQty(preview.newQ)}</p>
              </div>
            </>
          )}
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">{meta.hint}</p>

        <div className="space-y-3 mb-5">
          <Field
            label={movType === "adjustment" ? "Quantity (+ or −)" : "Quantity"}
            type="number"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="0"
            step="1"
          />
          <Field
            label={movType === "sale" ? "Sale Price per Unit (₦)" : "Unit Price (₦)"}
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            min="0" step="0.01"
          />
          <Field label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Customer: Amara Jones" />
        </div>

        <button onClick={() => onRecord({ product_id: product.id, type: movType, quantity: qty, unit_price: price, notes })}
          disabled={saving || !qty}
          className={`w-full py-3.5 ${meta.color} disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl transition active:scale-[0.98] flex items-center justify-center gap-2`}>
          {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Recording…</> : meta.label}
        </button>
      </div>
    </div>
  );
}

/* ── Product Detail ───────────────────────────────────────────── */
function ProductDetail({ product, movements, onClose, onEdit, onDelete, isOwner }) {
  const pMovements = movements.filter(m => m.product_id === product.id).slice(0, 30);
  const totalSold     = pMovements.filter(m => m.type === "sale").reduce((s,m) => s + Math.abs(m.quantity), 0);
  const totalRestocked = pMovements.filter(m => m.type === "restock").reduce((s,m) => s + Math.abs(m.quantity), 0);
  const totalRevenue  = pMovements.filter(m => m.type === "sale").reduce((s,m) => s + Math.abs(m.quantity) * (m.unit_price || 0), 0);
  const m             = margin(product.cost_price, product.selling_price);
  const MOV_LABEL = { sale:"Sale", restock:"Restock", adjustment:"Adjustment" };
  const MOV_COLOR = {
    sale:       "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20",
    restock:    "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20",
    adjustment: "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700",
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pt-11 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white flex-1 truncate">{product.product_name}</p>
        {isOwner && (
          <div className="flex gap-2">
            <button onClick={onEdit} className="px-3 py-1.5 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl active:scale-95">Edit</button>
            <button onClick={onDelete} className="px-3 py-1.5 text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl active:scale-95">Delete</button>
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
              {product.category && <span className="mt-1.5 inline-block text-[10px] font-bold px-2 py-0.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-full">{product.category}</span>}
            </div>
            <span className={`text-sm font-extrabold px-3 py-1.5 rounded-xl flex-shrink-0 ${qtyColor(product.quantity, product.low_stock_threshold)}`}>
              {fmtQty(product.quantity)} units
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Cost</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{fmt(product.cost_price)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Sell Price</p>
              <p className="text-sm font-bold text-green-600">{fmt(product.selling_price)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Margin</p>
              <p className={`text-sm font-black ${m !== null && m > 0 ? "text-green-600" : "text-red-500"}`}>{m !== null ? `${m}%` : "—"}</p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label:"Units Sold",    value:fmtQty(totalSold),    color:"text-green-600" },
            { label:"Restocked",     value:fmtQty(totalRestocked),color:"text-blue-600" },
            { label:"Total Revenue", value:fmt(totalRevenue),     color:"text-green-600" },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{s.label}</p>
              <p className={`text-sm font-extrabold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Stock value */}
        <div className="bg-slate-800 dark:bg-slate-700 rounded-2xl p-4">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wide">Stock Value</p>
          <p className="text-xl font-black text-white mt-0.5">{fmt(product.cost_price * product.quantity)}</p>
          <p className="text-xs text-slate-400 mt-0.5">Retail value: {fmt(product.selling_price * product.quantity)}</p>
        </div>

        {/* Movement history */}
        <div>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Movement History</p>
          {pMovements.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No movements yet</p>
            : (
              <div className="space-y-2">
                {pMovements.map(m => (
                  <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 px-3.5 py-3 flex items-center gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${MOV_COLOR[m.type]}`}>{MOV_LABEL[m.type]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(m.created_at)}</p>
                      {m.notes && <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{m.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-extrabold ${m.quantity < 0 ? "text-red-500" : "text-green-600"}`}>
                        {m.quantity > 0 ? "+" : ""}{m.quantity}
                      </p>
                      {m.unit_price > 0 && <p className="text-[10px] text-slate-400 dark:text-slate-500">{fmt(m.unit_price)}/unit</p>}
                    </div>
                  </div>
                ))}
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
  const [tab, setTab] = useState("best");
  const { bestSelling, slowMoving, mostProfitable } = analytics;

  const TABS = [
    { id:"best",   label:"Best Selling"     },
    { id:"slow",   label:"Slow Moving"      },
    { id:"profit", label:"Most Profitable"  },
  ];

  const rows = tab === "best"   ? bestSelling
             : tab === "slow"   ? slowMoving
             : mostProfitable;

  const maxVal = rows.length
    ? Math.max(...rows.map(p => tab === "best" ? p.unitsSold : tab === "slow" ? p.quantity : p.margin), 1)
    : 1;

  const metricLabel = tab === "best"   ? "Units Sold"
                    : tab === "slow"   ? "In Stock"
                    : "Margin %";

  const metricVal = (p) => tab === "best"   ? `${fmtQty(p.unitsSold)} units`
                         : tab === "slow"   ? `${fmtQty(p.quantity)} units`
                         : `${Math.round(p.margin)}%`;

  const barVal = (p) => tab === "best" ? p.unitsSold : tab === "slow" ? p.quantity : p.margin;

  const emptyMsg = tab === "best"   ? "No sales recorded yet"
                 : tab === "slow"   ? "All products have recent sales — great!"
                 : "No products with positive margin";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pt-11 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p className="text-base font-extrabold text-slate-800 dark:text-white">Inventory Analytics</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3">
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">Products</p>
            <p className="text-xl font-black text-slate-800 dark:text-white mt-0.5">{products.length}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800 p-3">
            <p className="text-[9px] text-green-700 dark:text-green-400 uppercase font-bold tracking-wide">Retail Value</p>
            <p className="text-xl font-black text-green-700 dark:text-green-400 mt-0.5">{fmt(analytics.totalRetail)}</p>
          </div>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">Stock Cost</p>
            <p className="text-xl font-black text-slate-700 dark:text-slate-200 mt-0.5">{fmt(analytics.totalCost)}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800 p-3">
            <p className="text-[9px] text-amber-600 dark:text-amber-400 uppercase font-bold tracking-wide">Low Stock</p>
            <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{analytics.lowStock.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all ${
                tab === t.id ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">
          {tab === "best"   && "Products ranked by total units sold of all time."}
          {tab === "slow"   && "Products with no sales in the last 30 days. Consider discounts or promotions."}
          {tab === "profit" && "Products ranked by profit margin (selling price vs cost price)."}
        </p>

        {rows.length === 0
          ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">{tab === "slow" ? "🎉" : "📊"}</p>
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
                          {p.category && <p className="text-[10px] text-slate-400 dark:text-slate-500">{p.category}</p>}
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
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">Cost: {fmt(p.cost_price)} → Sell: {fmt(p.selling_price)}</p>
                        <p className="text-[10px] font-bold text-green-600">{fmt(p.profit)}/unit</p>
                      </div>
                    )}
                    {tab === "best" && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">Revenue: {fmt(p.revenue)}</p>
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
function ProductCard({ product, onView, onSale, onRestock, isOwner, onEdit, staffBranchId }) {
  const m    = margin(product.cost_price, product.selling_price);
  const low  = product.quantity <= product.low_stock_threshold;
  const zero = product.quantity === 0;
  // Main business stock: product has no branch — branch staff can sell but not restock
  const isMainStock = Boolean(staffBranchId && !product.branch_id);

  return (
    <div onClick={() => onView(product)}
      className={`bg-white dark:bg-slate-800 rounded-2xl border transition cursor-pointer active:scale-[0.99] ${
        zero ? "border-red-200 dark:border-red-900/50" : low ? "border-amber-200 dark:border-amber-800/50" : "border-slate-100 dark:border-slate-700"
      }`}>
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white leading-tight truncate">{product.product_name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {isMainStock && <span className="text-[9px] font-bold px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">Business Stock</span>}
              {product.category && <span className="text-[10px] font-bold px-2 py-0.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-full">{product.category}</span>}
              {product.sku && <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{product.sku}</span>}
            </div>
          </div>
          <span className={`text-xs font-extrabold px-2.5 py-1.5 rounded-xl flex-shrink-0 ${qtyColor(product.quantity, product.low_stock_threshold)}`}>
            {fmtQty(product.quantity)}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <p className="text-xs text-slate-400 dark:text-slate-500">{fmt(product.cost_price)} → <span className="font-bold text-slate-600 dark:text-slate-300">{fmt(product.selling_price)}</span></p>
          {m !== null && (
            <span className={`text-[10px] font-extrabold ${m > 0 ? "text-green-600" : "text-red-500"}`}>{m > 0 ? "+" : ""}{m}%</span>
          )}
          {low && !zero && <span className="text-[10px] font-bold text-amber-500 ml-auto">⚠ Low stock</span>}
          {zero          && <span className="text-[10px] font-bold text-red-500 ml-auto">✕ Out of stock</span>}
        </div>
      </div>

      {/* Actions row */}
      <div className="border-t border-slate-100 dark:border-slate-700 flex">
        <button onClick={e => { e.stopPropagation(); onSale(product); }}
          className="flex-1 py-2.5 text-xs font-bold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition rounded-bl-2xl flex items-center justify-center gap-1.5 active:scale-95">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          Sale
        </button>
        {!isMainStock && (
          <>
            <div className="w-px bg-slate-100 dark:bg-slate-700"/>
            <button onClick={e => { e.stopPropagation(); onRestock(product); }}
              className="flex-1 py-2.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition flex items-center justify-center gap-1.5 active:scale-95">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
              Restock
            </button>
          </>
        )}
        {isOwner && (
          <>
            <div className="w-px bg-slate-100 dark:bg-slate-700"/>
            <button onClick={e => { e.stopPropagation(); onEdit(product); }}
              className="flex-1 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition rounded-br-2xl flex items-center justify-center gap-1.5 active:scale-95">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main Screen ──────────────────────────────────────────────── */
export default function Inventory({ inventory, isOwner = true, canAdd, plan = "starter", onUpgrade, branches = [], staffBranchId = null }) {
  // canAdd allows staff to add new products without full owner privileges
  const canAddStock = canAdd !== undefined ? canAdd : isOwner;
  const t = useT();
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("all");
  const [showForm,    setShowForm]    = useState(false);
  const [editProd,    setEditProd]    = useState(null);
  const [detailProd,  setDetailProd]  = useState(null);
  const [movModal,    setMovModal]    = useState(null); // { product, type }
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const [saving,      setSaving]      = useState(false);

  const { products, movements, loading, dbError, analytics,
          addProduct, updateProduct, deleteProduct, recordMovement, clearDbError } = inventory;
  const { lowStock, totalCost, totalRetail } = analytics;

  if (!canDo(plan, "inventory")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-5">
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="text-green-600">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Inventory Management</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs leading-relaxed">
          Track stock, manage products, get low-stock alerts, and analyse your best sellers. {planAvailableText("inventory")}
        </p>
        <button onClick={onUpgrade} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition shadow-md">
          {upgradeLabel("inventory")}
        </button>
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
    const ok = await recordMovement(movData);
    setSaving(false);
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

  return (
    <div className="pb-28 screen-enter">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white">{t("inv.title")}</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">{products.length} product{products.length !== 1 ? "s" : ""}</p>
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
                className="flex items-center gap-1.5 px-3.5 py-2 bg-green-600 text-white text-xs font-extrabold rounded-xl active:scale-95 transition shadow-sm">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add Stock
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
            placeholder="Search by name or SKU…"
            className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/40"/>
        </div>

        {/* Category filters */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id:"all",       label:`All (${products.length})` },
            ...(lowStock.length > 0 ? [{ id:"low_stock", label:`⚠ Low (${lowStock.length})` }] : []),
            ...categories.map(c => ({ id:c, label:c })),
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
            <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">Stock Cost</p>
            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 mt-0.5">{fmt(totalCost)}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800 p-3">
            <p className="text-[9px] text-green-700 dark:text-green-400 uppercase font-bold tracking-wide">Retail Value</p>
            <p className="text-sm font-extrabold text-green-700 dark:text-green-400 mt-0.5">{fmt(totalRetail)}</p>
          </div>
          <div className={`rounded-xl border p-3 ${lowStock.length > 0 ? "bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700"}`}>
            <p className={`text-[9px] uppercase font-bold tracking-wide ${lowStock.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>Low Stock</p>
            <p className={`text-sm font-extrabold mt-0.5 ${lowStock.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>{lowStock.length}</p>
          </div>
        </div>

        {/* Low stock banner */}
        {lowStock.length > 0 && (
          <button onClick={() => setCatFilter("low_stock")}
            className="w-full mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition">
            <span className="text-xl">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{lowStock.length} product{lowStock.length > 1 ? "s are" : " is"} low on stock</p>
              <p className="text-xs text-amber-600/70 dark:text-amber-500/70 mt-0.5 truncate">{lowStock.slice(0,3).map(p => p.product_name).join(", ")}{lowStock.length > 3 ? "…" : ""}</p>
            </div>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="text-amber-500 flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="w-8 h-8 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin"/>
            <p className="text-xs text-slate-400">Loading inventory…</p>
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
            <p className="text-slate-600 dark:text-slate-300 font-bold text-sm mb-1">No products yet</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">
              {canAddStock ? "Add your first product to start tracking stock" : "No products have been added yet"}
            </p>
            {canAddStock && (
              <button onClick={openAddForm}
                className="px-5 py-2.5 bg-green-600 text-white font-bold text-sm rounded-xl active:scale-95 transition">
                Add First Product
              </button>
            )}
          </div>
        )}

        {/* No search results */}
        {!loading && products.length > 0 && filtered.length === 0 && (
          <div className="text-center py-10">
            <p className="text-slate-500 dark:text-slate-400 text-sm">No products match your search</p>
            <button onClick={() => { setSearch(""); setCatFilter("all"); }} className="mt-2 text-xs text-green-600 font-bold active:scale-95">Clear filters</button>
          </div>
        )}

        {/* Product list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                isOwner={isOwner}
                staffBranchId={staffBranchId}
                onView={setDetailProd}
                onEdit={prod => { setEditProd(prod); setShowForm(true); }}
                onSale={prod => setMovModal({ product: prod, type: "sale" })}
                onRestock={prod => setMovModal({ product: prod, type: "restock" })}
              />
            ))}
          </div>
        )}
      </div>

      {/* DB error */}
      {dbError && (
        <div className="fixed bottom-28 left-4 right-4 max-w-md mx-auto z-50 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Error</p>
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
        />
      )}

      {showAnalytics && (
        <AnalyticsView analytics={analytics} products={products} onClose={() => setShowAnalytics(false)} />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl">
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Delete Product?</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              <span className="font-bold text-slate-700 dark:text-slate-200">{confirmDel.product_name}</span> and all its movement history will be permanently deleted.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)} className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm active:scale-95">Cancel</button>
              <button onClick={handleDelete} disabled={saving}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm active:scale-95 disabled:opacity-50">
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment shortcut (owner only) */}
      {isOwner && detailProd && !showForm && !movModal && !confirmDel && (
        <div className="fixed bottom-28 right-4 z-50">
          <button onClick={() => setMovModal({ product: detailProd, type: "adjustment" })}
            className="text-xs font-bold bg-slate-800 dark:bg-slate-700 text-white px-3 py-2 rounded-xl shadow-lg active:scale-95">
            Adjust Stock
          </button>
        </div>
      )}
    </div>
  );
}
