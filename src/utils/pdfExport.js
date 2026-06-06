/**
 * KudiTrack AI — PDF Export helpers (jsPDF)
 * Install jsPDF: npm install jspdf
 */

/**
 * Export a single transaction as a receipt PDF.
 * @param {object} transaction
 * @param {object} profile  { business_name, owner_name, phone, address }
 */
export async function exportTransactionReceipt(transaction, profile) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a6" });

  const green = [22, 163, 74];
  const W = doc.internal.pageSize.getWidth();

  // Header bar
  doc.setFillColor(...green);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(profile.business_name || "KudiTrack AI", W / 2, 10, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Transaction Receipt", W / 2, 17, { align: "center" });

  // Body
  doc.setTextColor(50, 50, 50);
  const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const rows = [
    ["Item",         transaction.item_name],
    ["Type",         transaction.type === "in" ? "Cash In ✓" : "Cash Out"],
    ["Category",     transaction.category],
    ["Amount",       fmt(transaction.amount)],
    ["Qty",          transaction.quantity],
    ["Payment",      transaction.payment_type],
    ["Customer",     transaction.customer_name || "—"],
    ["Date",         transaction.transaction_date],
    ["Note",         transaction.note || "—"],
  ];

  let y = 30;
  rows.forEach(([label, value]) => {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(label, 10, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), 50, y);
    y += 7;
  });

  // Footer
  doc.setFillColor(240, 240, 240);
  doc.rect(0, y + 4, W, 12, "F");
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(`Printed by KudiTrack AI · ${new Date().toLocaleString()}`, W / 2, y + 11, { align: "center" });

  doc.save(`receipt_${transaction.id}.pdf`);
}

/**
 * Export a credit statement PDF for a customer.
 */
export async function exportCreditStatement(credit, profile) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

  doc.setFillColor(22, 163, 74);
  doc.rect(0, 0, W, 25, "F");
  doc.setTextColor(255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(profile.business_name || "KudiTrack AI", W / 2, 12, { align: "center" });
  doc.setFontSize(9);
  doc.text("Credit Statement", W / 2, 20, { align: "center" });

  doc.setTextColor(50);
  const rows = [
    ["Customer",    credit.customer_name],
    ["Phone",       credit.phone],
    ["Address",     credit.address],
    ["Total Owed",  fmt(credit.total_amount)],
    ["Amount Paid", fmt(credit.amount_paid)],
    ["Outstanding", fmt(credit.outstanding)],
    ["Date Given",  credit.date_given],
    ["Due Date",    credit.due_date],
    ["Status",      credit.status?.toUpperCase()],
  ];

  let y = 35;
  rows.forEach(([label, value]) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, 12, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "—"), 65, y);
    y += 8;
  });

  doc.save(`credit_${credit.customer_name?.replace(/\s+/g, "_")}.pdf`);
}

/**
 * Export an Aso savings statement PDF.
 */
export async function exportAsoStatement(client, profile) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

  doc.setFillColor(124, 58, 237);
  doc.rect(0, 0, W, 25, "F");
  doc.setTextColor(255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(profile.business_name || "KudiTrack AI", W / 2, 12, { align: "center" });
  doc.setFontSize(9);
  doc.text("Aso Savings Statement", W / 2, 20, { align: "center" });

  doc.setTextColor(50);
  const rows = [
    ["Client Name",   client.full_name],
    ["Phone",         client.phone],
    ["State / LGA",   `${client.state} / ${client.lga}`],
    ["Frequency",     client.contribution_frequency],
    ["Contribution",  fmt(client.contribution_amount)],
    ["Total Saved",   fmt(client.total_saved)],
    ["Total Withdrawn", fmt(client.total_withdrawn)],
    ["Current Balance", fmt(client.current_balance)],
    ["Reg. Date",     client.registration_date],
  ];

  let y = 35;
  rows.forEach(([label, value]) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, 12, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "—"), 70, y);
    y += 8;
  });

  doc.save(`aso_${client.full_name?.replace(/\s+/g, "_")}.pdf`);
}
