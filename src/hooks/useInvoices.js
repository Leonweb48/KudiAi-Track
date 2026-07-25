import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { today }    from "../utils/helpers";
import { notify, notifyBranchManager } from "../lib/notifyEngine";

const nairaToKobo = (n) => Math.round((parseFloat(n) || 0) * 100);

function getInitials(name) {
  return (name || "").trim().split(/\s+/).map(w => w[0] || "").join("").toUpperCase().slice(0, 4) || "X";
}

function enrichStatus(inv) {
  if (inv.status === "sent" && inv.due_date && inv.due_date < today()) {
    return { ...inv, status: "overdue" };
  }
  return inv;
}

// ── Phase 5: Payment provider adapter ───────────────────────────────────────
// To add a new provider (e.g. Anchor DVA webhook): add an entry below and pass
// provider: 'anchor' when calling recordInvoicePayment from the webhook handler.
// The UI always uses provider: 'manual'.
const PROVIDERS = {
  manual: {
    async insert(supabase, { invoiceId, amountKobo, method, reference, paidAt, userId }) {
      return supabase.from("invoice_payments").insert({
        invoice_id:  invoiceId,
        amount_kobo: amountKobo,
        method:      method || "cash",
        reference:   reference || null,
        paid_at:     paidAt || new Date().toISOString(),
        created_by:  userId,
        provider:    "manual",
      });
    },
  },
  // TODO Phase 5: Anchor DVA — replace stub when webhook handler is active.
  // Server-side webhook → calls recordInvoicePayment({ ..., provider: 'anchor' })
  anchor: {
    async insert() {
      throw new Error("Anchor adapter not yet live — use manual for now");
    },
  },
};

export function useInvoices(userId, staffId = null, branchId = null, staffName = null) {
  const [invoices,  setInvoices]  = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("*, invoice_items(*), invoice_payments(*)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("customers")
          .select("*")
          .eq("user_id", userId)
          .order("name"),
      ]);
      if (invRes.data)  setInvoices(invRes.data.map(enrichStatus));
      if (custRes.data) setCustomers(custRes.data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── Create draft ──────────────────────────────────────────────────────────
  const createDraft = async ({
    customer,
    items,
    discount_naira,
    vat_enabled,
    due_date,
    payment_instructions,
    notes,
    source_transaction_id,
    business_name,
    other_charges_kobo = 0,
    other_charges_label = "",
  }) => {
    // 1. Upsert customer
    let customerId = customer.id || null;
    if (!customerId) {
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .insert({ user_id: userId, name: customer.name.trim(), phone: customer.phone || "", email: customer.email || "" })
        .select().single();
      if (custErr) return { error: custErr };
      customerId = cust.id;
      setCustomers(prev => [...prev, cust].sort((a, b) => a.name.localeCompare(b.name)));
    }

    // 2. Compute totals in kobo
    const subtotal_kobo  = items.reduce((s, i) => s + i.line_total_kobo, 0);
    const discount_kobo  = nairaToKobo(discount_naira || 0);
    const after_discount = Math.max(0, subtotal_kobo - discount_kobo);
    const vat_kobo       = vat_enabled ? Math.round(after_discount * 0.075) : 0;
    const total_kobo     = after_discount + vat_kobo + (other_charges_kobo || 0);

    // 3. Generate invoice number (atomic counter + client-side formatting)
    const { data: seq, error: numErr } = await supabase
      .rpc("next_invoice_number", { p_user_id: userId });
    if (numErr) return { error: numErr };
    const mm  = String(new Date().getMonth() + 1).padStart(2, "0");
    const bizI   = getInitials(business_name || "BIZ");
    const clientI = getInitials(customer.name);
    const invNum  = `${bizI}/${clientI}/${mm}/${Math.max(1, 5000 - seq)}`;

    // 4. Insert invoice
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        user_id:               userId,
        customer_id:           customerId,
        customer_name:         customer.name.trim(),
        customer_phone:        customer.phone || "",
        customer_email:        customer.email || "",
        invoice_number:        invNum,
        status:                "draft",
        due_date:              due_date   || null,
        subtotal_kobo,
        discount_kobo,
        vat_kobo,
        other_charges_kobo:    other_charges_kobo || 0,
        other_charges_label:   other_charges_label || "",
        total_kobo,
        amount_paid_kobo:      0,
        payment_instructions:  payment_instructions || "",
        notes:                 notes || "",
        source_transaction_id: source_transaction_id || null,
      })
      .select().single();
    if (invErr) return { error: invErr };

    // 5. Insert line items (parents first to get IDs, then sub-items)
    const topItems = items.filter(item => item.description.trim());
    if (topItems.length > 0) {
      const { data: parentRows, error: itemErr } = await supabase
        .from("invoice_items")
        .insert(topItems.map((item, i) => ({
          invoice_id:      inv.id,
          description:     item.description,
          quantity:        item.quantity,
          unit_price_kobo: item.unit_price_kobo,
          line_total_kobo: item.line_total_kobo,
          pricing_mode:    item.pricing_mode || "manual",
          sort_order:      i,
          parent_item_id:  null,
          product_id:      item.product_id      || null,
          cost_price_kobo: item.cost_price_kobo || null,
        })))
        .select("id");
      if (itemErr) return { error: itemErr };

      const subRows = [];
      topItems.forEach((item, i) => {
        (item.sub_items || []).filter(s => s.description.trim()).forEach((sub, j) => {
          subRows.push({
            invoice_id:      inv.id,
            parent_item_id:  parentRows[i].id,
            description:     sub.description,
            quantity:        sub.quantity,
            unit_price_kobo: sub.unit_price_kobo,
            line_total_kobo: sub.line_total_kobo,
            pricing_mode:    "manual",
            sort_order:      j,
          });
        });
      });
      if (subRows.length > 0) {
        const { error: subErr } = await supabase.from("invoice_items").insert(subRows);
        if (subErr) return { error: subErr };
      }
    }

    await load();
    const invCreatedData = { ownerId: userId, invoiceId: inv.id, invoiceNumber: inv.invoice_number || "", amount: total_kobo / 100, customerName: customer.name.trim(), staffName: staffName || "Staff" };
    notify({ type: "invoice_created", userId, originUserId: staffId || userId, data: invCreatedData });
    if (branchId) notifyBranchManager(userId, branchId, { type: "invoice_created", originUserId: staffId || userId, data: invCreatedData });
    return { data: inv };
  };

  // ── Mark as sent (locks invoice) ─────────────────────────────────────────
  const markSent = async (id) => {
    const invLocal = invoices.find(i => i.id === id);
    const { error } = await supabase
      .from("invoices").update({ status: "sent" }).eq("id", id).eq("user_id", userId);
    if (!error) {
      setInvoices(prev => prev.map(i => i.id === id ? enrichStatus({ ...i, status: "sent" }) : i));
      const invSentData = { ownerId: userId, invoiceId: id, invoiceNumber: invLocal?.invoice_number || "", amount: (invLocal?.total_kobo || 0) / 100, customerName: invLocal?.customer_name || "", staffName: staffName || "Staff" };
      notify({ type: "invoice_sent", userId, originUserId: staffId || userId, data: invSentData });
      if (branchId) notifyBranchManager(userId, branchId, { type: "invoice_sent", originUserId: staffId || userId, data: invSentData });
    }
    return { error };
  };

  // ── Cancel invoice ────────────────────────────────────────────────────────
  const cancelInvoice = async (id) => {
    const { error } = await supabase
      .from("invoices").update({ status: "cancelled" }).eq("id", id).eq("user_id", userId);
    if (!error) setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "cancelled" } : i));
    return { error };
  };

  // ── Update existing draft ─────────────────────────────────────────────────
  const updateDraft = async (invoiceId, {
    customer, items, discount_naira, vat_enabled, due_date,
    payment_instructions, notes, other_charges_kobo = 0, other_charges_label = "",
  }) => {
    const subtotal_kobo  = items.reduce((s, i) => s + i.line_total_kobo, 0);
    const discount_kobo  = nairaToKobo(discount_naira || 0);
    const after_discount = Math.max(0, subtotal_kobo - discount_kobo);
    const vat_kobo       = vat_enabled ? Math.round(after_discount * 0.075) : 0;
    const total_kobo     = after_discount + vat_kobo + (other_charges_kobo || 0);

    // Update invoice header
    const { error: invErr } = await supabase
      .from("invoices")
      .update({
        customer_name:        customer.name.trim(),
        customer_phone:       customer.phone || "",
        customer_email:       customer.email || "",
        due_date:             due_date   || null,
        subtotal_kobo, discount_kobo, vat_kobo,
        other_charges_kobo:  other_charges_kobo || 0,
        other_charges_label: other_charges_label || "",
        total_kobo,
        payment_instructions: payment_instructions || "",
        notes:                notes || "",
      })
      .eq("id", invoiceId)
      .eq("user_id", userId);
    if (invErr) return { error: invErr };

    // Replace all line items (delete all, re-insert parents then sub-items)
    await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
    const topItems = items.filter(item => item.description.trim());
    if (topItems.length > 0) {
      const { data: parentRows, error: itemErr } = await supabase
        .from("invoice_items")
        .insert(topItems.map((item, i) => ({
          invoice_id:      invoiceId,
          description:     item.description,
          quantity:        item.quantity,
          unit_price_kobo: item.unit_price_kobo,
          line_total_kobo: item.line_total_kobo,
          pricing_mode:    item.pricing_mode || "manual",
          sort_order:      i,
          parent_item_id:  null,
          product_id:      item.product_id      || null,
          cost_price_kobo: item.cost_price_kobo || null,
        })))
        .select("id");
      if (itemErr) return { error: itemErr };

      const subRows = [];
      topItems.forEach((item, i) => {
        (item.sub_items || []).filter(s => s.description.trim()).forEach((sub, j) => {
          subRows.push({
            invoice_id:      invoiceId,
            parent_item_id:  parentRows[i].id,
            description:     sub.description,
            quantity:        sub.quantity,
            unit_price_kobo: sub.unit_price_kobo,
            line_total_kobo: sub.line_total_kobo,
            pricing_mode:    "manual",
            sort_order:      j,
          });
        });
      });
      if (subRows.length > 0) {
        const { error: subErr } = await supabase.from("invoice_items").insert(subRows);
        if (subErr) return { error: subErr };
      }
    }

    await load();
    return { data: { id: invoiceId } };
  };

  // ── Delete draft invoice ──────────────────────────────────────────────────
  const deleteInvoice = async (id) => {
    const { error } = await supabase
      .from("invoices").delete().eq("id", id).eq("user_id", userId);
    if (!error) setInvoices(prev => prev.filter(i => i.id !== id));
    return { error };
  };

  // ── Phase 4: Record payment ───────────────────────────────────────────────
  // provider: 'manual' (default) | 'anchor' (future Anchor DVA webhook).
  // All providers go through the same status-update logic below.
  const recordInvoicePayment = async ({
    invoiceId,
    amount_naira,
    method    = "cash",
    reference = "",
    paidAt,
    provider  = "manual",
  }) => {
    const amountKobo = nairaToKobo(amount_naira);
    if (!amountKobo || amountKobo <= 0) return { error: new Error("Amount must be greater than zero") };

    const prov = PROVIDERS[provider] || PROVIDERS.manual;

    // Insert into invoice_payments
    const { error: payErr } = await prov.insert(supabase, {
      invoiceId, amountKobo, method, reference, paidAt, userId,
    });
    if (payErr) return { error: payErr };

    // Fetch current invoice for running total
    const { data: inv, error: fetchErr } = await supabase
      .from("invoices")
      .select("total_kobo, amount_paid_kobo, status, invoice_number, customer_name")
      .eq("id", invoiceId)
      .single();
    if (fetchErr) return { error: fetchErr };

    const newPaidKobo = (inv.amount_paid_kobo || 0) + amountKobo;
    const newStatus   =
      newPaidKobo >= inv.total_kobo ? "paid"
      : newPaidKobo > 0             ? "partially_paid"
      :                               inv.status;

    const { error: updErr } = await supabase
      .from("invoices")
      .update({ amount_paid_kobo: newPaidKobo, status: newStatus })
      .eq("id", invoiceId)
      .eq("user_id", userId);
    if (updErr) return { error: updErr };

    if (newStatus === "paid") {
      const invPaidData = { ownerId: userId, invoiceId, invoiceNumber: inv.invoice_number || "", amount: inv.total_kobo / 100, customerName: inv.customer_name || "", staffName: staffName || "Staff" };
      notify({ type: "invoice_paid", userId, originUserId: staffId || userId, data: invPaidData });
      if (branchId) notifyBranchManager(userId, branchId, { type: "invoice_paid", originUserId: staffId || userId, data: invPaidData });
    }

    await load();
    return { data: { amountKobo, newStatus } };
  };

  return { invoices, customers, loading, reload: load, createDraft, updateDraft, markSent, cancelInvoice, deleteInvoice, recordInvoicePayment };
}
