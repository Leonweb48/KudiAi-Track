// SHARED WITH THE SERVER — copied byte-for-byte to supabase/functions/_shared/app/ by `node scripts/sync-shared.mjs`
// (the monthly owner/client report emails build their PDFs there). Edit it here, then run the script;
// src/__tests__/sharedModules.test.js fails while the copies differ. No imports outside src/shared.

// The report numbers — sales, credit, Ajo, bills, staff, stock and the General Business Report — for any period.
// The Reports screen and the monthly business report email (server) both use these, so a report shows the same
// figures wherever it is made. Pure functions of the data passed in.

import { compute, isBillPayment, isRevenueSale, saleCost, saleLines, productMaps } from "./profitEngine.js";
import { cashbackEligible } from "./billCalc.js";

/* ── date helpers (YYYY-MM-DD strings) ─────────────────────────────── */
export function addDays(d, n) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}
export function inRange(d, from, to) { return d >= from && d <= to; }

/* ── Report data builders ──────────────────────────────────────────── */
// What a sale was for, for the sales table: the item, or the cart's items ("Rice ×2, Oil").
function saleItemLabel(t) {
  if (Array.isArray(t.line_items) && t.line_items.length) {
    return t.line_items.map(li => `${li.name || "Item"}${(li.qty || 1) > 1 ? ` ×${li.qty}` : ""}`).join(", ");
  }
  return t.item_name || "—";
}
function saleQty(t) {
  if (Array.isArray(t.line_items) && t.line_items.length) return t.line_items.reduce((n, li) => n + (Number(li.qty) || 1), 0);
  return Number(t.quantity) || 1;
}

/**
 * Profit per sale for the sales report — profitEngine's saleCost(), so these add up to the same gross profit the rest of
 * the app shows. The cost price saved at the time of the sale always wins; a product's current cost is only used for old
 * sales recorded before costs were saved. A sale with no cost price has profit = null ("no cost price"), and its amount
 * is counted in totals.uncosted instead of being guessed.
 */
export function buildSalesProfit(tx, products = []) {
  const maps = productMaps(products);
  const rows = tx.filter(isRevenueSale).map(t => {
    const c = saleCost(t, maps);
    const profit = c.service ? c.measured : (c.costed ? c.measured - c.cogs : null);
    return {
      t, amount: t.amount, qty: saleQty(t), item: saleItemLabel(t),
      cost: c.service ? 0 : (c.costed ? c.cogs : null),
      profit, partial: c.costed && c.hasUnmeasured, uncosted: c.unmeasured || 0,
    };
  });
  const totals = rows.reduce((a, r) => ({
    count: a.count + 1, revenue: a.revenue + r.amount, cost: a.cost + (r.cost || 0),
    profit: a.profit + (r.profit || 0), uncosted: a.uncosted + r.uncosted,
  }), { count: 0, revenue: 0, cost: 0, profit: 0, uncosted: 0 });
  return { rows, totals };
}

export function buildSalesData(transactions, from, to, products = []) {
  const tx = transactions.filter(t => inRange(t.transaction_date, from, to));
  const cashIn  = tx.filter(t=>t.type==="in").reduce((s,t)=>s+t.amount,0);
  const cashOut = tx.filter(t=>t.type==="out" && !isBillPayment(t)).reduce((s,t)=>s+t.amount,0);

  // Daily bars
  const datesInRange = [];
  let cur = from;
  while (cur <= to) { datesInRange.push(cur); cur = addDays(cur,1); if(datesInRange.length>60) break; }

  const byDate = {};
  tx.forEach(t => {
    if (!byDate[t.transaction_date]) byDate[t.transaction_date] = {v1:0,v2:0};
    if (t.type==="in") byDate[t.transaction_date].v1 += t.amount;
    else if (!isBillPayment(t)) byDate[t.transaction_date].v2 += t.amount;
  });

  const bars = datesInRange.length <= 14
    ? datesInRange.map(d => ({
        label: new Date(d+"T00:00:00").toLocaleDateString("en-NG",{day:"numeric",month:"short"}),
        v1: byDate[d]?.v1||0, v2: byDate[d]?.v2||0
      }))
    : (() => {
        // group by week
        const weeks = {};
        datesInRange.forEach(d => {
          const dt = new Date(d+"T00:00:00");
          const wk = `W${Math.ceil(dt.getDate()/7)}`;
          const mon = dt.toLocaleDateString("en-NG",{month:"short"});
          const key = `${mon} ${wk}`;
          if (!weeks[key]) weeks[key] = {v1:0,v2:0};
          weeks[key].v1 += byDate[d]?.v1||0;
          weeks[key].v2 += byDate[d]?.v2||0;
        });
        return Object.entries(weeks).map(([label,v])=>({label,...v}));
      })();

  // Category breakdown
  const byCat = {};
  tx.forEach(t => {
    const k = t.category || "Other";
    if (!byCat[k]) byCat[k] = {in:0,out:0,count:0};
    byCat[k][t.type] += t.amount; byCat[k].count++;
  });

  const { rows: sales, totals: salesTotals } = buildSalesProfit(tx, products);
  return { tx, cashIn, cashOut, profit: cashIn-cashOut, bars, byCat, sales, salesTotals };
}

/**
 * Profit on ONE credit account: the goods sold on credit (each item's cost price was saved with the credit when it was
 * given — the same "cost at the time of the sale" rule as sales) plus the agreed interest. It is earned as the customer
 * repays. Part of a credit with no item cost (no items recorded, items without a cost price, or extra credit added later)
 * is "uncosted": its profit isn't guessed, only flagged.
 */
export function creditProfit(c) {
  const items = Array.isArray(c?.items) ? c.items : [];
  let costedRevenue = 0, cost = 0;
  for (const it of items) {
    const qty = Number(it?.quantity) || 1, price = Number(it?.unit_price) || 0, unitCost = Number(it?.cost_price) || 0;
    if (unitCost > 0) { costedRevenue += price * qty; cost += unitCost * qty; }
  }
  const principal = Number(c?.total_amount) || 0;
  const interest  = Number(c?.interest_amount) || 0;
  const goodsProfit = costedRevenue > 0 ? costedRevenue - cost : null;
  const uncosted = Math.max(0, principal - costedRevenue);
  const profit = goodsProfit == null && interest === 0 ? null : (goodsProfit || 0) + interest;
  return { cost: costedRevenue > 0 ? cost : null, goodsProfit, interest, profit, uncosted, partial: profit != null && uncosted > 0.004 };
}

export function buildCreditData(credits) {
  const totalDebt = credits.reduce((s,c)=>s+(c.total_amount||0),0);
  const totalPaid = credits.reduce((s,c)=>s+(c.amount_paid||0),0);
  const totalOut  = credits.reduce((s,c)=>s+(c.outstanding||0),0);
  const overdue   = credits.filter(c=>c.status==="overdue");
  const profits   = credits.map(c => ({ c, ...creditProfit(c) }));
  const profitTotals = profits.reduce((a, p) => ({
    cost: a.cost + (p.cost || 0), interest: a.interest + p.interest,
    goods: a.goods + (p.goodsProfit || 0), profit: a.profit + (p.profit || 0), uncosted: a.uncosted + p.uncosted,
  }), { cost: 0, interest: 0, goods: 0, profit: 0, uncosted: 0 });
  return { credits, totalDebt, totalPaid, totalOut, overdueCount: overdue.length, overdueDue: overdue.reduce((s,c)=>s+c.outstanding,0),
           profits, profitTotals };
}

export function buildAsoLedger(asoClients, contributions, from, to) {
  const totalBal    = asoClients.reduce((s,c)=>s+(c.current_balance||0),0);
  const totalSaved  = asoClients.reduce((s,c)=>s+(c.total_saved||0),0);
  const totalWithdr = asoClients.reduce((s,c)=>s+(c.total_withdrawn||0),0);

  const inPeriod = contributions.filter(c => {
    const d = (c.created_at||"").slice(0,10);
    return d >= from && d <= to;
  });

  const byClient = {};
  inPeriod.forEach(c => {
    const cid = c.aso_client_id;
    if (!byClient[cid]) byClient[cid] = { contribs:0, manual:0, withdrawals:0, regFees:0, wdFees:0 };
    const amt = parseFloat(c.amount) || 0;
    // fees and commission are only earned once taken (a pending or rejected fee isn't profit yet)
    const taken = !c.status || c.status === "completed";
    if (c.type === "contribution") {
      if (c.payment_method === "manual_transfer") byClient[cid].manual += amt;
      else byClient[cid].contribs += amt;
    } else if (c.type === "withdrawal")       { byClient[cid].withdrawals += amt; }
    else if (c.type === "registration_fee")   { if (taken) byClient[cid].regFees += amt; }
    else if (c.type === "withdrawal_fee")     { if (taken) byClient[cid].wdFees += amt; }
    else if (c.type === "commission")         { if (taken) byClient[cid].commission = (byClient[cid].commission || 0) + amt; }
  });

  const FREQ = {daily:1,weekly:7,monthly:30};
  const enriched = asoClients.map(c => {
    const days     = FREQ[c.contribution_frequency]||30;
    const since    = c.registration_date ? Math.floor((new Date()-new Date(c.registration_date))/86400000) : 0;
    const expected = Math.floor(since/days);
    const made     = c.contribution_amount>0 ? Math.floor((c.total_saved||0)/c.contribution_amount) : 0;
    const missed   = Math.max(0, expected-made);
    const d        = byClient[c.id] || {};
    return {
      ...c, made, expected, missed,
      p_contribs:    d.contribs    || 0,
      p_manual:      d.manual      || 0,
      p_withdrawals: d.withdrawals || 0,
      p_reg_fees:    d.regFees     || 0,
      p_wd_fees:     d.wdFees      || 0,
      p_fees:        (d.regFees||0)+(d.wdFees||0),
      p_commission:  d.commission  || 0,
      // the business's profit from this client: fees + commission (contributions are the client's money, held in trust)
      p_profit:      (d.regFees||0)+(d.wdFees||0)+(d.commission||0),
      p_net:         (d.contribs||0)+(d.manual||0)-(d.withdrawals||0),
    };
  });

  const active = enriched.filter(c => byClient[c.id]);
  const bars   = active.slice(0,20).map(c=>({
    label: (c.full_name||"?").split(" ")[0],
    v: c.p_contribs+c.p_manual, color:"#3DA829",
  })).filter(b=>b.v>0);

  const totContribs    = active.reduce((s,c)=>s+c.p_contribs,0);
  const totManual      = active.reduce((s,c)=>s+c.p_manual,0);
  const totWithdrawals = active.reduce((s,c)=>s+c.p_withdrawals,0);
  const totRegFees     = active.reduce((s,c)=>s+c.p_reg_fees,0);
  const totWdFees      = active.reduce((s,c)=>s+c.p_wd_fees,0);
  const totFeeRevenue  = totRegFees+totWdFees;
  const totCommission  = active.reduce((s,c)=>s+c.p_commission,0);
  const totProfit      = totFeeRevenue+totCommission;

  return {
    enriched, active, totalBal, totalSaved, totalWithdr,
    totContribs, totManual, totWithdrawals, totRegFees, totWdFees, totFeeRevenue, totCommission, totProfit,
    bars,
  };
}

/**
 * What the business earns on ONE bill it paid: the discount on printed airtime PINs / all-network bundles (bought below
 * face value to resell at face value — the face value is saved on the order) plus the 1% cashback on airtime and data.
 * Every other bill (cable, electricity, betting, exam PINs, data PINs…) is a cost with no profit. A failed bill was
 * refunded: no cost, no profit.
 */
export function billProfit(t) {
  if (t?.bill_status === "failed") return { failed: true, face: null, discount: 0, cashback: 0, profit: 0 };
  const note = String(t?.note || "");
  const amount = Number(t?.amount) || 0;
  let face = null;
  if (t?.category === "print-airtime") {
    const m = /Value:\s*₦?([\d,]+)\s*x\s*(\d+)/i.exec(note);
    if (m) face = Number(m[1].replace(/,/g, "")) * Number(m[2]);
  } else if (t?.category === "airtime-bundle") {
    const m = /Face value:\s*₦?([\d,]+)/i.exec(note);
    if (m) face = Number(m[1].replace(/,/g, ""));
  }
  const discount = face != null ? Math.max(0, face - amount) : 0;
  const cashback = cashbackEligible(t?.category) ? Math.round(amount * 0.01 * 100) / 100 : 0;
  return { failed: false, face, discount, cashback, profit: discount + cashback };
}

export function buildBillsData(transactions, from, to) {
  const bills = transactions.filter(t => t.payment_type==="bill_payment" && inRange(t.transaction_date,from,to))
    .map(t => ({ t, ...billProfit(t) }));
  const paid = bills.filter(b => !b.failed);
  const total = paid.reduce((s,b)=>s+b.t.amount,0);
  const byCat = {};
  paid.forEach(b => {
    const k=b.t.category||"Bills";
    if(!byCat[k]) byCat[k]={total:0,count:0,profit:0};
    byCat[k].total+=b.t.amount; byCat[k].count++; byCat[k].profit+=b.profit;
  });
  const profitTotals = paid.reduce((a, b) => ({
    discount: a.discount + b.discount, cashback: a.cashback + b.cashback, profit: a.profit + b.profit,
    face: a.face + (b.face || 0),
  }), { discount: 0, cashback: 0, profit: 0, face: 0 });
  const failed = bills.filter(b => b.failed);
  return { bills, paid, total, byCat, profitTotals, failedCount: failed.length, failedTotal: failed.reduce((s,b)=>s+b.t.amount,0) };
}

export function buildStaffData(transactions, credits, asoClients, staffMap) {
  const byStaff = {};
  const ensure = id => {
    if (!byStaff[id]) byStaff[id] = { name: staffMap[id]||`Staff ${id?.slice(0,6)}`, salesIn:0, salesOut:0, txCount:0, creditsAdded:0, asoContribs:0 };
  };
  transactions.forEach(t => {
    if (!t.staff_id) return;
    ensure(t.staff_id);
    byStaff[t.staff_id].txCount++;
    if (t.type==="in") byStaff[t.staff_id].salesIn  += t.amount;
    else               byStaff[t.staff_id].salesOut += t.amount;
  });
  credits.forEach(c => {
    if (!c.staff_id) return;
    ensure(c.staff_id);
    byStaff[c.staff_id].creditsAdded++;
  });
  asoClients.forEach(c => {
    if (!c.staff_id) return;
    ensure(c.staff_id);
    byStaff[c.staff_id].asoContribs++;
  });
  const rows = Object.values(byStaff);
  const bars = rows.map(r=>({ label:r.name.split(" ")[0], v1:r.salesIn, v2:r.salesOut }));
  return { rows, bars };
}

/**
 * Stock report: per item, what was sold (qty, revenue), what it cost (each sale line's cost price saved at the sale —
 * profitEngine.saleLines, the same rule as the sales report), the profit and margin, and what was spent restocking it.
 * Cart sales are split into their items. An item with no cost price shows no profit rather than a guessed one.
 */
export function buildStockData(transactions, from, to, products = []) {
  const maps = productMaps(products);
  const tx = transactions.filter(t => inRange(t.transaction_date,from,to));
  const byItem = {};
  const row = (name) => {
    const k = name.toLowerCase().trim();
    if (!byItem[k]) byItem[k] = { item:name, qtySold:0, revenue:0, cogs:0, costedRevenue:0, uncosted:0, qtyBought:0, cost:0 };
    return byItem[k];
  };
  tx.filter(isRevenueSale).forEach(t => {
    for (const l of saleLines(t, maps)) {
      if (l.service || !l.name) continue;            // Ajo fees and unnamed sales aren't stock items
      const r = row(l.name);
      r.qtySold += l.qty; r.revenue += l.revenue;
      if (l.cost != null) { r.cogs += l.cost; r.costedRevenue += l.revenue; } else r.uncosted += l.revenue;
    }
  });
  // restocking: stock purchases only (an expense that happens to have a name is not stock)
  tx.filter(t => t.type === "out" && t.category === "stock" && t.item_name).forEach(t => {
    const r = row(t.item_name);
    r.qtyBought += (t.quantity||1); r.cost += t.amount;
  });
  const rows = Object.values(byItem).map(r => {
    const profit = r.costedRevenue > 0 ? r.costedRevenue - r.cogs : null;
    return { ...r, profit, partial: profit != null && r.uncosted > 0, margin: profit != null && r.costedRevenue > 0 ? profit / r.costedRevenue : null };
  }).sort((a,b)=>b.revenue-a.revenue);
  const totalRevenue = rows.reduce((s,r)=>s+r.revenue,0);
  const totals = rows.reduce((a, r) => ({
    cogs: a.cogs + r.cogs, profit: a.profit + (r.profit || 0), uncosted: a.uncosted + r.uncosted, stockSpend: a.stockSpend + r.cost,
    qtySold: a.qtySold + r.qtySold,
  }), { cogs: 0, profit: 0, uncosted: 0, stockSpend: 0, qtySold: 0 });
  const bars = rows.slice(0,12).map(r=>({ label:r.item.slice(0,8), v:r.revenue, color:"#0284c7" }));
  return { rows, totalRevenue, totals, bars };
}

// Ajo ledger rows that are the business's income (fees, commission) or a payout — the same set the Finance screen gives
// the profit engine.
const AJO_LEDGER_TYPES = new Set(["commission", "registration_fee", "withdrawal_fee", "esusu_payout"]);

/**
 * General business report: everything in one, for the chosen period.
 *
 * The profit is the SAME profit engine as the Finance screen (profitEngine.compute): goods profit on sales, credit sales
 * and invoices — each counted once, with the cost price saved at the sale; credit interest when it is collected; Ajo fees
 * and commission. On top of that, what bills earned (PIN discount + cashback), which the engine leaves out because it
 * treats bills as a pass-through. The separate reports can't simply be added up: a credit sale is already a sale, and the
 * stock report's profit IS the sales profit.
 */
export function buildGeneralData({ transactions = [], credits = [], asoClients = [], contributions = [], products = [],
                                   debtPayments = [], invoices = [], staffMap = {} }, from, to) {
  const sales  = buildSalesData(transactions, from, to, products);
  const credit = buildCreditData(credits);
  const ajo    = buildAsoLedger(asoClients, contributions, from, to);
  const bills  = buildBillsData(transactions, from, to);
  const stock  = buildStockData(transactions, from, to, products);

  const ajoEntries = contributions
    .filter(c => AJO_LEDGER_TYPES.has(c.type) && (!c.status || c.status === "completed"))
    .map(c => ({ id: c.id, type: c.type === "esusu_payout" ? "payout" : c.type, amount: parseFloat(c.amount) || 0, date: c.created_at }));
  const engine = compute(
    { transactions, invoices, products, asoClients, debtPayments, credits, ajoEntries },
    { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59.999`) },
  );
  const { profit: ep, cash } = engine;
  const bs = cash.byStream;
  const interest  = bs.interestEarned.amount;
  const ajoIncome = bs.ajoFeeIncome.amount;
  const billProfit = bills.profitTotals.profit;
  const gross = ep.grossProfit.amount + billProfit;
  const expenses = ep.expenses.amount;
  const profit = {
    goods: ep.grossProfit.amount - interest - ajoIncome,   // sales, credit sales and invoices
    ajo: ajoIncome, interest, bills: billProfit,
    gross, expenses, net: gross - expenses,
    revenue: ep.revenue.amount, cogs: ep.cogs.amount,
    unmeasured: ep.unmeasured.revenue,                       // sales with no cost price: revenue known, profit not counted
    financeNet: ep.netProfit.amount,                         // what the Finance screen shows for these dates
  };
  const money = {
    in: cash.in.amount, out: cash.out.amount, net: cash.net.amount,
    sales: bs.sales.amount, creditSales: bs.creditSales.amount, repayments: bs.creditRepayments.amount,
    invoices: bs.invoicePayments.amount, ajoFees: ajoIncome,
    expenses, stock: bs.stockInvestment.amount,
  };

  const goodsSales = sales.sales.filter(r => !["registration_fee", "withdrawal_fee", "commission"].includes(r.t.category));
  const salesSummary = {
    count: goodsSales.length,
    total: goodsSales.reduce((n, r) => n + (r.amount || 0), 0),
    qty: stock.totals.qtySold,
  };
  salesSummary.average = salesSummary.count ? salesSummary.total / salesSummary.count : 0;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = credit.credits.filter(c => c.status === "overdue")
    .map(c => ({ name: c.customer_name || "—", owed: c.outstanding || 0, due: c.due_date,
                 late: c.due_date ? Math.max(0, Math.round((today - new Date(`${c.due_date}T00:00:00`)) / 86400000)) : null }))
    .sort((a, b) => b.owed - a.owed);

  const stockOnHand = products.reduce((n, pr) => n + (Number(pr.quantity) > 0 ? Number(pr.quantity) * (Number(pr.cost_price) || 0) : 0), 0);
  const lowStock = products.filter(pr => pr.quantity != null && Number(pr.quantity) <= (pr.low_stock_threshold ?? 5)).length;
  const topItems = stock.rows.filter(r => r.profit != null).sort((a, b) => b.profit - a.profit).slice(0, 5);

  const byStaff = {};
  sales.tx.filter(t => t.staff_id && isRevenueSale(t)).forEach(t => {
    if (!byStaff[t.staff_id]) byStaff[t.staff_id] = { name: staffMap[t.staff_id] || `Staff ${String(t.staff_id).slice(0, 6)}`, count: 0, amount: 0 };
    byStaff[t.staff_id].count++; byStaff[t.staff_id].amount += t.amount;
  });
  const staff = Object.values(byStaff).sort((a, b) => b.amount - a.amount);

  return {
    profit, money, salesSummary, overdue, stockOnHand, lowStock, topItems, staff,
    credit: { outstanding: credit.totalOut, overdueCount: credit.overdueCount, overdueDue: credit.overdueDue || 0 },
    ajo: { held: ajo.totalBal, collections: (ajo.totContribs || 0) + (ajo.totManual || 0), withdrawals: ajo.totWithdrawals || 0,
           clients: asoClients.length, activeClients: ajo.active.length },
    bills: { total: bills.total, count: bills.paid.length, profit: billProfit, failedCount: bills.failedCount },
    stock: { spent: money.stock, qtySold: stock.totals.qtySold, cogs: stock.totals.cogs },
  };
}
