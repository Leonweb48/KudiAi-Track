// Money emails for the main pipeline, on the bank-grade layout (api/_lib/bankEmail.js).
//
// Called from api/email-trigger.js as  handleMoneyEmail(event, ctx)  — returns true
// when it handled the event. `ctx.d` is the ESCAPED payload (see escapeHtml.js), so
// values taken from it are HTML-safe; anything read from the database here is
// escaped explicitly.
//
// The reference, timestamp and balance-after in these emails come from the DATABASE
// (looked up by transaction_id / payment_id after checking the caller is allowed to
// see that row), never from values the client sent.
import { escapeHtml, decodeEntities } from "./escapeHtml.js";
import { bankEmail, naira, transactionLink } from "./bankEmail.js";
import { formatWAT } from "./wat.js";

const str = (v) => String(v ?? "");
const pmLabel = (v) => str(v || "cash").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const UUIDISH = /^[0-9a-f-]{20,40}$/i;

// Invoice line items (with their sub-items) as a compact table, for the note area of an invoice email.
// `items` comes from the ESCAPED payload, so every string in it is already HTML-safe.
function renderInvoiceItems(items, fmt) {
  if (!Array.isArray(items) || !items.length) return "";
  const th = "text-align:%;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;padding:0 0 6px;border-bottom:1px solid #e4e8f0;";
  const rows = items.flatMap((item) => {
    const parent = `<tr>
      <td style="font-size:12px;color:#374151;padding:7px 0;border-bottom:1px solid #f1f5f9;">${str(item.description)}</td>
      <td style="font-size:12px;color:#64748b;text-align:center;padding:7px 0;border-bottom:1px solid #f1f5f9;">${str(item.quantity)}</td>
      <td style="font-size:12px;font-weight:700;color:#0f172a;text-align:right;padding:7px 0;border-bottom:1px solid #f1f5f9;">${fmt(item.line_total)}</td>
    </tr>`;
    const subs = (item.sub_items || []).map((sub) => `<tr>
      <td style="font-size:11px;color:#64748b;padding:4px 0 4px 14px;border-bottom:1px solid #f8fafc;"><span style="color:#6d28d9;margin-right:4px;">•</span>${str(sub.description)}</td>
      <td style="font-size:11px;color:#94a3b8;text-align:center;padding:4px 0;border-bottom:1px solid #f8fafc;">${str(sub.quantity)}</td>
      <td style="font-size:11px;color:#94a3b8;text-align:right;padding:4px 0;border-bottom:1px solid #f8fafc;">${sub.line_total ? fmt(sub.line_total) : ""}</td>
    </tr>`);
    return [parent, ...subs];
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px;border-collapse:collapse;">
    <thead><tr>
      <th style="${th.replace("%", "left")}">Item</th>
      <th style="${th.replace("%", "center")}">Qty</th>
      <th style="${th.replace("%", "right")}">Total</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

export async function handleMoneyEmail(event, { d, q, qa, sb, user, fmt }) {
  // Server-side facts for one ledger row; null when missing or the caller may not see it.
  async function ledgerFacts(table, id, ownerCol) {
    const rowId = str(id);
    if (!rowId || !UUIDISH.test(rowId)) return null;
    try {
      const { data: row } = await sb.from(table).select(`receipt_ref, balance_after, created_at, ${ownerCol}`).eq("id", rowId).maybeSingle();
      if (!row) return null;
      const owner = row[ownerCol];
      let allowed = owner === user.id;
      if (!allowed) {
        const { data: st } = await sb.from("staff").select("id").eq("id", user.id).eq("user_id", owner).maybeSingle();
        allowed = !!st;
      }
      return allowed ? row : null;
    } catch { return null; }
  }
  const refOf = (F) => (F && F.receipt_ref ? escapeHtml(F.receipt_ref) : "Not available");
  const balOf = (F, fallback) => (F && F.balance_after != null ? naira(F.balance_after) : (fallback != null && fallback !== "" ? naira(fallback) : "Not available"));
  const biz = str(d.business_name) || "your business";

  // ── Cash in / cash out recorded ──────────────────────────────────────────────
  if (event === "transaction_credit" || event === "transaction_debit") {
    const isIn = event === "transaction_credit";
    const label = isIn ? "Cash In" : "Cash Out";
    const F = await ledgerFacts("transactions", d.transaction_id, "user_id");
    q(d.user_email, `${label}: ${fmt(d.amount)} — ${str(d.business_name) || "KudiAI Track"}`,
      bankEmail({
        title: "Transaction Successful",
        tone: isIn ? "success" : "warning",
        timestamp: F ? F.created_at : (d.occurred_at || new Date()),
        preheader: `${label} of ${naira(d.amount)} recorded on ${biz}`,
        intro: `A ${label.toLowerCase()} transaction was recorded on <strong>${biz}</strong>.`,
        amount: naira(d.amount),
        amountLabel: isIn ? "Amount Received" : "Amount Paid",
        rows: [
          ["Transaction Reference", refOf(F), { mono: true }],
          ["Payment Method", pmLabel(d.payment_method)],
          ["Category", str(d.category)],
          ["Description", str(d.description)],
          ["Customer", str(d.customer_name)],
          ["Recorded by", str(d.staff_name)],
          ["Business", str(d.business_name)],
          ["Note", str(d.note)],
          ["Balance After", balOf(F)],
        ],
        button: { label: "View Transaction →", url: F ? transactionLink(d.transaction_id) : "https://kudiai.app" },
      }));
    return true;
  }

  // ── Transaction failed / cancelled ───────────────────────────────────────────
  if (event === "transaction_failed" || event === "transaction_cancelled") {
    const word = event === "transaction_failed" ? "Failed" : "Cancelled";
    q(d.user_email, `Transaction ${word} — ${str(d.business_name) || "KudiAI Track"}`,
      bankEmail({
        title: `Transaction ${word}`,
        tone: "danger",
        timestamp: d.occurred_at || new Date(),
        intro: `A transaction on <strong>${biz}</strong> was ${word.toLowerCase()}. No entry was made in your records.`,
        amount: naira(d.amount),
        amountLabel: "Amount not recorded",
        rows: [
          ["Description", str(d.description)],
          ["Reason", str(d.reason)],
          ["Recorded by", str(d.staff_name)],
          ["Business", str(d.business_name)],
        ],
        note: "You can safely try the transaction again. If it keeps failing, contact support and quote the description above.",
        button: { label: "Open KudiAI Track →", url: "https://kudiai.app" },
      }));
    return true;
  }

  // ── New credit recorded (owner + the customer, if they have an email on file) ─
  if (event === "credit_added") {
    const owed = naira(d.total_amount);
    q(d.owner_email || d.user_email, `New Credit Record — ${str(d.customer_name)} · ${fmt(d.total_amount)}`,
      bankEmail({
        title: "New Credit Recorded",
        tone: "warning",
        timestamp: d.occurred_at || new Date(),
        intro: `A credit was recorded for <strong>${str(d.customer_name) || "a customer"}</strong> on <strong>${biz}</strong>.`,
        amount: owed,
        amountLabel: "Amount Owed",
        rows: [
          ["Customer", str(d.customer_name)],
          ["Customer Phone", str(d.customer_phone)],
          ["Due Date", str(d.due_date)],
          ["Recorded by", str(d.staff_name)],
          ["Business", str(d.business_name)],
          ["Notes", str(d.notes)],
        ],
        button: { label: "View Credit →", url: "https://kudiai.app" },
        security: false,
      }));
    if (d.customer_email) {
      q(d.customer_email, `Credit Notice — ${fmt(d.total_amount)} recorded under your name`,
        bankEmail({
          title: "Credit Recorded For You",
          tone: "warning",
          timestamp: d.occurred_at || new Date(),
          intro: `Hi <strong>${str(d.customer_name) || "there"}</strong>, <strong>${biz}</strong> has recorded a credit under your name. Please arrange repayment by the due date.`,
          amount: owed,
          amountLabel: "Amount Owed",
          rows: [
            ["Creditor", str(d.business_name)],
            ["Contact", str(d.business_phone)],
            ["Due Date", str(d.due_date)],
          ],
          note: "To pay, contact the business directly using the details above. KudiAI Track does not collect payments on their behalf.",
        }));
    }
    return true;
  }

  // ── Credit repayment / fully paid — the OWNER and, new, the DEBTOR ───────────
  if (event === "credit_repayment" || event === "credit_fully_paid") {
    // The app fires BOTH events for the final payment. Send only the "fully paid"
    // one then, so neither the owner nor the debtor gets two emails for one payment.
    if (event === "credit_repayment" && str(d.status) === "paid") return true;
    const isFull = event === "credit_fully_paid";
    const paid = d.amount_paid || d.amount;
    const F = await ledgerFacts("debt_payments", d.payment_id, "owner_id");
    const remaining = F && F.balance_after != null ? Number(F.balance_after) : Number(d.outstanding || 0);
    const when = F ? F.created_at : (d.occurred_at || new Date());
    const ref = refOf(F);

    q(d.owner_email || d.user_email, `${isFull ? "Credit Fully Paid!" : "Credit Repayment Received"} — ${str(d.customer_name)}`,
      bankEmail({
        title: isFull ? "Credit Fully Paid" : "Repayment Received",
        tone: "success",
        timestamp: when,
        intro: `<strong>${str(d.customer_name) || "A customer"}</strong> made a repayment on <strong>${biz}</strong>.${isFull ? " The credit is now fully settled." : ""}`,
        amount: naira(paid),
        amountLabel: "Amount Received",
        rows: [
          ["Transaction Reference", ref, { mono: true }],
          ["Customer", str(d.customer_name)],
          ["Payment Method", pmLabel(d.payment_method)],
          ["Total Debt", d.total_amount != null && d.total_amount !== "" ? naira(d.total_amount) : ""],
          ["Balance After", isFull ? "₦0.00 — fully settled" : naira(remaining)],
          ["Recorded by", str(d.staff_name)],
          ["Business", str(d.business_name)],
        ],
        button: { label: "View Credit →", url: "https://kudiai.app" },
      }));

    // The debtor used to get nothing. They now get a receipt.
    if (d.customer_email) {
      q(d.customer_email, `Payment Received — ${fmt(paid)} toward your balance at ${str(d.business_name) || "the business"}`,
        bankEmail({
          title: "Payment Received",
          tone: "success",
          timestamp: when,
          preheader: `We received ${naira(paid)} from you. Balance remaining: ${isFull ? "₦0.00" : naira(remaining)}`,
          intro: `Hi <strong>${str(d.customer_name) || "there"}</strong>, <strong>${biz}</strong> has received your payment. Thank you.`,
          amount: naira(paid),
          amountLabel: "Amount Paid",
          rows: [
            ["Transaction Reference", ref, { mono: true }],
            ["Payment Date", formatWAT(when)],
            ["Payment Method", pmLabel(d.payment_method)],
            ["Remaining Balance", isFull ? "₦0.00 — fully settled" : naira(remaining)],
            ["Business", str(d.business_name)],
            ["Business Phone", str(d.business_phone)],
          ],
          note: isFull
            ? "Your balance is fully settled. Keep this email as your proof of payment."
            : "Keep this email as your proof of payment. Contact the business using the details above if anything looks wrong.",
          button: str(d.business_phone) ? { label: `Call ${biz}`, url: `tel:${str(d.business_phone).replace(/[^0-9+]/g, "")}` } : undefined,
        }));
    }
    return true;
  }

  // ── Credit extended ──────────────────────────────────────────────────────────
  if (event === "credit_extended") {
    const added = naira(d.amount);
    const rows = (who) => [
      ["Customer", str(d.customer_name)],
      ["Extra Credit Added", added],
      ["New Total Outstanding", naira(d.outstanding)],
      [who === "owner" ? "Recorded by" : "Creditor", who === "owner" ? str(d.staff_name) : str(d.business_name)],
      ["Business", who === "owner" ? str(d.business_name) : ""],
    ];
    q(d.owner_email || d.user_email, `Credit Extended: ${fmt(d.amount)} — ${str(d.customer_name) || "Customer"}`,
      bankEmail({
        title: "Credit Extended", tone: "warning", timestamp: d.occurred_at || new Date(),
        intro: `More credit was extended to <strong>${str(d.customer_name) || "a customer"}</strong> on <strong>${biz}</strong>.`,
        amount: added, amountLabel: "Extra Credit Added", rows: rows("owner"),
        button: { label: "View Credit →", url: "https://kudiai.app" }, security: false,
      }));
    if (d.customer_email) {
      q(d.customer_email, `Credit Update — ${fmt(d.amount)} added, new outstanding ${fmt(d.outstanding)}`,
        bankEmail({
          title: "Credit Updated", tone: "warning", timestamp: d.occurred_at || new Date(),
          intro: `Hi <strong>${str(d.customer_name) || "there"}</strong>, your credit at <strong>${biz}</strong> has been updated. Please settle the balance as agreed.`,
          amount: naira(d.outstanding), amountLabel: "New Total Outstanding", rows: rows("customer"),
        }));
    }
    return true;
  }

  // ── Subscription payment failed ──────────────────────────────────────────────
  if (event === "payment_failed") {
    q(d.user_email, `Payment failed — ${str(d.plan_name) || "your subscription"}`,
      bankEmail({
        title: "Payment Unsuccessful", tone: "danger", timestamp: d.occurred_at || new Date(),
        intro: `Your payment for the <strong>${str(d.plan_name) || "subscription"}</strong> plan could not be completed.`,
        amount: naira(d.amount), amountLabel: "Payment not completed",
        rows: [["Plan", str(d.plan_name)], ["Reference", str(d.reference), { mono: true }]],
        note: "If your bank shows a debit for this attempt, it is returned to you automatically. If it is not, contact support and quote the reference above.",
        button: { label: "Try Again →", url: "https://kudiai.app" },
      }));
    return true;
  }

  // ── Subscription purchased ───────────────────────────────────────────────────
  if (event === "plan_purchased") {
    q(d.user_email, `Plan Confirmed: ${str(d.plan_name)} — KudiAI Track`,
      bankEmail({
        title: "Plan Purchase Confirmed", tone: "success", timestamp: d.occurred_at || new Date(),
        intro: `Hi <strong>${str(d.user_name) || "there"}</strong>, your <strong>${str(d.plan_name)}</strong> plan is active.`,
        amount: Number(d.plan_price) > 0 ? naira(d.plan_price) : undefined, amountLabel: "Amount Paid",
        rows: [["Plan", str(d.plan_name)], ["Billing", Number(d.plan_price) > 0 ? "Monthly" : ""], ["Reference", str(d.reference), { mono: true }]],
        button: { label: "Open Dashboard →", url: "https://kudiai.app" },
      }));
    return true;
  }

  // ── Invoices ─────────────────────────────────────────────────────────────────
  // An invoice is a request for payment, not a ledger row, so its "reference" is the
  // invoice number and there is no balance-after — the amount due / balance due stand in.
  if (event === "invoice_sent" || event === "invoice_paid" || event === "invoice_cancelled") {
    const no = str(d.invoice_number);
    const customer = str(d.customer_name) || "there";
    const phone = str(d.business_phone);
    const callButton = phone ? { label: `Call ${biz}`, url: `tel:${phone.replace(/[^0-9+]/g, "")}` } : undefined;
    const pdfAttachments = d.pdf_base64
      ? [{ filename: decodeEntities(str(d.pdf_filename)) || "invoice.pdf", content: Buffer.from(str(d.pdf_base64), "base64"), contentType: "application/pdf" }]
      : [];
    const money = (v) => (v != null && v !== "" && Number(v) !== 0 ? naira(v) : "");
    // subtotal / discount / VAT / other charges, as rows
    const totalsRows = [
      ["Subtotal", money(d.subtotal)],
      ["Discount", Number(d.discount) ? `−${naira(d.discount)}` : ""],
      ["VAT (7.5%)", money(d.vat)],
      [str(d.other_charges_label) || "Other Charges", money(d.other_charges)],
    ];
    const items = renderInvoiceItems(d.items, fmt);
    const when = d.occurred_at || new Date();

    if (event === "invoice_sent") {
      qa(d.customer_email, `Invoice ${no} from ${str(d.business_name) || "KudiAI Track"}`,
        bankEmail({
          title: "Invoice Received", tone: "warning", timestamp: when,
          preheader: `Invoice ${no} from ${biz} — ${naira(d.total)} due`,
          intro: `Hi <strong>${customer}</strong>, you have received an invoice from <strong>${biz}</strong>.`,
          amount: naira(d.total), amountLabel: "Total Due",
          rows: [
            ["Invoice Number", no, { mono: true }],
            ["Issue Date", str(d.issue_date)],
            ["Due Date", str(d.due_date)],
            ...totalsRows,
            ["From", str(d.business_name)],
            ["Business Phone", phone],
          ],
          note: `${items}<p style="margin:10px 0 0;font-size:12px;color:#64748b;">Please arrange payment before the due date. Contact <strong>${biz}</strong> if you have any questions. The invoice is attached as a PDF.</p>`,
          button: callButton,
        }), pdfAttachments);
      q(d.owner_email || d.user_email, `Invoice ${no} Sent — ${str(d.customer_name)}`,
        bankEmail({
          title: "Invoice Sent", tone: "neutral", timestamp: when,
          intro: `Invoice <strong>${no}</strong> has been sent to <strong>${str(d.customer_name) || "your customer"}</strong>.`,
          amount: naira(d.total), amountLabel: "Invoice Total",
          rows: [
            ["Invoice Number", no, { mono: true }],
            ["Customer", str(d.customer_name)],
            ["Customer Email", str(d.customer_email)],
            ["Customer Phone", str(d.customer_phone)],
            ["Due Date", str(d.due_date)],
          ],
          button: { label: "View Invoices →", url: "https://kudiai.app" },
          security: false,
        }));
      return true;
    }

    if (event === "invoice_paid") {
      const paid = d.amount_paid || d.total;
      const balanceDue = Number(d.balance_due || 0);
      const balanceText = balanceDue > 0 ? naira(balanceDue) : "₦0.00 — fully paid";
      qa(d.customer_email, `Payment Confirmed — Invoice ${no}`,
        bankEmail({
          title: "Payment Received", tone: "success", timestamp: when,
          preheader: `We received ${naira(paid)} for invoice ${no}. Balance due: ${balanceDue > 0 ? naira(balanceDue) : "₦0.00"}`,
          intro: `Hi <strong>${customer}</strong>, your payment for Invoice <strong>${no}</strong> has been received.${balanceDue > 0 ? "" : " Thank you — the invoice is fully paid."}`,
          amount: naira(paid), amountLabel: "Amount Paid",
          rows: [
            ["Invoice Number", no, { mono: true }],
            ["Payment Date", formatWAT(when)],
            ["Payment Method", d.payment_method ? pmLabel(d.payment_method) : ""],
            ...totalsRows,
            ["Invoice Total", money(d.total)],
            ["Balance Due", balanceText],
            ["Business", str(d.business_name)],
            ["Business Phone", phone],
          ],
          note: items || undefined,
          button: callButton,
        }), pdfAttachments);
      q(d.owner_email || d.user_email, `Invoice Paid — ${str(d.customer_name)} · ${fmt(paid)}`,
        bankEmail({
          title: "Invoice Paid", tone: "success", timestamp: when,
          intro: `<strong>${str(d.customer_name) || "A customer"}</strong> has paid Invoice <strong>${no}</strong>.`,
          amount: naira(paid), amountLabel: "Amount Paid",
          rows: [
            ["Invoice Number", no, { mono: true }],
            ["Customer", str(d.customer_name)],
            ["Payment Method", d.payment_method ? pmLabel(d.payment_method) : ""],
            ["Invoice Total", money(d.total)],
            ["Balance Due", balanceText],
          ],
          button: { label: "View Invoices →", url: "https://kudiai.app" },
        }));
      return true;
    }

    // invoice_cancelled — nothing is owed any more
    q(d.customer_email, `Invoice ${no} Cancelled`,
      bankEmail({
        title: "Invoice Cancelled", tone: "neutral", timestamp: when,
        intro: `Hi <strong>${customer}</strong>, Invoice <strong>${no}</strong>${str(d.business_name) ? ` from <strong>${str(d.business_name)}</strong>` : ""} has been cancelled. You do not need to make any payment for it.`,
        rows: [["Invoice Number", no, { mono: true }], ["From", str(d.business_name)], ["Business Phone", phone]],
        note: `If you believe this is an error, please contact ${biz === "your business" ? "your supplier" : biz} directly.`,
        button: callButton,
      }));
    return true;
  }

  return false;
}
