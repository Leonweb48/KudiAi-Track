import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { formatWAT } from "./wat";

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

// ── Payment-type formatter (mirrors Reports.jsx fmtPayType) ──────────────────
function fmtPayType(pt) {
  if (!pt) return "";
  return pt.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Client savings statement (client_savings_statement result) ───────────────
export function buildSavingsStatementCSV(statement) {
  const entries = statement?.entries || [];
  const header = csvRow(["date_time_wat", "description", "reference", "money_in_ngn", "money_out_ngn", "balance_ngn"]);
  const wat = (iso) => new Date(new Date(iso).getTime() + 3600000).toISOString().slice(0, 19).replace("T", " ");
  const rows = [
    csvRow(["", "Opening balance", "", "", "", Number(statement?.opening || 0)]),
    ...entries.map(e => csvRow([
      wat(e.at), e.label || "", e.ref || "",
      e.credit ? Number(e.amount) : "", e.credit ? "" : Number(e.amount), Number(e.balance),
    ])),
    csvRow(["", "Closing balance", "", Number(statement?.total_in || 0), Number(statement?.total_out || 0), Number(statement?.closing || 0)]),
  ];
  return BOM + [header, ...rows].join("\r\n");
}
export function savingsStatementCSVFilename(from, to) {
  const d = (v) => String(v || "").slice(0, 10);
  return `savings_statement_${d(from)}_to_${d(to)}.csv`;
}

// ── General business report ──────────────────────────────────────────────────
export function buildGeneralReportCSV(data) {
  const { profit: pf, money, salesSummary: ss, credit, ajo, bills, stock } = data;
  const n = (v) => (v != null ? Number(v) : "");
  const rows = [
    ["Profit", "Profit on goods sold (₦)", n(pf.goods)],
    ["Profit", "Ajo fees & commission (₦)", n(pf.ajo)],
    ["Profit", "Interest collected on credit (₦)", n(pf.interest)],
    ["Profit", "Bills: PIN discount + cashback (₦)", n(pf.bills)],
    ["Profit", "Gross profit (₦)", n(pf.gross)],
    ["Profit", "Expenses (₦)", n(pf.expenses)],
    ["Profit", "Net profit (₦)", n(pf.net)],
    ["Profit", "Revenue (₦)", n(pf.revenue)],
    ["Profit", "Sales with no cost price (₦)", n(pf.unmeasured)],
    ["Money", "Money in (₦)", n(money.in)],
    ["Money", "Money out (₦)", n(money.out)],
    ["Money", "Net cash (₦)", n(money.net)],
    ["Money", "Cash sales (₦)", n(money.sales)],
    ["Money", "Credit sales (₦)", n(money.creditSales)],
    ["Money", "Credit repayments (₦)", n(money.repayments)],
    ["Money", "Invoice payments (₦)", n(money.invoices)],
    ["Money", "Spent on stock (₦)", n(money.stock)],
    ["Sales", "Number of sales", ss.count],
    ["Sales", "Total sales (₦)", n(ss.total)],
    ["Sales", "Average sale (₦)", n(Math.round(ss.average * 100) / 100)],
    ["Sales", "Items sold", ss.qty],
    ["Credit", "Outstanding now (₦)", n(credit.outstanding)],
    ["Credit", "Overdue now (₦)", n(credit.overdueDue)],
    ["Credit", "Overdue accounts", credit.overdueCount],
    ["Ajo", "Savings held (₦)", n(ajo.held)],
    ["Ajo", "Collections (₦)", n(ajo.collections)],
    ["Ajo", "Withdrawals (₦)", n(ajo.withdrawals)],
    ["Ajo", "Clients", ajo.clients],
    ["Bills", "Bills paid (₦)", n(bills.total)],
    ["Bills", "Number paid", bills.count],
    ["Bills", "Bill profit (₦)", n(bills.profit)],
    ["Bills", "Failed (refunded)", bills.failedCount],
    ["Stock", "Spent on stock (₦)", n(stock.spent)],
    ["Stock", "Cost of goods sold (₦)", n(stock.cogs)],
    ["Stock", "Stock on hand at cost (₦)", n(data.stockOnHand)],
    ["Stock", "Low-stock items", data.lowStock],
    ...data.staff.map(r => ["Staff", `${r.name} — sales (₦)`, n(r.amount)]),
  ];
  return BOM + [csvRow(["section", "item", "value"]), ...rows.map(csvRow)].join("\r\n");
}
export function generalReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `business_report${f}${t}.csv`;
}

// ── Sales report ──────────────────────────────────────────────────────────────
export function buildSalesReportCSV(data, from, to) {
  const { tx = [], cashIn, cashOut, profit, sales = [], salesTotals } = data;
  // profit per sale (cost price saved at the sale) — blank for expenses and for sales with no cost price
  const saleById = new Map(sales.map(r => [r.t.id, r]));
  const summaryHeader = csvRow(["Summary", "Value"]);
  const summaryRows = [
    csvRow(["Total Cash In (₦)", cashIn != null ? Number(cashIn) : ""]),
    csvRow(["Total Cash Out (₦)", cashOut != null ? Number(cashOut) : ""]),
    csvRow(["Net Cash (₦)", profit != null ? Number(profit) : ""]),
    ...(salesTotals ? [
      csvRow(["Total Sales (₦)", Number(salesTotals.revenue)]),
      csvRow(["Profit on Sales (₦)", Number(salesTotals.profit)]),
    ] : []),
    csvRow(["Transaction Count", tx.length]),
    csvRow([]),
  ];
  const txHeader = csvRow(["date", "item", "category", "type", "amount_ngn", "cost_ngn", "profit_ngn", "payment_method", "note"]);
  const txRows = tx.map(t => {
    const r = saleById.get(t.id);
    return csvRow([
      toISO(t.transaction_date),
      t.item_name || "",
      t.category || "",
      t.type === "in" ? "Income" : "Expense",
      t.amount != null ? Number(t.amount) : "",
      r && r.profit != null ? Number(r.cost) : "",
      r && r.profit != null ? Number(r.profit) : "",
      fmtPayType(t.payment_type),
      t.note || "",
    ]);
  });
  return BOM + [summaryHeader, ...summaryRows, txHeader, ...txRows].join("\r\n");
}
export function salesReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `sales_report${f}${t}.csv`;
}

// ── Credit report ─────────────────────────────────────────────────────────────
export function buildCreditReportCSV(data) {
  const { credits = [], profits } = data;
  const header = csvRow(["customer", "phone", "total_amount_ngn", "cost_of_goods_ngn", "interest_ngn", "profit_ngn", "amount_paid_ngn", "outstanding_ngn", "due_date", "status"]);
  const rows = (profits || credits.map(c => ({ c }))).map(({ c, cost, interest, profit }) => csvRow([
    c.customer_name || "",
    c.phone || "",
    c.total_amount  != null ? Number(c.total_amount)  : "",
    cost     != null ? Number(cost)     : "",
    interest != null ? Number(interest) : "",
    profit   != null ? Number(profit)   : "",
    c.amount_paid   != null ? Number(c.amount_paid)   : "",
    c.outstanding   != null ? Number(c.outstanding)   : "",
    toISO(c.due_date),
    (c.status || "active").replace(/_/g, " ").toUpperCase(),
  ]));
  return BOM + [header, ...rows].join("\r\n");
}
export function creditReportCSVFilename() { return "credit_report.csv"; }

// ── Bills report ──────────────────────────────────────────────────────────────
export function buildBillsReportCSV(data, from, to) {
  const { bills = [] } = data;
  const header = csvRow(["date", "item", "category", "status", "amount_ngn", "face_value_ngn", "discount_ngn", "cashback_ngn", "profit_ngn", "payment_method", "note"]);
  // each bill: { t: the transaction, failed, face, discount, cashback, profit } (Reports.billProfit)
  const rows = bills.map(b => { const t = b.t || b; return csvRow([
    toISO(t.transaction_date),
    t.item_name || "",
    t.category || "Bills",
    b.failed ? "Failed (refunded)" : "Paid",
    t.amount != null ? Number(t.amount) : "",
    b.face != null ? Number(b.face) : "",
    b.failed ? "" : Number(b.discount || 0),
    b.failed ? "" : Number(b.cashback || 0),
    b.failed ? "" : Number(b.profit || 0),
    fmtPayType(t.payment_type),
    t.note || "",
  ]); });
  return BOM + [header, ...rows].join("\r\n");
}
export function billsReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `bills_report${f}${t}.csv`;
}

// ── Stock report ──────────────────────────────────────────────────────────────
export function buildStockReportCSV(data, from, to) {
  const { rows = [] } = data;
  const header = csvRow(["item", "qty_sold", "revenue_ngn", "cost_of_goods_ngn", "profit_ngn", "margin_pct", "qty_bought", "restock_cost_ngn"]);
  const dataRows = rows.map(r => csvRow([
    r.item || "",
    r.qtySold   != null ? r.qtySold   : "",
    r.revenue   != null ? Number(r.revenue)   : "",
    r.profit    != null ? Number(r.cogs)      : "",
    r.profit    != null ? Number(r.profit)    : "",
    r.margin    != null ? Math.round(r.margin * 1000) / 10 : "",
    r.qtyBought != null ? r.qtyBought : "",
    r.cost      != null ? Number(r.cost)      : "",
  ]));
  return BOM + [header, ...dataRows].join("\r\n");
}
export function stockReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `stock_report${f}${t}.csv`;
}

// ── Aso report ────────────────────────────────────────────────────────────────
export function buildAsoReportCSV(data, from, to) {
  const { active = [] } = data;
  const header = csvRow(["client", "period_contributions_ngn", "period_manual_dep_ngn", "period_withdrawals_ngn", "period_fees_ngn", "period_commission_ngn", "period_profit_ngn", "period_net_ngn", "balance_ngn"]);
  const rows = active.map(c => csvRow([
    c.full_name || "",
    c.p_contribs    != null ? Number(c.p_contribs)    : "",
    c.p_manual      != null ? Number(c.p_manual)      : "",
    c.p_withdrawals != null ? Number(c.p_withdrawals) : "",
    c.p_fees        != null ? Number(c.p_fees)        : "",
    c.p_commission  != null ? Number(c.p_commission)  : "",
    c.p_profit      != null ? Number(c.p_profit)      : "",
    c.p_net         != null ? Number(c.p_net)         : "",
    c.current_balance != null ? Number(c.current_balance) : "",
  ]));
  return BOM + [header, ...rows].join("\r\n");
}
export function asoReportCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `aso_report${f}${t}.csv`;
}

// ── Wallet statement ───────────────────────────────────────────────────────────
// wallet_ledger has its own shape (direction/source/amount_kobo/balance_after_kobo)
// distinct from the general `transactions` table the builders above key off —
// a dedicated builder rather than force-fitting buildTransactionsCSV.

export function buildWalletStatementCSV(rows) {
  const header = csvRow(["date", "date_display", "type", "description", "amount_ngn", "direction", "status", "balance_after_ngn", "reference"]);
  const csvRows = (rows || []).map(r =>
    csvRow([
      toISO(r.created_at),
      r.created_at ? formatWAT(r.created_at) : "",
      (r.source || "").replace(/_/g, " "),
      r.narration || "",
      r.amount_kobo != null ? Number(r.amount_kobo) / 100 : "",
      r.direction || "",
      r.status || "",
      r.balance_after_kobo != null ? Number(r.balance_after_kobo) / 100 : "",
      r.receipt_ref || r.id || "",
    ])
  );
  return BOM + [header, ...csvRows].join("\r\n");
}

export function walletStatementCSVFilename(from, to) {
  const f = from ? `_${toISO(from)}` : "";
  const t = to   ? `_${toISO(to)}`   : "";
  return `wallet_statement${f}${t}.csv`;
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
