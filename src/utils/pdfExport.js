import { createReportPdf, fmtCurrency } from "./generateReportPdf";

/* ── Transaction Receipt ──────────────────────────────────────────── */
export async function exportTransactionReceipt(transaction, profile) {
  const isIn = transaction.type === "in";
  const pdf  = await createReportPdf({
    title: "Transaction Receipt",
    businessName: profile.business_name || "My Business",
    period: transaction.transaction_date || "",
  });
  const { addStats, addSectionTitle, addTotalsBlock, fmtN } = pdf;

  addStats([
    {
      label: isIn ? "Cash In" : "Cash Out",
      value: fmtN(transaction.amount),
      color: isIn ? "#16a34a" : "#ef4444",
      bg:    isIn ? "#f0fdf4" : "#fef2f2",
    },
    { label:"Type",    value:isIn ? "Income" : "Expense", color:"#334155", bg:"#f8fafc" },
    { label:"Date",    value:transaction.transaction_date || "—", color:"#0284c7", bg:"#eff6ff" },
    { label:"Payment", value:transaction.payment_type || "—",     color:"#334155", bg:"#f8fafc" },
  ]);

  addSectionTitle("Transaction Details");
  addTotalsBlock([
    { label:"Item",     value:transaction.item_name || "—" },
    { label:"Category", value:transaction.category  || "—" },
    ...(transaction.quantity > 1 ? [{ label:"Quantity", value:String(transaction.quantity) }] : []),
    ...(transaction.customer_name ? [{ label:"Customer", value:transaction.customer_name }] : []),
    ...(transaction.note          ? [{ label:"Note",     value:transaction.note }]          : []),
    { sep: true },
    { label:"Total", value:fmtN(transaction.amount), bold:true, highlight:true },
  ]);

  await pdf.save(`receipt_${transaction.id || "txn"}.pdf`);
}

/* ── Credit Statement ─────────────────────────────────────────────── */
export async function exportCreditStatement(credit, profile) {
  const pdf = await createReportPdf({
    title: "Credit Statement",
    businessName: profile.business_name || "My Business",
    period: credit.due_date ? `Due ${credit.due_date}` : "",
  });
  const { addStats, addSectionTitle, addTotalsBlock, fmtN } = pdf;

  addStats([
    { label:"Total Owed",  value:fmtN(credit.total_amount), color:"#334155", bg:"#f8fafc" },
    { label:"Amount Paid", value:fmtN(credit.amount_paid),  color:"#16a34a", bg:"#f0fdf4" },
    { label:"Outstanding", value:fmtN(credit.outstanding),  color:"#ef4444", bg:"#fef2f2" },
    {
      label:"Status",
      value:(credit.status || "active").toUpperCase(),
      color:credit.status === "overdue" ? "#dc2626" : "#0284c7",
      bg:"#eff6ff",
    },
  ]);

  addSectionTitle("Account Details");
  addTotalsBlock([
    { label:"Customer",    value:credit.customer_name || "—" },
    { label:"Phone",       value:credit.phone || "—" },
    ...(credit.address ? [{ label:"Address", value:credit.address }] : []),
    { label:"Date Given",  value:credit.date_given || "—" },
    { label:"Due Date",    value:credit.due_date   || "—" },
    { sep: true },
    { label:"Total Owed",  value:fmtN(credit.total_amount) },
    { label:"Amount Paid", value:fmtN(credit.amount_paid), green:true },
    { sep: true },
    { label:"Outstanding", value:fmtN(credit.outstanding), bold:true, highlight:true },
    ...(credit.notes ? [{ label:"Notes", value:credit.notes }] : []),
  ]);

  await pdf.save(`credit_${(credit.customer_name || "statement").replace(/\s+/g, "_")}.pdf`);
}

/* ── Aso Savings Statement ────────────────────────────────────────── */
export async function exportAsoStatement(client, profile) {
  const pdf = await createReportPdf({
    title: "Ajo / Savings Statement",
    businessName: profile.business_name || "My Business",
    period: client.next_contribution_date ? `Next due ${client.next_contribution_date}` : "",
  });
  const { addStats, addSectionTitle, addTotalsBlock, fmtN } = pdf;

  addStats([
    { label:"Current Balance",  value:fmtN(client.current_balance),   color:"#7c3aed", bg:"#f5f3ff" },
    { label:"Total Deposited",   value:fmtN(client.total_saved),       color:"#16a34a", bg:"#f0fdf4" },
    { label:"Total Withdrawn",  value:fmtN(client.total_withdrawn),   color:"#334155", bg:"#f8fafc" },
    { label:"Contribution",     value:fmtN(client.contribution_amount),color:"#0284c7", bg:"#eff6ff" },
  ]);

  addSectionTitle("Account Details");
  addTotalsBlock([
    { label:"Client",          value:client.full_name || "—" },
    { label:"Phone",           value:client.phone || "—" },
    { label:"State / LGA",     value:`${client.state || ""} / ${client.lga || ""}` },
    { label:"Frequency",       value:client.contribution_frequency || "—" },
    { label:"Registered",      value:client.registration_date || "—" },
    { label:"Next Due",        value:client.next_contribution_date || "—" },
    { sep: true },
    { label:"Total Deposited",  value:fmtN(client.total_saved),     green:true },
    { label:"Total Withdrawn", value:fmtN(client.total_withdrawn), red:true },
    { sep: true },
    { label:"Current Balance", value:fmtN(client.current_balance), bold:true, highlight:true },
  ]);

  await pdf.save(`aso_${(client.full_name || "statement").replace(/\s+/g, "_")}.pdf`);
}
