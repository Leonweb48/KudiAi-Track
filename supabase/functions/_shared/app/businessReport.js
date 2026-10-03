// SHARED WITH THE SERVER — copied byte-for-byte to supabase/functions/_shared/app/ by `node scripts/sync-shared.mjs`
// (the monthly owner/client report emails build their PDFs there). Edit it here, then run the script;
// src/__tests__/sharedModules.test.js fails while the copies differ. No imports outside src/shared.

// The General Business Report — its PDF section, the figures saved with its verify reference, the business letterhead,
// and (businessReportSource) the data it is built from, read with any Supabase client: the owner's own in the app, the
// service role on the server for the monthly business report email.

import { fmtCurrency } from "./reportPdfCore.js";
import { addDays } from "./reportData.js";

/** The business's own letterhead for owner report PDFs: logo / address / contacts from the invoice settings when set,
 *  else the profile (the same source invoices use). */
export function letterheadFrom(profile, inv, generatedAt = new Date()) {
  const area = [profile?.business_lga || profile?.lga, profile?.business_state || profile?.state].filter(Boolean).join(", ");
  const street = profile?.business_address || profile?.address || "";
  return {
    businessName: profile?.business_name || "My Business",
    logoUrl: inv?.logo_url || profile?.store_image_url || "",
    address: inv?.address || [street, area && !street.includes(area) ? area : ""].filter(Boolean).join(", "),
    phone: inv?.contact_phone || profile?.business_phone || profile?.phone || "",
    email: inv?.contact_email || profile?.business_email || profile?.email || "",
    generatedAt,
  };
}

/** The headline figures saved with the report's reference — the verify page shows them. Strings exactly as printed. */
export function businessReportSummary(data) {
  const N = fmtCurrency;
  return [
    { label: "Revenue", value: N(data.profit.revenue) }, { label: "Gross profit", value: N(data.profit.gross) },
    { label: "Expenses", value: N(data.profit.expenses) }, { label: "Net profit", value: N(data.profit.net) },
    { label: "Money in", value: N(data.money.in) }, { label: "Money out", value: N(data.money.out) },
    { label: "Credit outstanding", value: N(data.credit.outstanding) }, { label: "Ajo savings held", value: N(data.ajo.held) },
  ];
}

/** Draw the General Business Report onto a createReportPdf / createReportPdfCore document. */
export function drawBusinessReport(pdf, data) {
  const { addStats, addSectionTitle, addTable, addTotalsBlock, fmtN, fmtD } = pdf;
  const { profit: pf, money, salesSummary: ss, credit, ajo, bills, stock } = data;
  const tone = (v) => (v >= 0 ? "#16a34a" : "#ef4444");
  addStats([
    { label:"Revenue",      value:fmtN(pf.revenue),  color:"#0284c7", bg:"#eff6ff" },
    { label:"Gross Profit", value:fmtN(pf.gross),    color:tone(pf.gross), bg:"#f0fdf4" },
    { label:"Expenses",     value:fmtN(pf.expenses), color:"#ef4444", bg:"#fef2f2" },
    { label:"Net Profit",   value:fmtN(pf.net),      color:tone(pf.net), bg:pf.net>=0?"#f0fdf4":"#fef2f2" },
  ]);
  addSectionTitle("Where the profit came from", 40);
  addTotalsBlock([
    { label:"Profit on goods sold",           value:fmtN(pf.goods) },
    { label:"Ajo fees & commission",          value:fmtN(pf.ajo) },
    { label:"Interest collected on credit",   value:fmtN(pf.interest) },
    { label:"Bills: PIN discount + cashback", value:fmtN(pf.bills) },
    { sep:true },
    { label:"Gross profit",                   value:fmtN(pf.gross), bold:true },
    { label:"Less: expenses",                 value:`- ${fmtN(pf.expenses)}`, red:true },
    { sep:true },
    { label:"Net profit",                     value:fmtN(pf.net), bold:true, highlight:true },
  ]);
  addTable([{ key:"n", label:"How profit is counted", w:1 }], [
    { n:"Goods sold = sales, credit sales and invoices, each at the cost price saved when it was sold. Interest counts when customers pay it." },
    { n:"Expenses are running costs; stock purchases and bill payments are not expenses. Ajo savings are clients' money, not profit." },
    { n:`Same as the Finance screen for these dates (${fmtN(pf.financeNet)})${pf.bills ? `, plus ${fmtN(pf.bills)} earned on bills` : ""}.` },
    ...(pf.unmeasured > 0 ? [{ n:`${fmtN(pf.unmeasured)} of sales have no cost price, so their profit isn't counted. Add cost prices in Stock.` }] : []),
  ], { rowHeight: 6.5 });

  addSectionTitle("Money in & out", 22);
  addStats([
    { label:"Money In",       value:fmtN(money.in),    color:"#16a34a", bg:"#f0fdf4" },
    { label:"Money Out",      value:fmtN(money.out),   color:"#ef4444", bg:"#fef2f2" },
    { label:"Net Cash",       value:fmtN(money.net),   color:tone(money.net), bg:"#f8fafc" },
    { label:"Spent on Stock", value:fmtN(money.stock), color:"#64748b", bg:"#f8fafc" },
  ]);
  addTable(
    [{ key:"k", label:"Money in", bold:true, w:0.30 }, { key:"v", label:"Amount", right:true, w:0.20 },
     { key:"k2", label:"Money out", bold:true, w:0.30 }, { key:"v2", label:"Amount", right:true, w:0.20 }],
    [
      { k:"Cash sales",        v:fmtN(money.sales),       k2:"Stock purchases", v2:fmtN(money.stock) },
      { k:"Credit sales",      v:fmtN(money.creditSales), k2:"Expenses",        v2:fmtN(money.expenses) },
      { k:"Credit repayments", v:fmtN(money.repayments),  k2:"",                v2:"" },
      { k:"Invoice payments",  v:fmtN(money.invoices),    k2:"",                v2:"" },
      { k:"Ajo fees",          v:fmtN(money.ajoFees),     k2:"",                v2:"" },
    ],
    { rowHeight: 6.5 }
  );

  addSectionTitle("Sales", 22);
  addStats([
    { label:"Sales",        value:String(ss.count), color:"#0284c7", bg:"#eff6ff" },
    { label:"Total Sales",  value:fmtN(ss.total),   color:"#0284c7", bg:"#eff6ff" },
    { label:"Average Sale", value:fmtN(ss.average), color:"#334155", bg:"#f8fafc" },
    { label:"Items Sold",   value:String(ss.qty),   color:"#334155", bg:"#f8fafc" },
  ]);
  if (data.topItems.length) {
    addTable(
      [{ key:"item", label:"Most profitable items", bold:true, w:0.40 },
       { key:"sold", label:"Sold", right:true, w:0.10 },
       { key:"revenue", label:"Revenue", right:true, w:0.20 },
       { key:"profit", label:"Profit", right:true, bold:true, color:r=>r._p>=0?[22,163,74]:[220,38,38], w:0.18 },
       { key:"margin", label:"Margin", right:true, w:0.12 }],
      data.topItems.map(r=>({ item:r.item, sold:r.qtySold, revenue:fmtN(r.revenue), profit:fmtN(r.profit), _p:r.profit,
                              margin:r.margin==null?"—":`${Math.round(r.margin*100)}%` }))
    );
  }

  addSectionTitle("Credit", 22);
  addStats([
    { label:"Credit Sales (period)", value:fmtN(money.creditSales), color:"#d97706", bg:"#fffbeb" },
    { label:"Repayments (period)",   value:fmtN(money.repayments),  color:"#16a34a", bg:"#f0fdf4" },
    { label:"Outstanding Now",       value:fmtN(credit.outstanding), color:"#ef4444", bg:"#fef2f2" },
    { label:`Overdue (${credit.overdueCount})`, value:fmtN(credit.overdueDue), color:"#dc2626", bg:"#fff1f2" },
  ]);
  if (data.overdue.length) {
    addTable(
      [{ key:"name", label:"Overdue customer", bold:true, w:0.42 },
       { key:"owed", label:"Owed", right:true, bold:true, color:()=>[220,38,38], w:0.22 },
       { key:"due",  label:"Due date", w:0.20 },
       { key:"late", label:"Days late", right:true, w:0.16 }],
      data.overdue.slice(0, 10).map(o=>({ name:o.name, owed:fmtN(o.owed), due:fmtD(o.due), late:o.late==null?"—":o.late }))
    );
  }

  addSectionTitle("Ajo savings", 22);
  addStats([
    { label:"Savings Held (clients')", value:fmtN(ajo.held),        color:"#2E8020", bg:"#f0fdf4" },
    { label:"Collections (period)",    value:fmtN(ajo.collections), color:"#16a34a", bg:"#f0fdf4" },
    { label:"Withdrawals (period)",    value:fmtN(ajo.withdrawals), color:"#ef4444", bg:"#fef2f2" },
    { label:`Clients (${ajo.activeClients} active)`, value:String(ajo.clients), color:"#334155", bg:"#f8fafc" },
  ]);

  addSectionTitle("Bills", 22);
  addStats([
    { label:"Bills Paid",        value:fmtN(bills.total),         color:"#ea580c", bg:"#fff7ed" },
    { label:"Number Paid",       value:String(bills.count),       color:"#334155", bg:"#f8fafc" },
    { label:"Bill Profit",       value:fmtN(bills.profit),        color:"#16a34a", bg:"#f0fdf4" },
    { label:"Failed (refunded)", value:String(bills.failedCount), color:"#94a3b8", bg:"#f8fafc" },
  ]);

  addSectionTitle("Stock", 22);
  addStats([
    { label:"Spent on Stock (period)", value:fmtN(stock.spent),      color:"#ef4444", bg:"#fef2f2" },
    { label:"Cost of Goods Sold",      value:fmtN(stock.cogs),       color:"#64748b", bg:"#f8fafc" },
    { label:"Stock on Hand (cost)",    value:fmtN(data.stockOnHand), color:"#0284c7", bg:"#eff6ff" },
    { label:"Low-stock Items",         value:String(data.lowStock),  color:data.lowStock?"#d97706":"#334155", bg:"#fffbeb" },
  ]);

  if (data.staff.length) {
    addSectionTitle("Staff sales", 22);
    addTable(
      [{ key:"name", label:"Staff", bold:true, w:0.50 },
       { key:"count", label:"Sales", right:true, w:0.20 },
       { key:"amount", label:"Amount", right:true, bold:true, w:0.30 }],
      data.staff.map(r=>({ name:r.name, count:r.count, amount:fmtN(r.amount) }))
    );
  }
}

// ── Reading the data (any Supabase client) ────────────────────────────────────
async function pages(make) {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const { data, error } = await make().range(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message || String(error));
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Everything buildGeneralData needs for an owner's whole business over [from, to] (YYYY-MM-DD, inclusive) — the same
 * rows the app's store and Reports screen use (transactions, credits, debt payments, portal Ajo clients and their
 * contributions, products, invoices, staff names).
 */
export async function businessReportSource(sb, ownerId, { from, to }) {
  const [transactions, credits, debtPayments, asoClients, products, invoices, staff] = await Promise.all([
    pages(() => sb.from("transactions").select("*").eq("user_id", ownerId).gte("transaction_date", from).lte("transaction_date", to).order("created_at", { ascending: false })),
    pages(() => sb.from("credits").select("*").eq("user_id", ownerId).order("created_at", { ascending: false })),
    pages(() => sb.from("debt_payments").select("*").eq("owner_id", ownerId).order("created_at", { ascending: true })),
    pages(() => sb.from("aso_clients").select("*").eq("user_id", ownerId).eq("portal_active", true).order("created_at", { ascending: false })),
    pages(() => sb.from("products").select("id, product_name, cost_price, needs_costing, quantity, low_stock_threshold").eq("user_id", ownerId).order("product_name")),
    pages(() => sb.from("invoices").select("*, invoice_items(*), invoice_payments(*)").eq("user_id", ownerId).order("created_at", { ascending: false })),
    pages(() => sb.from("staff").select("id, full_name").eq("owner_id", ownerId).order("full_name")),
  ]);
  // contributions a day either side of the period: the builders decide (in WAT) what falls inside it
  const lo = addDays(from, -1), hi = addDays(to, 2);
  const ids = asoClients.map((c) => c.id);
  const contributions = [];
  for (let i = 0; i < ids.length; i += 200) {
    contributions.push(...await pages(() => sb.from("ajo_contributions")
      .select("id, aso_client_id, type, amount, status, payment_method, created_at")
      .in("aso_client_id", ids.slice(i, i + 200)).gte("created_at", `${lo}T00:00:00Z`).lt("created_at", `${hi}T00:00:00Z`)
      .order("created_at", { ascending: true })));
  }
  const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.full_name]));
  return { transactions, credits, asoClients, contributions, products, debtPayments, invoices, staffMap };
}
