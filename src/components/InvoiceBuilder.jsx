import { useState, useMemo } from "react";
import Field  from "./shared/Field";
import { fmt } from "../utils/helpers";

const nairaToKobo = (n) => Math.round((parseFloat(n) || 0) * 100);
const koboToNaira = (k) => (k || 0) / 100;
const fmtK        = (k) => fmt(koboToNaira(k));

const STEPS = ["Customer", "Items", "Adjustments", "Payment", "Review"];

function StepBar({ step }) {
  return (
    <div className="flex items-center gap-1 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center flex-1">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 transition-colors ${
            i < step  ? "bg-brand-600 text-white"
            : i === step ? "bg-brand-600 text-white ring-2 ring-brand-200 dark:ring-brand-800"
            : "bg-slate-100 dark:bg-slate-700 text-slate-400"
          }`}>{i + 1}</div>
          {i < STEPS.length - 1 && (
            <div className={`h-[2px] flex-1 mx-1 rounded transition-colors ${i < step ? "bg-brand-600" : "bg-slate-100 dark:bg-slate-700"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Customer ─────────────────────────────────────────────
function StepCustomer({ customers, value, onChange }) {
  const [query, setQuery] = useState("");
  const [mode,  setMode]  = useState(value.id ? "existing" : "new"); // 'search' | 'existing' | 'new'

  const filtered = useMemo(() => {
    if (!query.trim()) return customers.slice(0, 8);
    const q = query.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || "").includes(q)
    ).slice(0, 8);
  }, [customers, query]);

  const selectExisting = (c) => {
    onChange({ id: c.id, name: c.name, phone: c.phone || "", email: c.email || "" });
    setMode("existing");
  };

  const clearSelection = () => {
    onChange({ id: null, name: "", phone: "", email: "" });
    setMode("new");
    setQuery("");
  };

  if (mode === "existing") {
    return (
      <div>
        <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-2xl p-4 mb-4">
          <p className="text-xs font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wide mb-1">Selected Customer</p>
          <p className="font-bold text-slate-800 dark:text-white">{value.name}</p>
          {value.phone && <p className="text-sm text-slate-500 dark:text-slate-400">{value.phone}</p>}
          {value.email && <p className="text-sm text-slate-500 dark:text-slate-400">{value.email}</p>}
        </div>
        <button onClick={clearSelection}
          className="text-sm text-brand-600 dark:text-brand-400 font-semibold">
          Change customer
        </button>
      </div>
    );
  }

  return (
    <div>
      {customers.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Search existing</p>
          <input
            className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Name or phone…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query.trim() && filtered.length > 0 && (
            <div className="mt-1 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
              {filtered.map(c => (
                <button key={c.id} onClick={() => selectExisting(c)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-50 dark:border-slate-700 last:border-0">
                  <span className="font-semibold text-slate-800 dark:text-white">{c.name}</span>
                  {c.phone && <span className="text-slate-400 ml-2">{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
            <span className="text-xs text-slate-400">or create new</span>
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
          </div>
        </div>
      )}

      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
        {customers.length === 0 ? "Customer details" : "New customer"}
      </p>
      <Field label="Full Name *" value={value.name}
        onChange={e => onChange({ ...value, id: null, name: e.target.value })}
        placeholder="e.g. Chike Obi" />
      <Field label="Phone *" type="tel" value={value.phone}
        onChange={e => onChange({ ...value, id: null, phone: e.target.value })}
        placeholder="080…" />
      <Field label="Email" type="email" value={value.email}
        onChange={e => onChange({ ...value, id: null, email: e.target.value })}
        placeholder="optional" />
    </div>
  );
}

// ── Step 2: Line Items ───────────────────────────────────────────
function recalcItem(item) {
  const qty = parseFloat(item.quantity) || 0;
  const hasPricedSubs = (item.sub_items || []).some(s => s.unit_price_kobo > 0);
  if (hasPricedSubs) {
    const subTotal = (item.sub_items || []).reduce((s, sub) => s + sub.line_total_kobo, 0);
    return { ...item, pricing_mode: "auto", line_total_kobo: Math.round(qty * subTotal) };
  }
  return { ...item, pricing_mode: "manual", line_total_kobo: Math.round(item.unit_price_kobo * qty) };
}

function StepItems({ items, onChange, products }) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQ,    setPickerQ]    = useState("");

  const addBlank = () => onChange([...items, {
    description: "", quantity: "1", unit_price: "", unit_price_kobo: 0,
    line_total_kobo: 0, pricing_mode: "manual", sub_items: [],
  }]);

  const addFromProduct = (p) => {
    const up_kobo = nairaToKobo(p.selling_price || 0);
    onChange([...items, {
      description: p.product_name, quantity: "1",
      unit_price: String(p.selling_price || ""), unit_price_kobo: up_kobo,
      line_total_kobo: up_kobo, pricing_mode: "manual", sub_items: [],
    }]);
    setShowPicker(false); setPickerQ("");
  };

  const update = (i, field, val) => {
    const next = items.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: val };
      if (field === "unit_price") updated.unit_price_kobo = nairaToKobo(val);
      return recalcItem(updated);
    });
    onChange(next);
  };

  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  const addSubItem = (parentIdx) => {
    const next = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const newSub = { description: "", quantity: "1", unit_price: "", unit_price_kobo: 0, line_total_kobo: 0 };
      return { ...item, sub_items: [...(item.sub_items || []), newSub] };
    });
    onChange(next);
  };

  const removeSubItem = (parentIdx, subIdx) => {
    const next = items.map((item, i) => {
      if (i !== parentIdx) return item;
      return recalcItem({ ...item, sub_items: (item.sub_items || []).filter((_, j) => j !== subIdx) });
    });
    onChange(next);
  };

  const updateSubItem = (parentIdx, subIdx, field, val) => {
    const next = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const updatedSubs = (item.sub_items || []).map((sub, j) => {
        if (j !== subIdx) return sub;
        const updated = { ...sub, [field]: val };
        if (field === "unit_price" || field === "quantity") {
          const up_kobo = nairaToKobo(field === "unit_price" ? val : updated.unit_price);
          const qty     = parseFloat(field === "quantity" ? val : updated.quantity) || 0;
          updated.unit_price_kobo = up_kobo;
          updated.line_total_kobo = Math.round(up_kobo * qty);
        }
        return updated;
      });
      return recalcItem({ ...item, sub_items: updatedSubs });
    });
    onChange(next);
  };

  const filteredProducts = useMemo(() => {
    if (!pickerQ.trim()) return (products || []).slice(0, 10);
    const q = pickerQ.toLowerCase();
    return (products || []).filter(p => p.product_name.toLowerCase().includes(q)).slice(0, 10);
  }, [products, pickerQ]);

  const subtotal = items.reduce((s, i) => s + i.line_total_kobo, 0);

  return (
    <div>
      {items.map((item, i) => {
        const isAuto = item.pricing_mode === "auto";
        const subs   = item.sub_items || [];
        return (
          <div key={i} className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-3 mb-3">
            {/* Parent row */}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label="Description *"
                  value={item.description}
                  onChange={e => update(i, "description", e.target.value)}
                  placeholder="Product or service" />
              </div>
              <button onClick={() => remove(i)}
                className="mt-5 w-11 h-11 flex items-center justify-center rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0 active:scale-95 transition">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
              </button>
            </div>
            <div className="flex gap-2">
              <div className="w-16 flex-shrink-0">
                <Field label="Qty" type="number" inputMode="numeric" value={item.quantity}
                  onChange={e => update(i, "quantity", e.target.value)} />
              </div>
              <div className="flex-1">
                {isAuto ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide uppercase">Unit Price</label>
                    <div className="py-2.5 px-3 text-xs text-slate-400 italic bg-white dark:bg-slate-600 rounded-xl border border-slate-100 dark:border-slate-600">
                      Auto-sum ↑
                    </div>
                  </div>
                ) : (
                  <Field label="Unit Price (₦)" type="number" inputMode="decimal" value={item.unit_price}
                    onChange={e => update(i, "unit_price", e.target.value)} />
                )}
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">Total</label>
                <div className="py-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                  {fmtK(item.line_total_kobo)}
                </div>
              </div>
            </div>

            {/* Sub-items — indented with left connector */}
            {subs.length > 0 && (
              <div className="mt-2 ml-2 pl-3 border-l-2 border-brand-300 dark:border-brand-700 space-y-2">
                {subs.map((sub, si) => (
                  <div key={si} className="bg-white dark:bg-slate-700 rounded-xl p-2 border border-slate-100 dark:border-slate-600">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <Field
                          label={`Sub-item ${si + 1}`}
                          value={sub.description}
                          onChange={e => updateSubItem(i, si, "description", e.target.value)}
                          placeholder="e.g. Jollof rice ×25" />
                      </div>
                      <button onClick={() => removeSubItem(i, si)}
                        className="mt-5 w-11 h-11 flex items-center justify-center rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0 active:scale-95 transition">
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-14 flex-shrink-0">
                        <Field label="Qty" type="number" inputMode="numeric" value={sub.quantity}
                          onChange={e => updateSubItem(i, si, "quantity", e.target.value)} />
                      </div>
                      <div className="flex-1">
                        <Field label="Price (₦)" type="number" inputMode="decimal" value={sub.unit_price}
                          onChange={e => updateSubItem(i, si, "unit_price", e.target.value)}
                          placeholder="Blank = descriptive" />
                      </div>
                      {sub.line_total_kobo > 0 && (
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide uppercase">Sub-total</label>
                          <div className="py-3 text-xs font-bold text-slate-600 dark:text-slate-300">{fmtK(sub.line_total_kobo)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Bottom row: add sub-item + mode hint */}
            <div className="flex items-center justify-between mt-2 pt-1.5">
              <button onClick={() => addSubItem(i)}
                className="text-xs text-brand-600 dark:text-brand-400 font-semibold active:scale-95 transition py-1">
                + Add sub-item
              </button>
              {isAuto && (
                <span className="text-[10px] text-slate-400 italic">
                  {item.quantity}× bundle · sub-items drive the price
                </span>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 mb-4">
        <button onClick={addBlank}
          className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-500 dark:text-slate-400 active:scale-95 transition">
          + Add item
        </button>
        {(products || []).length > 0 && (
          <button onClick={() => setShowPicker(true)}
            className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-brand-200 dark:border-brand-700 text-sm font-semibold text-brand-600 dark:text-brand-400 active:scale-95 transition">
            From catalog
          </button>
        )}
      </div>

      {showPicker && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Product catalog</p>
            <button onClick={() => setShowPicker(false)}
              className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition active:scale-95">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <input
            className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2"
            placeholder="Search products…"
            value={pickerQ}
            onChange={e => setPickerQ(e.target.value)}
          />
          <div className="max-h-48 overflow-y-auto">
            {filteredProducts.map(p => (
              <button key={p.id} onClick={() => addFromProduct(p)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-white">{p.product_name}</span>
                <span className="text-slate-500 dark:text-slate-400 text-xs">{fmt(p.selling_price || 0)}</span>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No products found</p>
            )}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between py-3 border-t border-slate-100 dark:border-slate-700">
          <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Subtotal</span>
          <span className="text-base font-extrabold text-slate-800 dark:text-white">{fmtK(subtotal)}</span>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Adjustments ──────────────────────────────────────────
function StepAdjust({ items, value, onChange, profileVatEnabled }) {
  const subtotal_kobo  = items.reduce((s, i) => s + i.line_total_kobo, 0);
  const discount_kobo  = nairaToKobo(value.discount_naira || 0);
  const after_discount = Math.max(0, subtotal_kobo - discount_kobo);
  const vat_kobo       = value.vat_enabled ? Math.round(after_discount * 0.075) : 0;
  const ocv            = parseFloat(value.other_charges_value) || 0;
  const other_charges_kobo = value.other_charges_enabled
    ? (value.other_charges_mode === "pct" ? Math.round(after_discount * ocv / 100) : nairaToKobo(ocv))
    : 0;
  const total_kobo     = after_discount + vat_kobo + other_charges_kobo;

  return (
    <div>
      <Field label="Discount (₦)" type="number" inputMode="decimal"
        value={value.discount_naira}
        onChange={e => onChange({ ...value, discount_naira: e.target.value })}
        placeholder="0" />

      <div className="flex items-center justify-between mb-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">VAT (7.5%)</p>
          <p className="text-xs text-slate-400">
            {value.vat_enabled ? `+${fmtK(vat_kobo)}` : "Off"}
          </p>
        </div>
        <button onClick={() => onChange({ ...value, vat_enabled: !value.vat_enabled })}
          className={`w-12 h-6 rounded-full transition-colors relative ${value.vat_enabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value.vat_enabled ? "translate-x-6" : "translate-x-0.5"}`} />
        </button>
      </div>

      <div className="flex items-center justify-between mb-2 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Other Charges</p>
          <p className="text-xs text-slate-400">
            {value.other_charges_enabled ? (other_charges_kobo > 0 ? `+${fmtK(other_charges_kobo)}` : "Set amount below") : "Off"}
          </p>
        </div>
        <button onClick={() => onChange({ ...value, other_charges_enabled: !value.other_charges_enabled })}
          className={`w-12 h-6 rounded-full transition-colors relative ${value.other_charges_enabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value.other_charges_enabled ? "translate-x-6" : "translate-x-0.5"}`} />
        </button>
      </div>

      {value.other_charges_enabled && (
        <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl px-4 pt-3 pb-4 mb-4 space-y-2">
          <Field label="Charge Label"
            value={value.other_charges_label}
            onChange={e => onChange({ ...value, other_charges_label: e.target.value })}
            placeholder="e.g. Delivery Fee, Service Charge" />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">Type</label>
              <select
                value={value.other_charges_mode}
                onChange={e => onChange({ ...value, other_charges_mode: e.target.value })}
                className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="fixed">Fixed (₦)</option>
                <option value="pct">Percentage (%)</option>
              </select>
            </div>
            <div className="flex-1">
              <Field
                label={value.other_charges_mode === "pct" ? "Rate (%)" : "Amount (₦)"}
                type="number" inputMode="decimal"
                value={value.other_charges_value}
                onChange={e => onChange({ ...value, other_charges_value: e.target.value })}
                placeholder="0" />
            </div>
          </div>
        </div>
      )}

      <Field label="Due Date" type="date"
        value={value.due_date}
        onChange={e => onChange({ ...value, due_date: e.target.value })} />

      <Field label="Notes" as="textarea"
        value={value.notes}
        onChange={e => onChange({ ...value, notes: e.target.value })}
        placeholder="Any additional notes for this invoice…" />

      <div className="mt-4 bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 space-y-2">
        <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
          <span>Subtotal</span><span>{fmtK(subtotal_kobo)}</span>
        </div>
        {discount_kobo > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Discount</span><span>−{fmtK(discount_kobo)}</span>
          </div>
        )}
        {vat_kobo > 0 && (
          <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>VAT (7.5%)</span><span>{fmtK(vat_kobo)}</span>
          </div>
        )}
        {other_charges_kobo > 0 && (
          <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>{value.other_charges_label || "Other Charges"}</span><span>{fmtK(other_charges_kobo)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-extrabold text-slate-800 dark:text-white border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
          <span>Total</span><span>{fmtK(total_kobo)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Step 4: Payment Instructions ─────────────────────────────────
function StepPayment({ value, onChange, profile }) {
  const defaultInstructions = [
    profile?.bank_name           && `Bank: ${profile.bank_name}`,
    profile?.bank_account_number && `Account: ${profile.bank_account_number}`,
    profile?.bank_account_name   && `Name: ${profile.bank_account_name}`,
  ].filter(Boolean).join("\n");

  // Pre-fill once from profile if field is empty
  const handleFocus = () => {
    if (!value.payment_instructions && defaultInstructions) {
      onChange({ ...value, payment_instructions: defaultInstructions });
    }
  };

  return (
    <div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 leading-relaxed">
        This text appears on the invoice PDF under "How to Pay". Pre-filled from your bank details in settings if available.
      </p>
      <Field label="Payment Instructions" as="textarea"
        value={value.payment_instructions}
        onChange={e => onChange({ ...value, payment_instructions: e.target.value })}
        onFocus={handleFocus}
        placeholder={"Bank: GTBank\nAccount: 0123456789\nName: My Business"}
        rows={5} />
      {!profile?.bank_account_number && (
        <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2">
          Tip: Add your bank details in Settings → Profile to auto-fill this in future.
        </p>
      )}
    </div>
  );
}

// ── Step 5: Review ───────────────────────────────────────────────
function StepReview({ customer, items, adjust, payment }) {
  const subtotal_kobo  = items.reduce((s, i) => s + i.line_total_kobo, 0);
  const discount_kobo  = nairaToKobo(adjust.discount_naira || 0);
  const after_discount = Math.max(0, subtotal_kobo - discount_kobo);
  const vat_kobo       = adjust.vat_enabled ? Math.round(after_discount * 0.075) : 0;
  const ocv            = parseFloat(adjust.other_charges_value) || 0;
  const other_charges_kobo = adjust.other_charges_enabled
    ? (adjust.other_charges_mode === "pct" ? Math.round(after_discount * ocv / 100) : nairaToKobo(ocv))
    : 0;
  const total_kobo     = after_discount + vat_kobo + other_charges_kobo;

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Customer</p>
        <p className="font-bold text-slate-800 dark:text-white">{customer.name}</p>
        {customer.phone && <p className="text-sm text-slate-500">{customer.phone}</p>}
      </div>

      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Line Items</p>
        {items.map((item, i) => (
          <div key={i} className="mb-3 last:mb-0">
            <div className="flex items-start justify-between">
              <div className="flex-1 mr-4">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.description}</p>
                <p className="text-xs text-slate-400">
                  {item.pricing_mode === "auto"
                    ? `${item.quantity}× bundle (sub-items drive price)`
                    : `${item.quantity} × ${fmt(koboToNaira(item.unit_price_kobo))}`}
                </p>
              </div>
              <span className="text-sm font-bold text-slate-800 dark:text-white">{fmtK(item.line_total_kobo)}</span>
            </div>
            {(item.sub_items || []).length > 0 && (
              <div className="ml-2 pl-3 border-l-2 border-slate-100 dark:border-slate-700 mt-1 space-y-1">
                {item.sub_items.map((sub, si) => (
                  <div key={si} className="flex items-start justify-between">
                    <div className="flex-1 mr-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">• {sub.description}</p>
                      {sub.unit_price_kobo > 0 && (
                        <p className="text-[10px] text-slate-400">{sub.quantity} × {fmt(koboToNaira(sub.unit_price_kobo))}</p>
                      )}
                    </div>
                    {sub.line_total_kobo > 0 && (
                      <span className="text-xs text-slate-500">{fmtK(sub.line_total_kobo)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4 space-y-1.5">
        <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
          <span>Subtotal</span><span>{fmtK(subtotal_kobo)}</span>
        </div>
        {discount_kobo > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Discount</span><span>−{fmtK(discount_kobo)}</span>
          </div>
        )}
        {vat_kobo > 0 && (
          <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>VAT (7.5%)</span><span>{fmtK(vat_kobo)}</span>
          </div>
        )}
        {other_charges_kobo > 0 && (
          <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>{adjust.other_charges_label || "Other Charges"}</span><span>{fmtK(other_charges_kobo)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-extrabold text-slate-800 dark:text-white pt-1.5 border-t border-slate-200 dark:border-slate-700">
          <span>Total</span><span>{fmtK(total_kobo)}</span>
        </div>
      </div>

      {adjust.due_date && (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Due {new Date(adjust.due_date + "T00:00:00").toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" })}
        </div>
      )}

      {payment.payment_instructions && (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Payment Instructions</p>
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{payment.payment_instructions}</p>
        </div>
      )}
    </div>
  );
}

// ── Main InvoiceBuilder ──────────────────────────────────────────
export default function InvoiceBuilder({
  userId, profile, customers, products,
  onClose, onSaved,
  sourceTransaction,
  initialData,   // pass existing draft invoice to pre-fill for editing
}) {
  const isEditing = !!initialData;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  // Step state — pre-fill from initialData when editing
  const [customer, setCustomer] = useState(() => {
    if (initialData) {
      return {
        id:    initialData.customer_id    || null,
        name:  initialData.customer_name  || "",
        phone: initialData.customer_phone || "",
        email: initialData.customer_email || "",
      };
    }
    if (sourceTransaction) {
      return { id: null, name: sourceTransaction.customer_name || "", phone: "", email: "" };
    }
    return { id: null, name: "", phone: "", email: "" };
  });

  const [items, setItems] = useState(() => {
    if (initialData?.invoice_items?.length) {
      const allRows = initialData.invoice_items;
      const topRows = allRows.filter(i => !i.parent_item_id).sort((a, b) => (a.sort_order||0) - (b.sort_order||0));
      const children = allRows.filter(i => i.parent_item_id);
      return topRows.map(i => ({
        description:     i.description     || "",
        quantity:        String(i.quantity  || 1),
        unit_price:      String((i.unit_price_kobo || 0) / 100),
        unit_price_kobo: i.unit_price_kobo || 0,
        line_total_kobo: i.line_total_kobo || 0,
        pricing_mode:    i.pricing_mode    || "manual",
        sub_items:       children
          .filter(c => c.parent_item_id === i.id)
          .sort((a, b) => (a.sort_order||0) - (b.sort_order||0))
          .map(sub => ({
            description:     sub.description || "",
            quantity:        String(sub.quantity || 1),
            unit_price:      String((sub.unit_price_kobo || 0) / 100),
            unit_price_kobo: sub.unit_price_kobo || 0,
            line_total_kobo: sub.line_total_kobo || 0,
          })),
      }));
    }
    if (sourceTransaction) {
      return [{
        description:     sourceTransaction.item_name || sourceTransaction.category || "Sale",
        quantity:        String(sourceTransaction.quantity || 1),
        unit_price:      String(sourceTransaction.amount || ""),
        unit_price_kobo: Math.round((parseFloat(sourceTransaction.amount) || 0) * 100),
        line_total_kobo: Math.round((parseFloat(sourceTransaction.amount) || 0) * 100),
      }];
    }
    return [];
  });

  const [adjust, setAdjust] = useState(() => ({
    discount_naira:       initialData ? String((initialData.discount_kobo || 0) / 100) : "",
    vat_enabled:          initialData ? (initialData.vat_kobo || 0) > 0 : (profile?.vat_enabled || false),
    due_date:             initialData?.due_date || "",
    notes:                initialData?.notes    || "",
    other_charges_enabled: initialData ? (initialData.other_charges_kobo || 0) > 0 : false,
    other_charges_label:   initialData?.other_charges_label || "",
    other_charges_mode:    "fixed",
    other_charges_value:   initialData ? String((initialData.other_charges_kobo || 0) / 100) : "",
  }));

  const [payment, setPayment] = useState({
    payment_instructions: initialData?.payment_instructions || "",
  });

  // ── Validation per step ──────────────────────────────────────
  const canNext = useMemo(() => {
    if (step === 0) return customer.name.trim() && customer.phone.trim();
    if (step === 1) return items.length > 0 && items.every(i => i.description.trim() && i.line_total_kobo > 0);
    return true;
  }, [step, customer, items]);

  const next = () => { setError(""); setStep(s => s + 1); };
  const back = () => { setError(""); setStep(s => s - 1); };

  const handleSave = async (saveAs) => {
    setSaving(true);
    setError("");
    const subtotal_kobo  = items.reduce((s, i) => s + i.line_total_kobo, 0);
    const discount_kobo  = nairaToKobo(adjust.discount_naira || 0);
    const after_discount = Math.max(0, subtotal_kobo - discount_kobo);
    let other_charges_kobo = 0;
    if (adjust.other_charges_enabled) {
      const v = parseFloat(adjust.other_charges_value) || 0;
      other_charges_kobo = adjust.other_charges_mode === "pct"
        ? Math.round(after_discount * v / 100)
        : nairaToKobo(v);
    }
    const { data, error: err } = await onSaved({
      customer,
      items,
      discount_naira:       adjust.discount_naira,
      vat_enabled:          adjust.vat_enabled,
      due_date:             adjust.due_date,
      notes:                adjust.notes,
      payment_instructions: payment.payment_instructions,
      source_transaction_id: sourceTransaction?.id || null,
      other_charges_kobo,
      other_charges_label:  adjust.other_charges_enabled ? (adjust.other_charges_label || "Other Charges") : "",
      _saveAs:  saveAs,
      _editId:  isEditing ? initialData.id : null,
    });
    setSaving(false);
    if (err) { setError(err.message || "Failed to save invoice"); return; }
    onClose(data);
  };

  return (
    <div className="fixed inset-0 z-sheet flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl max-h-[94dvh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <span className="font-bold text-slate-800 dark:text-white text-base">
            {isEditing ? "Edit Invoice" : sourceTransaction ? "Convert to Invoice" : "New Invoice"}
          </span>
          <button onClick={() => onClose()} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-95">
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Step bar */}
        <StepBar step={step} />

        {/* Step label */}
        <div className="px-5 pt-4 pb-1 flex-shrink-0">
          <h2 className="text-base font-extrabold text-slate-800 dark:text-white">{STEPS[step]}</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {step === 0 && <StepCustomer customers={customers} value={customer} onChange={setCustomer} />}
          {step === 1 && <StepItems items={items} onChange={setItems} products={products} />}
          {step === 2 && <StepAdjust items={items} value={adjust} onChange={setAdjust} profileVatEnabled={profile?.vat_enabled} />}
          {step === 3 && <StepPayment value={payment} onChange={setPayment} profile={profile} />}
          {step === 4 && <StepReview customer={customer} items={items} adjust={adjust} payment={payment} />}

          {error && (
            <p className="mt-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer nav */}
        <div className="px-5 border-t border-slate-100 dark:border-slate-700 flex gap-3 flex-shrink-0" style={{ paddingTop: "16px", paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          {step > 0 && (
            <button onClick={back} disabled={saving}
              className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-slate-600 dark:text-slate-300 active:scale-95 transition">
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={next} disabled={!canNext}
              className={`flex-1 py-3 rounded-2xl text-sm font-bold text-white transition active:scale-95 ${canNext ? "bg-brand-600 hover:bg-brand-700" : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"}`}>
              Next
            </button>
          ) : (
            <button onClick={() => handleSave("draft")} disabled={saving}
              className="flex-1 py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold active:scale-95 transition">
              {saving ? "Saving…" : "Save Draft"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
