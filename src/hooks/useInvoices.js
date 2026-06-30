import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { today }    from "../utils/helpers";

const nairaToKobo = (n) => Math.round((parseFloat(n) || 0) * 100);

function enrichStatus(inv) {
  if (inv.status === "sent" && inv.due_date && inv.due_date < today()) {
    return { ...inv, status: "overdue" };
  }
  return inv;
}

export function useInvoices(userId) {
  const [invoices,  setInvoices]  = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }
    setLoading(true);
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
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── Create draft ─────────────────────────────────────────────────
  const createDraft = async ({
    customer,            // { id?, name, phone, email }
    items,               // [{ description, quantity, unit_price_kobo, line_total_kobo }]
    discount_naira,
    vat_enabled,
    due_date,
    payment_instructions,
    notes,
    source_transaction_id,
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
    const total_kobo     = after_discount + vat_kobo;

    // 3. Generate invoice number server-side (atomic sequence)
    const { data: invNum, error: numErr } = await supabase
      .rpc("next_invoice_number", { p_user_id: userId });
    if (numErr) return { error: numErr };

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
        total_kobo,
        amount_paid_kobo:      0,
        payment_instructions:  payment_instructions || "",
        notes:                 notes || "",
        source_transaction_id: source_transaction_id || null,
      })
      .select().single();
    if (invErr) return { error: invErr };

    // 5. Insert line items
    if (items.length > 0) {
      const rows = items.map((item, i) => ({
        invoice_id:      inv.id,
        description:     item.description,
        quantity:        item.quantity,
        unit_price_kobo: item.unit_price_kobo,
        line_total_kobo: item.line_total_kobo,
        sort_order:      i,
      }));
      const { error: itemErr } = await supabase.from("invoice_items").insert(rows);
      if (itemErr) return { error: itemErr };
    }

    await load();
    return { data: inv };
  };

  // ── Mark as sent (locks invoice for editing) ─────────────────────
  const markSent = async (id) => {
    const { error } = await supabase
      .from("invoices").update({ status: "sent" }).eq("id", id).eq("user_id", userId);
    if (!error) setInvoices(prev => prev.map(i => i.id === id ? enrichStatus({ ...i, status: "sent" }) : i));
    return { error };
  };

  // ── Cancel draft ─────────────────────────────────────────────────
  const cancelInvoice = async (id) => {
    const { error } = await supabase
      .from("invoices").update({ status: "cancelled" }).eq("id", id).eq("user_id", userId);
    if (!error) setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "cancelled" } : i));
    return { error };
  };

  return { invoices, customers, loading, reload: load, createDraft, markSent, cancelInvoice };
}
