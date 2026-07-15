import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const BOM = "﻿";

function toISO(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toISOString().slice(0, 10);
}

function csvRow(cells) {
  return cells.map(c => {
    const s = c == null ? "" : String(c);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

// ── Transactions ─────────────────────────────────────────────────────────────

export function buildTransactionsCSV(filtered) {
  const header = csvRow(["date", "date_display", "type", "description", "category", "amount_ngn", "direction", "payment_method", "reference"]);
  const rows = (filtered || []).map(t =>
    csvRow([
      toISO(t.date || t.created_at),
      t.date_display || t.date || "",
      t.type || "",
      t.description || t.note || "",
      t.category || "",
      t.amount != null ? Number(t.amount) : "",
      t.direction || (t.type === "in" ? "in" : "out"),
      t.payment_method || t.paymentMethod || "",
      t.reference || t.id || "",
    ])
  );
  return BOM + [header, ...rows].join("\r\n");
}

export function transactionsCSVFilename(filter, from, to) {
  const tag = filter && filter !== "all" ? `_${filter}` : "";
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `transactions${tag}${f}${t}.csv`;
}

// ── Credit payments ───────────────────────────────────────────────────────────

export function buildCreditPaymentsCSV(payments, credit) {
  const header = csvRow(["date", "date_display", "debtor_name", "payment_method", "amount_paid_ngn", "outstanding_ngn", "notes"]);
  const name = credit?.customer_name || credit?.name || "";
  let running = Number(credit?.amount || 0);
  const rows = (payments || []).map(p => {
    const paid = Number(p.amount || 0);
    running -= paid;
    return csvRow([
      toISO(p.paid_at || p.created_at),
      p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "",
      name,
      p.payment_method || "",
      paid,
      Math.max(0, running),
      p.notes || p.note || "",
    ]);
  });
  return BOM + [header, ...rows].join("\r\n");
}

export function creditCSVFilename(customerName) {
  const slug = (customerName || "customer").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return `credit_payments_${slug}.csv`;
}

// ── Ajo statement ─────────────────────────────────────────────────────────────

export function buildAjoStatementCSV(contributions, client) {
  const header = csvRow(["date", "date_display", "client_name", "transaction_type", "debit_ngn", "credit_ngn", "balance_ngn", "payment_method", "notes"]);
  const name = client?.name || client?.client_name || "";
  let balance = 0;
  const rows = (contributions || []).map(c => {
    const amt = Number(c.amount || 0);
    const isDebit = (c.type || "").toLowerCase().includes("withdraw");
    if (isDebit) balance -= amt; else balance += amt;
    return csvRow([
      toISO(c.date || c.created_at),
      c.date ? new Date(c.date).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "",
      name,
      c.type || "Contribution",
      isDebit ? amt : "",
      isDebit ? "" : amt,
      balance,
      c.payment_method || "",
      c.notes || c.note || "",
    ]);
  });
  return BOM + [header, ...rows].join("\r\n");
}

export function ajoCSVFilename(clientName) {
  const slug = (clientName || "client").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return `ajo_statement_${slug}.csv`;
}

// ── Sales-by-staff report ─────────────────────────────────────────────────────

export function buildStaffReportCSV(staffRows, from, to) {
  const header = csvRow(["staff_name", "transactions", "sales_in_ngn", "sales_out_ngn", "net_ngn", "credits_added", "ajo_contributions"]);
  const rows = (staffRows || []).map(r =>
    csvRow([
      r.name || r.staff_name || "",
      r.transactions ?? r.count ?? "",
      r.sales_in    != null ? Number(r.sales_in)    : "",
      r.sales_out   != null ? Number(r.sales_out)   : "",
      r.net         != null ? Number(r.net)          : "",
      r.credits     != null ? Number(r.credits)      : "",
      r.ajo         != null ? Number(r.ajo)          : "",
    ])
  );
  return BOM + [header, ...rows].join("\r\n");
}

export function staffReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `sales_by_staff${f}${t}.csv`;
}

// ── Share / download ──────────────────────────────────────────────────────────

export async function shareCSV(csvString, filename) {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const base64 = btoa(unescape(encodeURIComponent(csvString)));
      const file = await Filesystem.writeFile({
        path:      filename,
        data:      base64,
        directory: Directory.Cache,
      });
      await Share.share({ title: filename, url: file.uri, dialogTitle: "Export CSV" });
      return;
    }
  } catch (_) {}

  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
