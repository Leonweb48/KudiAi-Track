import { useState, useMemo, useEffect } from "react";
import { fmt, isBillPayment } from "../utils/helpers";
import { useT }       from "../contexts/LanguageContext";
import { createReportPdf, fmtCurrency } from "../utils/generateReportPdf";
import { isRevenueSale, saleCost, saleLines, productMaps } from "../lib/profitEngine";
import { cashbackEligible } from "../utils/billCalc";
import {
  buildStaffReportCSV, staffReportCSVFilename,
  buildSalesReportCSV, salesReportCSVFilename,
  buildCreditReportCSV, creditReportCSVFilename,
  buildBillsReportCSV, billsReportCSVFilename,
  buildStockReportCSV, stockReportCSVFilename,
  buildAsoReportCSV, asoReportCSVFilename,
  shareCSV,
} from "../utils/exportCSV";
import { useCampaigns }    from "../hooks/useCampaigns";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import { supabase }        from "../utils/supabase";

/* ── date helpers ──────────────────────────────────────────────────── */
const todayStr = () => new Date().toISOString().split("T")[0];

function addDays(d, n) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}
function monthStart(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-01`;
}
function periodRange(period, cFrom, cTo) {
  const t = todayStr();
  if (period === "today")  return { from: t, to: t };
  if (period === "week")   return { from: addDays(t,-6), to: t };
  if (period === "month")  return { from: monthStart(t), to: t };
  if (period === "year")   return { from: `${new Date(t).getFullYear()}-01-01`, to: t };
  return { from: cFrom || t, to: cTo || t };
}
function inRange(d, from, to) { return d >= from && d <= to; }
function fmtD(s) {
  if (!s) return "—";
  return new Date(s+"T00:00:00").toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"});
}
function fmtPayType(pt) {
  if (!pt) return "—";
  return pt.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function daysLate(due) {
  if (!due) return 0;
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.max(0, Math.floor((t - new Date(due)) / 86400000));
}

/* ── SVG charts ────────────────────────────────────────────────────── */
function BarChart({ bars, maxH = 130 }) {
  if (!bars?.length) return null;
  const W = 720; const H = maxH; const N = bars.length;
  const slot = W / N;
  const BW   = Math.min(slot * 0.55, 36);
  const maxV = Math.max(...bars.map(b => Math.max(b.v1||0, b.v2||b.v||0)), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H+28}`} style={{width:"100%",height:H+28,display:"block"}}>
      {[.25,.5,.75,1].map(f=>(
        <line key={f} x1={0} y1={H*(1-f)} x2={W} y2={H*(1-f)}
          stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3"/>
      ))}
      {bars.map((b,i)=>{
        const cx = i*slot + slot/2;
        if (b.v1 !== undefined && b.v2 !== undefined) {
          const h1 = Math.max(2,(b.v1/maxV)*H);
          const h2 = Math.max(2,(b.v2/maxV)*H);
          return (
            <g key={i}>
              <rect x={cx-BW-1} y={H-h1} width={BW} height={h1} fill="#16a34a" rx={3} opacity={.85}/>
              <rect x={cx+1}    y={H-h2} width={BW} height={h2} fill="#ef4444" rx={3} opacity={.85}/>
              <text x={cx} y={H+17} textAnchor="middle" fontSize={9} fill="#64748b">{b.label}</text>
            </g>
          );
        }
        const h = Math.max(2,((b.v||0)/maxV)*H);
        return (
          <g key={i}>
            <rect x={cx-BW/2} y={H-h} width={BW} height={h} fill={b.color||"#16a34a"} rx={3} opacity={.85}/>
            <text x={cx} y={H+17} textAnchor="middle" fontSize={9} fill="#64748b">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ segments, size=140 }) {
  if (!segments?.length) return null;
  const total = segments.reduce((s,sg)=>s+(sg.v||0),0);
  if (!total) return null;
  const cx=size/2, cy=size/2, R=size*0.37, IR=R*0.55;
  let ang = -90;
  const slices = segments.map(sg=>{
    const frac=(sg.v||0)/total;
    const sweep=frac*360;
    const a0=ang, a1=ang+sweep; ang=a1;
    const r=(a)=>a*Math.PI/180;
    const p=(a)=>[cx+R*Math.cos(r(a)), cy+R*Math.sin(r(a))];
    const [x0,y0]=p(a0); const [x1,y1]=p(a1);
    const large=sweep>180?1:0;
    return {...sg, frac, d:`M${cx},${cy}L${x0},${y0}A${R},${R},0,${large},1,${x1},${y1}Z`};
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{width:size,height:size}}>
      {slices.map((s,i)=>(
        <path key={i} d={s.d} fill={s.color} opacity={.88} stroke="white" strokeWidth={1.5}/>
      ))}
      <circle cx={cx} cy={cy} r={IR} fill="white"/>
      <text x={cx} y={cy-5} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#1e293b">
        {Math.round((slices[0]?.frac||0)*100)}%
      </text>
      <text x={cx} y={cy+11} textAnchor="middle" fontSize={9} fill="#64748b">{slices[0]?.label}</text>
    </svg>
  );
}

/* ── Shared report UI helpers ──────────────────────────────────────── */
function S(style) { return { fontFamily:"'Segoe UI',Arial,sans-serif", ...style }; }

function StatGrid({ stats }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(stats.length,4)},1fr)`,gap:10,marginBottom:18}}>
      {stats.map((s,i)=>(
        <div key={i} style={S({background:s.bg||"#f8fafc",border:`1px solid ${s.border||"#e2e8f0"}`,borderRadius:10,padding:"11px 12px",overflow:"hidden",minWidth:0})}>
          <p style={S({fontSize:8,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:0.8,margin:"0 0 5px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"})}>{s.label}</p>
          <p style={S({fontSize:15,fontWeight:900,color:s.color||"#1e293b",margin:0,wordBreak:"break-word",overflowWrap:"break-word",lineHeight:1.2})}>{s.value}</p>
          {s.sub && <p style={S({fontSize:9,color:"#94a3b8",margin:"3px 0 0",wordBreak:"break-word"})}>{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={S({fontSize:10,fontWeight:800,color:"#64748b",textTransform:"uppercase",letterSpacing:1.5,margin:"20px 0 10px",borderBottom:"2px solid #e2e8f0",paddingBottom:6})}>
      {children}
    </p>
  );
}

function Table({ cols, rows, highlight }) {
  return (
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,tableLayout:"fixed",marginBottom:14}}>
      <colgroup>
        {cols.map((c,i)=><col key={i} style={{width: c.w || `${Math.floor(100/cols.length)}%`}}/>)}
      </colgroup>
      <thead>
        <tr style={{background:"#f1f5f9"}}>
          {cols.map((c,i)=>(
            <th key={i} style={S({padding:"6px 6px",textAlign:c.right?"right":"left",fontWeight:700,color:"#475569",fontSize:8,letterSpacing:0.3,textTransform:"uppercase",wordBreak:"break-word",overflow:"hidden"})}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r,ri)=>(
          <tr key={ri} style={{background: highlight?.(r,ri) || (ri%2===0?"#ffffff":"#f8fafc"),borderBottom:"1px solid #f1f5f9"}}>
            {cols.map((c,ci)=>(
              <td key={ci} style={S({padding:"5px 6px",textAlign:c.right?"right":"left",color:c.color?.(r)||"#334155",fontWeight:c.bold?"600":"400",wordBreak:"break-word",overflowWrap:"break-word",overflow:"hidden"})}>
                {r[c.key]}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={cols.length} style={S({padding:"14px 8px",textAlign:"center",color:"#94a3b8",fontStyle:"italic",fontSize:9})}>No data for this period</td></tr>
        )}
      </tbody>
    </table>
  );
}

function ChartLegend({ items }) {
  return (
    <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:6,marginBottom:16}}>
      {items.map((it,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
          <span style={{width:10,height:10,borderRadius:3,background:it.color,display:"inline-block"}}/>
          <span style={S({fontSize:10,color:"#64748b"})}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

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

function buildSalesData(transactions, from, to, products = []) {
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

function buildStaffData(transactions, credits, asoClients, staffMap) {
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

/* ── Report sections ───────────────────────────────────────────────── */
function SalesSection({ data }) {
  const catRows = Object.entries(data.byCat).sort((a,b)=>b[1].in-a[1].in).map(([cat,v])=>({
    cat, in_: fmt(v.in), out_: fmt(v.out), net: fmt(v.in-v.out), count: v.count
  }));
  const txRows = data.tx.slice(0,50).map(t=>({
    date: fmtD(t.transaction_date),
    item: t.item_name||"—",
    cat:  t.category||"—",
    type: t.type==="in"?"Income":"Expense",
    amount: fmt(t.amount),
    pay: fmtPayType(t.payment_type),
    _type: t.type,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Total Sales",     value:fmt(data.salesTotals.revenue), color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
        { label:"Profit on Sales", value:fmt(data.salesTotals.profit),  color: data.salesTotals.profit>=0?"#16a34a":"#ef4444", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Expenses",        value:fmt(data.cashOut),             color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
        { label:"Net Cash",        value:fmt(data.profit),              color: data.profit>=0?"#16a34a":"#ef4444", bg:"#f8fafc", border:"#e2e8f0" },
      ]}/>
      <SectionTitle>Sales &amp; Profit</SectionTitle>
      <Table
        cols={[
          {key:"date",   label:"Date",   w:"14%"},
          {key:"item",   label:"Item",   bold:true, w:"34%"},
          {key:"qty",    label:"Qty",    right:true, w:"8%"},
          {key:"amount", label:"Amount", right:true, bold:true, w:"22%"},
          {key:"profit", label:"Profit", right:true, bold:true, color:r=>r._p==null?"#94a3b8":r._p>=0?"#16a34a":"#ef4444", w:"22%"},
        ]}
        rows={data.sales.slice(0,50).map(r=>({
          date: fmtD(r.t.transaction_date), item: r.item, qty: r.qty, amount: fmt(r.amount),
          profit: r.profit==null ? "No cost price" : fmt(r.profit) + (r.partial ? " *" : ""), _p: r.profit,
        }))}/>
      {data.sales.length > 50 && <p style={S({fontSize:10,color:"#94a3b8",fontStyle:"italic",marginTop:-8})}>Showing first 50 of {data.sales.length} sales — the PDF lists them all</p>}
      {data.salesTotals.uncosted > 0 && (
        <p style={S({fontSize:10.5,color:"#b45309",marginTop:-4,marginBottom:12})}>
          {fmt(data.salesTotals.uncosted)} of sales have no cost price, so their profit isn't counted{data.sales.some(r=>r.partial) ? " (* = part of the sale has no cost price)" : ""}. Add cost prices in Stock to include them.
        </p>
      )}
      <SectionTitle>Income vs Expenses</SectionTitle>
      <ChartLegend items={[{color:"#16a34a",label:"Income"},{color:"#ef4444",label:"Expenses"}]}/>
      <BarChart bars={data.bars}/>
      <SectionTitle>Category Breakdown</SectionTitle>
      <Table
        cols={[
          {key:"cat",  label:"Category", bold:true, w:"35%"},
          {key:"in_",  label:"Income",   right:true, color:()=>"#16a34a", w:"18%"},
          {key:"out_", label:"Expenses", right:true, color:()=>"#ef4444", w:"18%"},
          {key:"net",  label:"Net",      right:true, w:"18%"},
          {key:"count",label:"Count",    right:true, w:"11%"},
        ]}
        rows={catRows}/>
      <SectionTitle>Transaction Log</SectionTitle>
      <Table
        cols={[
          {key:"date",  label:"Date",     w:"13%"},
          {key:"item",  label:"Item",     bold:true, w:"26%"},
          {key:"cat",   label:"Category", w:"16%"},
          {key:"type",  label:"Type",     color:r=>r._type==="in"?"#16a34a":"#ef4444", bold:true, w:"10%"},
          {key:"amount",label:"Amount",   right:true, bold:true, w:"15%"},
          {key:"pay",   label:"Payment",  w:"20%"},
        ]}
        rows={txRows}
        highlight={(r)=>r._type==="out"?"#fff5f5":undefined}/>
      {data.tx.length > 50 && <p style={S({fontSize:10,color:"#94a3b8",fontStyle:"italic",marginTop:-8})}>Showing first 50 of {data.tx.length} transactions</p>}
    </div>
  );
}

function CreditSection({ data }) {
  const pt = data.profitTotals;
  const rows = data.profits.map(({ c, profit, partial })=>({
    name:  c.customer_name,
    profit: profit==null ? "No cost" : fmt(profit) + (partial ? " *" : ""),
    _p:    profit,
    total: fmt(c.total_amount||0),
    paid:  fmt(c.amount_paid||0),
    owed:  fmt(c.outstanding||0),
    due:   fmtD(c.due_date),
    status:c.status?.replace(/_/g," ")?.toUpperCase()||"ACTIVE",
    late:  c.status==="overdue"?`${daysLate(c.due_date)}d`:"—",
    _s:    c.status,
  }));
  const pieData = [
    { label:"Outstanding", v:data.totalOut,  color:"#ef4444" },
    { label:"Paid",        v:data.totalPaid, color:"#16a34a" },
  ];
  return (
    <div>
      <StatGrid stats={[
        { label:"Total Debt",    value:fmt(data.totalDebt),    color:"#334155", bg:"#f8fafc",   border:"#e2e8f0" },
        { label:"Outstanding",  value:fmt(data.totalOut),     color:"#ef4444", bg:"#fef2f2",   border:"#fecaca" },
        { label:"Recovered",    value:fmt(data.totalPaid),    color:"#16a34a", bg:"#f0fdf4",   border:"#bbf7d0" },
        { label:"Profit on Credit", value:fmt(pt.profit),       color:"#16a34a", bg:"#f0fdf4",   border:"#bbf7d0" },
      ]}/>
      <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:14}}>
        <div style={{width:190,flexShrink:0}}>
          <SectionTitle>Payment Status</SectionTitle>
          <PieChart segments={pieData} size={150}/>
          <ChartLegend items={pieData.map(p=>({color:p.color,label:p.label}))}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <SectionTitle>Overdue Summary</SectionTitle>
          {data.overdueCount===0
            ? <p style={S({color:"#16a34a",fontSize:11,fontStyle:"italic"})}>✓ No overdue accounts</p>
            : <div style={S({background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px"})}>
                <p style={S({fontSize:12,fontWeight:700,color:"#dc2626",margin:0,wordBreak:"break-word"})}>⚠ {data.overdueCount} overdue account{data.overdueCount>1?"s":""}</p>
                <p style={S({fontSize:11,color:"#ef4444",margin:"4px 0 0",wordBreak:"break-word"})}>{fmt(data.overdueDue)} outstanding on overdue accounts</p>
              </div>
          }
        </div>
      </div>
      <SectionTitle>Debtor Records</SectionTitle>
      <Table
        cols={[
          {key:"name",  label:"Customer",    bold:true, w:"18%"},
          {key:"total", label:"Total",       right:true, w:"11%"},
          {key:"paid",  label:"Paid",        right:true, color:()=>"#16a34a", w:"11%"},
          {key:"owed",  label:"Owed",        right:true, bold:true, color:r=>r._s==="overdue"?"#dc2626":"#ef4444", w:"11%"},
          {key:"profit",label:"Profit",      right:true, bold:true, color:r=>r._p==null?"#94a3b8":"#16a34a", w:"12%"},
          {key:"due",   label:"Due Date",               w:"12%"},
          {key:"status",label:"Status",      color:r=>r._s==="overdue"?"#dc2626":r._s==="paid"?"#16a34a":"#64748b", bold:true, w:"17%"},
          {key:"late",  label:"Late",        right:true, color:r=>r.late!=="—"?"#dc2626":"#94a3b8", w:"8%"},
        ]}
        rows={rows}
        highlight={r=>r._s==="overdue"?"#fff5f5":undefined}/>
      <p style={S({fontSize:10.5,color:"#64748b",marginTop:-4,marginBottom:12,lineHeight:1.5})}>
        Profit = profit on the goods sold on credit (each item's cost price saved when the credit was given) + interest {fmt(pt.interest)} — earned as customers repay.
        {pt.uncosted > 0 ? ` ${fmt(pt.uncosted)} of credit has no item cost (no items recorded, or credit added later), so its goods profit isn't counted (*).` : ""}
      </p>
    </div>
  );
}

function AsoSection({ data }) {
  const {
    active=[], totalBal,
    totContribs=0, totManual=0, totWithdrawals=0,
    totRegFees=0, totWdFees=0, totCommission=0, totProfit=0, bars=[],
  } = data;
  const rows = active.map(c=>({
    name:    c.full_name||"—",
    contribs: fmt(c.p_contribs),
    manual:   fmt(c.p_manual),
    withdr:   fmt(c.p_withdrawals),
    fees:     fmt(c.p_profit),
    net:      fmt(c.p_net),
    balance:  fmt(c.current_balance||0),
    _net:     c.p_net,
    _fees:    c.p_profit,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Savings Held",       value:fmt(totalBal),               color:"#2E8020", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Period Collections", value:fmt(totContribs+totManual),  color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Period Withdrawals", value:fmt(totWithdrawals),         color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
        { label:"Ajo Profit",         value:fmt(totProfit),              color:"#d97706", bg:"#fffbeb", border:"#fde68a" },
      ]}/>
      {bars.length > 0 && (<>
        <SectionTitle>Collections by Client</SectionTitle>
        <BarChart bars={bars} maxH={110}/>
      </>)}
      <SectionTitle>Period Activity by Client</SectionTitle>
      <p style={S({fontSize:9,color:"#94a3b8",marginBottom:8,fontStyle:"italic"})}>
        Savings Held = client funds held in trust — separate from business profit. Profit = fees + commission earned from each client.
      </p>
      <Table
        cols={[
          {key:"name",    label:"Client",       bold:true, w:"20%"},
          {key:"contribs",label:"Contributions",right:true, color:()=>"#16a34a", w:"14%"},
          {key:"manual",  label:"Manual Dep.",  right:true, w:"11%"},
          {key:"withdr",  label:"Withdrawals",  right:true, color:()=>"#ef4444", w:"13%"},
          {key:"fees",    label:"Profit",       right:true, bold:true, color:r=>r._fees>0?"#16a34a":"#94a3b8", w:"11%"},
          {key:"net",     label:"Net",          right:true, bold:true, color:r=>r._net>=0?"#2E8020":"#ef4444", w:"13%"},
          {key:"balance", label:"Balance",      right:true, w:"18%"},
        ]}
        rows={rows}
        highlight={r=>r._net<0?"#fff5f5":undefined}/>
      {totProfit > 0 && (<>
        <SectionTitle>Ajo Profit Summary</SectionTitle>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
          <div style={S({background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 14px",flex:1,minWidth:100})}>
            <p style={S({fontSize:9,color:"#92400e",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:0.5})}>Registration Fees</p>
            <p style={S({fontSize:15,fontWeight:900,color:"#d97706",margin:0})}>{fmt(totRegFees)}</p>
          </div>
          <div style={S({background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 14px",flex:1,minWidth:100})}>
            <p style={S({fontSize:9,color:"#92400e",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:0.5})}>Withdrawal Fees</p>
            <p style={S({fontSize:15,fontWeight:900,color:"#d97706",margin:0})}>{fmt(totWdFees)}</p>
          </div>
          <div style={S({background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 14px",flex:1,minWidth:100})}>
            <p style={S({fontSize:9,color:"#92400e",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:0.5})}>Commission</p>
            <p style={S({fontSize:15,fontWeight:900,color:"#d97706",margin:0})}>{fmt(totCommission)}</p>
          </div>
          <div style={S({background:"#2E8020",borderRadius:10,padding:"8px 14px",flex:1,minWidth:100})}>
            <p style={S({fontSize:9,color:"#bbf7d0",fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:0.5})}>Total Ajo Profit</p>
            <p style={S({fontSize:15,fontWeight:900,color:"#fff",margin:0})}>{fmt(totProfit)}</p>
          </div>
        </div>
      </>)}
    </div>
  );
}

function BillsSection({ data }) {
  const pt = data.profitTotals;
  const catRows = Object.entries(data.byCat).sort((a,b)=>b[1].total-a[1].total).map(([cat,v])=>({
    cat, total:fmt(v.total), count:v.count, profit:fmt(v.profit), _p:v.profit,
  }));
  const rows = data.bills.slice(0,60).map(b=>({
    date: fmtD(b.t.transaction_date),
    item: b.t.item_name||"—",
    cat:  b.t.category||"—",
    amount: b.failed ? `${fmt(b.t.amount)} (refunded)` : fmt(b.t.amount),
    profit: b.failed ? "Failed" : fmt(b.profit),
    _p: b.failed ? null : b.profit, _f: b.failed,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Total Bills Paid", value:fmt(data.total),     color:"#dc2626", bg:"#fef2f2", border:"#fecaca" },
        { label:"Bill Profit",      value:fmt(pt.profit),      color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"PIN Discount",     value:fmt(pt.discount),    color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
        { label:"Cashback Earned",  value:fmt(pt.cashback),    color:"#d97706", bg:"#fffbeb", border:"#fde68a" },
      ]}/>
      <SectionTitle>By Category</SectionTitle>
      <Table
        cols={[
          {key:"cat",   label:"Category",   bold:true, w:"40%"},
          {key:"total", label:"Total Paid", right:true, bold:true, color:()=>"#dc2626", w:"24%"},
          {key:"count", label:"Count",      right:true, w:"12%"},
          {key:"profit",label:"Profit",     right:true, bold:true, color:r=>r._p>0?"#16a34a":"#94a3b8", w:"24%"},
        ]}
        rows={catRows}/>
      <SectionTitle>Bill Transactions</SectionTitle>
      <Table
        cols={[
          {key:"date",  label:"Date",     w:"14%"},
          {key:"item",  label:"Item",     bold:true, w:"30%"},
          {key:"cat",   label:"Category", w:"16%"},
          {key:"amount",label:"Amount",   right:true, bold:true, color:r=>r._f?"#94a3b8":"#dc2626", w:"22%"},
          {key:"profit",label:"Profit",   right:true, bold:true, color:r=>r._f?"#94a3b8":r._p>0?"#16a34a":"#94a3b8", w:"18%"},
        ]}
        rows={rows}/>
      <p style={S({fontSize:10.5,color:"#64748b",marginTop:-4,marginBottom:12,lineHeight:1.5})}>
        Bill profit = the discount on printed airtime PINs and bundles (resold at face value) + 1% cashback on airtime and data. Other bills are costs with no profit.
        {data.failedCount > 0 ? ` ${data.failedCount} failed bill${data.failedCount===1?"":"s"} (${fmt(data.failedTotal)}, refunded) not counted.` : ""}
      </p>
    </div>
  );
}

function StaffSection({ data }) {
  const rows = data.rows.map(r=>({
    name:    r.name,
    txCount: r.txCount,
    salesIn: fmt(r.salesIn),
    salesOut:fmt(r.salesOut),
    net:     fmt(r.salesIn-r.salesOut),
    credits: r.creditsAdded,
    aso:     r.asoContribs,
    _net:    r.salesIn-r.salesOut,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Active Staff",    value:data.rows.length,                               color:"#0284c7", bg:"#eff6ff",  border:"#bfdbfe" },
        { label:"Total Txns",      value:data.rows.reduce((s,r)=>s+r.txCount,0),        color:"#334155", bg:"#f8fafc",  border:"#e2e8f0" },
        { label:"Total Sales",     value:fmt(data.rows.reduce((s,r)=>s+r.salesIn,0)),   color:"#16a34a", bg:"#f0fdf4",  border:"#bbf7d0" },
        { label:"Credits Added",   value:data.rows.reduce((s,r)=>s+r.creditsAdded,0),  color:"#d97706", bg:"#fffbeb",  border:"#fde68a" },
      ]}/>
      {data.bars.length > 0 && (<>
        <SectionTitle>Sales per Staff Member</SectionTitle>
        <ChartLegend items={[{color:"#16a34a",label:"Sales"},{color:"#ef4444",label:"Expenses"}]}/>
        <BarChart bars={data.bars} maxH={110}/>
      </>)}
      <SectionTitle>Performance Breakdown</SectionTitle>
      <Table
        cols={[
          {key:"name",    label:"Staff Member", bold:true, w:"22%"},
          {key:"txCount", label:"Txns",         right:true, w:"10%"},
          {key:"salesIn", label:"Sales",        right:true, color:()=>"#16a34a", bold:true, w:"15%"},
          {key:"salesOut",label:"Expenses",     right:true, color:()=>"#ef4444", w:"15%"},
          {key:"net",     label:"Net",          right:true, bold:true, color:r=>r._net>=0?"#16a34a":"#ef4444", w:"15%"},
          {key:"credits", label:"Credits",      right:true, color:()=>"#d97706", w:"12%"},
          {key:"aso",     label:"Ajo",          right:true, color:()=>"#7c3aed", w:"11%"},
        ]}
        rows={rows}/>
      {data.rows.length===0 && <p style={S({color:"#94a3b8",fontSize:12,fontStyle:"italic"})}>No staff transaction data found. Staff ID tracking must be enabled and active.</p>}
    </div>
  );
}

function StockSection({ data }) {
  const tt = data.totals;
  const pct = (m) => (m == null ? "—" : `${Math.round(m * 100)}%`);
  return (
    <div>
      <StatGrid stats={[
        { label:"Revenue",        value:fmt(data.totalRevenue), color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
        { label:"Cost of Goods",  value:fmt(tt.cogs),           color:"#64748b", bg:"#f8fafc", border:"#e2e8f0" },
        { label:"Stock Profit",   value:fmt(tt.profit),         color:tt.profit>=0?"#16a34a":"#ef4444", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Spent on Stock", value:fmt(tt.stockSpend),     color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
      ]}/>
      {data.bars.length > 0 && (<>
        <SectionTitle>Revenue by Item</SectionTitle>
        <BarChart bars={data.bars} maxH={110}/>
      </>)}
      <SectionTitle>Item Performance</SectionTitle>
      <Table
        cols={[
          {key:"item",     label:"Item",       bold:true, w:"21%"},
          {key:"qtySold",  label:"Sold",       right:true, w:"6%"},
          {key:"revenue",  label:"Revenue",    right:true, bold:true, w:"14%"},
          {key:"cogs",     label:"Cost",       right:true, color:()=>"#64748b", w:"13%"},
          {key:"profit",   label:"Profit",     right:true, bold:true, color:r=>r._p==null?"#94a3b8":r._p>=0?"#16a34a":"#ef4444", w:"14%"},
          {key:"margin",   label:"Margin",     right:true, w:"8%"},
          {key:"qtyBought",label:"Bought",     right:true, w:"8%"},
          {key:"cost",     label:"Restock",    right:true, color:r=>r._c>0?"#ef4444":"#94a3b8", w:"16%"},
        ]}
        rows={data.rows.map(r=>({
          item:r.item, qtySold:r.qtySold, revenue:fmt(r.revenue), cogs:r.profit==null?"—":fmt(r.cogs),
          profit:r.profit==null?(r.revenue>0?"No cost":"—"):fmt(r.profit)+(r.partial?" *":""), _p:r.profit,
          margin:pct(r.margin), qtyBought:r.qtyBought||"—", cost:r.cost>0?fmt(r.cost):"—", _c:r.cost,
        }))}/>
      <p style={S({fontSize:10.5,color:"#64748b",marginTop:-4,marginBottom:12,lineHeight:1.5})}>
        Profit = revenue − the cost price saved when each item was sold. Restock = what was spent buying the item in this period.
        {tt.uncosted > 0 ? ` ${fmt(tt.uncosted)} of item sales have no cost price, so their profit isn't counted (*).` : ""}
      </p>
    </div>
  );
}

/* ── Report template ────────────────────────────────────────────────── */
function ReportTemplate({ type, reportData, profile, from, to }) {
  const biz = profile?.business_name || profile?.owner_name || "My Business";
  const TITLES = {
    sales:  "Sales & Revenue Report",
    credit: "Credit Management Report",
    aso:    "Ajo / Aso Savings Report",
    bills:  "Bill Payments Report",
    staff:  "Staff Performance Report",
    stock:  "Stock & Inventory Report",
  };
  const now = new Date().toLocaleString("en-NG",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const period = from===to ? fmtD(from) : `${fmtD(from)} — ${fmtD(to)}`;

  return (
    <div style={S({width:794,background:"#ffffff",color:"#1e293b",overflow:"hidden"})}>

      {/* LETTERHEAD */}
      <div style={{background:"linear-gradient(135deg,#1a4d0f 0%,#2E8020 55%,#3DA829 100%)",padding:"28px 36px 22px",display:"flex",alignItems:"center",gap:16}}>
        <div style={{width:52,height:52,borderRadius:12,background:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",padding:4}}>
          <img src="/logo-tp.png" alt="KudiAI" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"baseline",gap:3}}>
            <span style={S({color:"white",fontSize:22,fontWeight:900,letterSpacing:-0.5})}>KUDI</span>
            <span style={S({color:"#6ee7b7",fontSize:22,fontWeight:900,letterSpacing:-0.5})}>AI</span>
            <span style={S({color:"rgba(255,255,255,0.55)",fontSize:10,fontWeight:700,letterSpacing:3,textTransform:"uppercase",marginLeft:5})}>Track</span>
          </div>
          <p style={S({color:"rgba(255,255,255,0.85)",margin:"4px 0 0",fontSize:13,fontWeight:600,wordBreak:"break-word",overflowWrap:"break-word"})}>{biz}</p>
          <p style={S({color:"rgba(255,255,255,0.5)",margin:"2px 0 0",fontSize:10})}>support@kudiai.app</p>
        </div>
        <div style={{textAlign:"right"}}>
          <p style={S({color:"rgba(255,255,255,0.5)",fontSize:10,margin:0})}>Generated</p>
          <p style={S({color:"white",fontSize:11,fontWeight:600,margin:"2px 0 0"})}>{now}</p>
        </div>
      </div>

      {/* REPORT TITLE BAND */}
      <div style={{background:"#f0fdf4",borderBottom:"3px solid #3DA829",padding:"14px 36px"}}>
        <p style={S({color:"#2E8020",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:2,margin:"0 0 3px"})}>{TITLES[type]}</p>
        <p style={S({color:"#64748b",fontSize:12,margin:0})}>Period: <strong style={{color:"#1e293b"}}>{period}</strong></p>
      </div>

      {/* CONTENT */}
      <div style={{padding:"24px 36px"}}>
        {type==="sales"  && <SalesSection  data={reportData}/>}
        {type==="credit" && <CreditSection data={reportData}/>}
        {type==="aso"    && <AsoSection    data={reportData}/>}
        {type==="bills"  && <BillsSection  data={reportData}/>}
        {type==="staff"  && <StaffSection  data={reportData}/>}
        {type==="stock"  && <StockSection  data={reportData}/>}
      </div>

      {/* FOOTER */}
      <div style={{borderTop:"1px solid #e2e8f0",padding:"12px 36px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f8fafc"}}>
        <span style={S({fontSize:10,color:"#94a3b8"})}>Generated by KudiAI Track · {biz}</span>
        <span style={S({fontSize:10,color:"#cbd5e1"})}>CONFIDENTIAL</span>
      </div>
    </div>
  );
}

/* ── Report type selector cards ─────────────────────────────────────── */
function makeReportTypes(t) {
  return [
    { id:"sales",  label:t("report.sales"),  sub:"Revenue, expenses, profit & transactions",  icon:"📈", color:"bg-green-50 dark:bg-green-900/20",  border:"border-green-200 dark:border-green-800",  active:"bg-green-600" },
    { id:"credit", label:t("report.credit"), sub:"Debtors, outstanding & overdue accounts",   icon:"👥", color:"bg-amber-50 dark:bg-amber-900/20",  border:"border-amber-200 dark:border-amber-800",  active:"bg-amber-500" },
    { id:"aso",    label:t("report.ajo"),    sub:"Savings clients, contributions & balance",  icon:"🏦", color:"bg-brand-50 dark:bg-brand-900/20",  border:"border-brand-200 dark:border-brand-800",  active:"bg-brand-600" },
    { id:"bills",  label:t("report.bills"),  sub:"Bill payments by category & provider",      icon:"🧾", color:"bg-red-50 dark:bg-red-900/20",      border:"border-red-200 dark:border-red-800",      active:"bg-red-500"   },
    { id:"staff",  label:t("report.staff"),  sub:"Per-staff transactions & contributions",    icon:"👤", color:"bg-blue-50 dark:bg-blue-900/20",    border:"border-blue-200 dark:border-blue-800",    active:"bg-blue-600"  },
    { id:"stock",  label:t("report.stock"),  sub:"Items sold, revenue & inventory overview",  icon:"📦", color:"bg-orange-50 dark:bg-orange-900/20",border:"border-orange-200 dark:border-orange-800",active:"bg-orange-500"},
  ];
}

function makePeriods(t) {
  return [
    { id:"today", label:t("report.today")     },
    { id:"week",  label:t("report.thisWeek")  },
    { id:"month", label:t("report.thisMonth") },
    { id:"year",  label:t("report.thisYear")  },
    { id:"custom",label:t("report.custom")    },
  ];
}

// The business's own letterhead for owner report PDFs: logo / address / contacts from the invoice settings when set, else
// the profile (the same source invoices use).
async function loadLetterhead(profile) {
  let inv = null;
  if (profile?.id) {
    try {
      const { data } = await supabase.from("invoice_settings")
        .select("logo_url, contact_email, contact_phone, address").eq("user_id", profile.id).maybeSingle();
      inv = data;
    } catch { /* fall back to the profile */ }
  }
  const area = [profile?.business_lga || profile?.lga, profile?.business_state || profile?.state].filter(Boolean).join(", ");
  const street = profile?.business_address || profile?.address || "";
  return {
    businessName: profile?.business_name || "My Business",
    logoUrl: inv?.logo_url || profile?.store_image_url || "",
    address: inv?.address || [street, area && !street.includes(area) ? area : ""].filter(Boolean).join(", "),
    phone: inv?.contact_phone || profile?.business_phone || profile?.phone || "",
    email: inv?.contact_email || profile?.business_email || profile?.email || "",
    generatedAt: new Date(),
  };
}

// The headline figures saved with the report's reference — the verify page shows them so whoever holds the PDF can check
// the printed figures were not changed. Strings exactly as printed.
export function reportSummary(type, data) {
  const N = fmtCurrency;
  switch (type) {
    case "sales": return [
      { label: "Total sales", value: N(data.salesTotals.revenue) }, { label: "Profit on sales", value: N(data.salesTotals.profit) },
      { label: "Expenses", value: N(data.cashOut) }, { label: "Net cash", value: N(data.profit) },
      { label: "Number of sales", value: String(data.salesTotals.count) },
    ];
    case "credit": return [
      { label: "Total debt", value: N(data.totalDebt) }, { label: "Outstanding", value: N(data.totalOut) },
      { label: "Recovered", value: N(data.totalPaid) }, { label: "Profit on credit", value: N(data.profitTotals.profit) },
      { label: "Overdue accounts", value: String(data.overdueCount) },
    ];
    case "aso": return [
      { label: "Savings held", value: N(data.totalBal) }, { label: "Period collections", value: N((data.totContribs || 0) + (data.totManual || 0)) },
      { label: "Period withdrawals", value: N(data.totWithdrawals || 0) }, { label: "Ajo profit", value: N(data.totProfit || 0) },
    ];
    case "bills": return [
      { label: "Total bills paid", value: N(data.total) }, { label: "Profit on bills", value: N(data.profitTotals.profit) },
      { label: "Bills paid", value: String(data.paid.length) },
    ];
    case "staff": return [
      { label: "Staff members", value: String(data.rows.length) },
      { label: "Sales recorded by staff", value: N(data.rows.reduce((n, r) => n + (r.salesIn || 0), 0)) },
    ];
    case "stock": return [
      { label: "Revenue", value: N(data.totalRevenue) }, { label: "Cost of goods", value: N(data.totals.cogs) },
      { label: "Profit on stock", value: N(data.totals.profit) }, { label: "Items", value: String(data.rows.length) },
    ];
    default: return [];
  }
}

// Saves the report's reference + headline figures (report_verifications) — "" when it can't (offline): the PDF is then
// still produced, just without the verify block.
async function registerReport(type, from, to, businessName, summary) {
  try {
    const { data, error } = await supabase.from("report_verifications")
      .insert({ report_type: type, period_from: from || null, period_to: to || null, business_name: businessName, summary })
      .select("ref").single();
    if (error) throw error;
    return data?.ref || "";
  } catch (e) {
    console.warn("[reports] report reference not saved:", e?.message || e);
    return "";
  }
}

export async function buildNativeReportPDF(type, data, profile, from, to) {
  const TNAMES = {
    sales:"Sales Report", credit:"Credit Report", aso:"Ajo Savings Report",
    bills:"Bills Report", staff:"Staff Performance Report", stock:"Stock Report",
  };
  const PNAMES = { sales:"Sales", credit:"Credit", aso:"Ajo", bills:"Bills", staff:"Staff", stock:"Stock" };
  const biz = profile?.business_name || "My Business";
  const prd = from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`;

  const [letterhead, verifyRef] = await Promise.all([
    loadLetterhead(profile),
    registerReport(type, from, to, biz, reportSummary(type, data)),
  ]);
  const pdf = await createReportPdf({ title: TNAMES[type] || "Report", businessName: biz, period: prd, letterhead, verifyRef });
  const { addStats, addSectionTitle, addTable, addTotalsBlock, addBarChart, fmtN } = pdf;

  if (type === "sales") {
    const { cashOut, profit, tx, bars, byCat, sales, salesTotals } = data;
    addStats([
      { label:"Total Sales",     value:fmtN(salesTotals.revenue), color:"#0284c7", bg:"#eff6ff" },
      { label:"Profit on Sales", value:fmtN(salesTotals.profit),  color:salesTotals.profit>=0?"#16a34a":"#ef4444", bg:"#f0fdf4" },
      { label:"Expenses",        value:fmtN(cashOut),             color:"#ef4444", bg:"#fef2f2" },
      { label:"Net Cash",        value:fmtN(profit),              color:profit>=0?"#16a34a":"#ef4444", bg:"#f8fafc" },
    ]);
    addSectionTitle(`Sales & Profit — ${salesTotals.count} sale${salesTotals.count === 1 ? "" : "s"}`);
    const MAX_SALES = 500;
    addTable(
      [{ key:"date",   label:"Date",     w:0.11 },
       { key:"item",   label:"Item",     bold:true, w:0.29 },
       { key:"cust",   label:"Customer", w:0.15 },
       { key:"qty",    label:"Qty",      right:true, w:0.06 },
       { key:"amount", label:"Amount",   right:true, bold:true, w:0.13 },
       { key:"cost",   label:"Cost",     right:true, color:()=>[100,99,94], w:0.12 },
       { key:"profit", label:"Profit",   right:true, bold:true, color:r=>r._p==null?[150,150,150]:r._p>=0?[22,163,74]:[220,38,38], w:0.14 }],
      sales.slice(0, MAX_SALES).map(r=>({
        date:fmtD(r.t.transaction_date), item:r.item, cust:r.t.customer_name||"—", qty:r.qty,
        amount:fmtN(r.amount), cost:r.cost==null ? "—" : fmtN(r.cost),
        profit:r.profit==null ? "No cost" : fmtN(r.profit) + (r.partial ? " *" : ""), _p:r.profit,
      }))
    );
    addTotalsBlock([
      { label:`Total sales (${salesTotals.count})`, value:fmtN(salesTotals.revenue), bold:true },
      { label:"Cost of goods sold",                    value:fmtN(salesTotals.cost) },
      ...(salesTotals.uncosted > 0 ? [{ label:"Sales with no cost price", value:fmtN(salesTotals.uncosted) }] : []),
      { sep:true },
      { label:"Total profit on sales",                 value:fmtN(salesTotals.profit), bold:true, highlight:true },
    ]);
    const notes = [
      sales.length > MAX_SALES ? `Only the first ${MAX_SALES} of ${sales.length} sales are listed; the totals cover all of them.` : "",
      salesTotals.uncosted > 0 ? "Profit counts only sales with a cost price (* = part of the sale has none). Add cost prices in Stock to include the rest." : "",
      "Each sale's profit uses the cost price saved when it was sold.",
    ].filter(Boolean);
    addTable([{ key:"n", label:"Notes", w:1 }], notes.map(n => ({ n })), { rowHeight: 6.5 });
    addSectionTitle("Income vs Expenses");
    addBarChart(bars);
    addSectionTitle("Category Breakdown");
    addTable(
      [{ key:"cat",   label:"Category", bold:true, w:0.35 },
       { key:"in_",   label:"Income",   right:true, color:()=>[22,163,74], w:0.20 },
       { key:"out_",  label:"Expenses", right:true, color:()=>[220,38,38], w:0.20 },
       { key:"net",   label:"Net",      right:true, w:0.14 },
       { key:"count", label:"Count",    right:true, w:0.11 }],
      Object.entries(byCat).sort((a,b)=>b[1].in-a[1].in).map(([cat,v])=>({
        cat, in_:fmtN(v.in), out_:fmtN(v.out), net:fmtN(v.in-v.out), count:v.count
      }))
    );
    addSectionTitle("Transaction Log");
    addTable(
      [{ key:"date",   label:"Date",     w:0.14 },
       { key:"item",   label:"Item",     bold:true, w:0.24 },
       { key:"type",   label:"Type",     bold:true, color:r=>r._t==="in"?[22,163,74]:[220,38,38], w:0.11 },
       { key:"amount", label:"Amount",   right:true, bold:true, w:0.17 },
       { key:"cat",    label:"Category", w:0.17 },
       { key:"pay",    label:"Payment",  w:0.17 }],
      tx.slice(0,80).map(t=>({
        date:fmtD(t.transaction_date), item:t.item_name||"—",
        type:t.type==="in"?"Income":"Expense", amount:fmtN(t.amount),
        cat:t.category||"—", pay:fmtPayType(t.payment_type), _t:t.type
      }))
    );
  } else if (type === "credit") {
    const { profits, totalDebt, totalPaid, totalOut, overdueCount, profitTotals: pt } = data;
    addStats([
      { label:"Total Debt",       value:fmtN(totalDebt), color:"#334155", bg:"#f8fafc" },
      { label:"Outstanding",      value:fmtN(totalOut),  color:"#ef4444", bg:"#fef2f2" },
      { label:"Recovered",        value:fmtN(totalPaid), color:"#16a34a", bg:"#f0fdf4" },
      { label:"Profit on Credit", value:fmtN(pt.profit), color:"#16a34a", bg:"#f0fdf4" },
    ]);
    addSectionTitle(`Credit Accounts — ${profits.length} account${profits.length===1?"":"s"}, ${overdueCount} overdue`);
    addTable(
      [{ key:"name",   label:"Customer", bold:true, w:0.20 },
       { key:"total",  label:"Total",    right:true, w:0.12 },
       { key:"cost",   label:"Cost",     right:true, color:()=>[100,99,94], w:0.11 },
       { key:"profit", label:"Profit",   right:true, bold:true, color:r=>r._p==null?[150,150,150]:[22,163,74], w:0.12 },
       { key:"paid",   label:"Paid",     right:true, color:()=>[22,163,74], w:0.11 },
       { key:"owed",   label:"Owed",     right:true, color:r=>r._s==="overdue"?[220,38,38]:null, w:0.11 },
       { key:"due",    label:"Due",      w:0.11 },
       { key:"status", label:"Status",   bold:true, color:r=>r._s==="overdue"?[220,38,38]:r._s==="paid"?[22,163,74]:null, w:0.12 }],
      profits.map(({ c, cost, profit, partial })=>({
        name:c.customer_name, total:fmtN(c.total_amount||0), cost:cost==null?"—":fmtN(cost),
        profit:profit==null?"No cost":fmtN(profit)+(partial?" *":""), _p:profit,
        paid:fmtN(c.amount_paid||0), owed:fmtN(c.outstanding||0), due:fmtD(c.due_date),
        status:(c.status||"active").replace(/_/g," ").toUpperCase(), _s:c.status
      }))
    );
    addTotalsBlock([
      { label:"Total credit given",          value:fmtN(totalDebt), bold:true },
      { label:"Cost of goods sold on credit", value:fmtN(pt.cost) },
      { label:"Profit on goods",              value:fmtN(pt.goods) },
      { label:"Interest",                     value:fmtN(pt.interest) },
      ...(pt.uncosted > 0 ? [{ label:"Credit with no item cost", value:fmtN(pt.uncosted) }] : []),
      { sep:true },
      { label:"Total profit on credit",       value:fmtN(pt.profit), bold:true, highlight:true },
    ]);
    addTable([{ key:"n", label:"Notes", w:1 }], [
      { n:"Profit is earned as customers repay. Goods profit uses each item's cost price saved when the credit was given." },
      ...(pt.uncosted > 0 ? [{ n:"* Part of this credit has no item cost (no items recorded, or credit added later), so its goods profit isn't counted." }] : []),
    ], { rowHeight: 6.5 });
  } else if (type === "aso") {
    const { active=[], totalBal, totContribs=0, totManual=0, totWithdrawals=0, totRegFees=0, totWdFees=0, totCommission=0, totProfit=0, bars=[] } = data;
    addStats([
      { label:"Savings Held",       value:fmtN(totalBal),              color:"#2E8020", bg:"#f0fdf4" },
      { label:"Period Collections", value:fmtN(totContribs+totManual), color:"#16a34a", bg:"#f0fdf4" },
      { label:"Period Withdrawals", value:fmtN(totWithdrawals),        color:"#ef4444", bg:"#fef2f2" },
      { label:"Ajo Profit",         value:fmtN(totProfit),             color:"#d97706", bg:"#fffbeb" },
    ]);
    if (bars.length > 0) {
      addSectionTitle("Collections by Client");
      addBarChart(bars);
    }
    addSectionTitle("Period Activity by Client");
    addTable(
      [{ key:"name",    label:"Client",       bold:true, w:0.22 },
       { key:"contribs",label:"Contributions",right:true, color:()=>[22,163,74], w:0.14 },
       { key:"manual",  label:"Manual Dep.",  right:true, w:0.12 },
       { key:"withdr",  label:"Withdrawals",  right:true, color:()=>[220,38,38], w:0.13 },
       { key:"fees",    label:"Profit",       right:true, bold:true, color:r=>Number(r._fees)>0?[22,163,74]:null, w:0.11 },
       { key:"net",     label:"Net",          right:true, bold:true, color:r=>Number(r._net)>=0?[46,128,32]:[220,38,38], w:0.13 },
       { key:"balance", label:"Balance",      right:true, w:0.15 }],
      active.map(c=>({
        name:c.full_name||"—",
        contribs:fmtN(c.p_contribs), manual:fmtN(c.p_manual),
        withdr:fmtN(c.p_withdrawals), fees:fmtN(c.p_profit),
        net:fmtN(c.p_net), balance:fmtN(c.current_balance||0),
        _fees:c.p_profit, _net:c.p_net,
      }))
    );
    addTotalsBlock([
      { label:"Registration fees", value:fmtN(totRegFees) },
      { label:"Withdrawal fees",   value:fmtN(totWdFees) },
      { label:"Commission",        value:fmtN(totCommission) },
      { sep:true },
      { label:"Total Ajo profit",  value:fmtN(totProfit), bold:true, highlight:true },
    ]);
    addTable([{ key:"n", label:"Notes", w:1 }], [
      { n:"Ajo profit = fees + commission earned from clients in this period. Savings held is the clients' money, held in trust — not profit." },
    ], { rowHeight: 6.5 });
  } else if (type === "bills") {
    const { bills, paid, total: billTotal, byCat, profitTotals: pt, failedCount, failedTotal } = data;
    addStats([
      { label:"Total Bills Paid", value:fmtN(billTotal),   color:"#ea580c", bg:"#fff7ed" },
      { label:"Bill Profit",      value:fmtN(pt.profit),   color:"#16a34a", bg:"#f0fdf4" },
      { label:"PIN Discount",     value:fmtN(pt.discount), color:"#0284c7", bg:"#eff6ff" },
      { label:"Cashback Earned",  value:fmtN(pt.cashback), color:"#d97706", bg:"#fffbeb" },
    ]);
    addSectionTitle("By Category");
    addTable(
      [{ key:"cat",    label:"Category", bold:true, w:0.40 },
       { key:"count",  label:"Count",    right:true, w:0.14 },
       { key:"total",  label:"Total",    right:true, bold:true, w:0.24 },
       { key:"profit", label:"Profit",   right:true, bold:true, color:r=>r._p>0?[22,163,74]:[150,150,150], w:0.22 }],
      Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total).map(([cat,v])=>({
        cat, count:v.count, total:fmtN(v.total), profit:fmtN(v.profit), _p:v.profit
      }))
    );
    addSectionTitle(`Bill Transactions — ${paid.length} paid${failedCount ? `, ${failedCount} failed` : ""}`);
    addTable(
      [{ key:"date",   label:"Date",       w:0.12 },
       { key:"item",   label:"Item",       bold:true, w:0.30 },
       { key:"cat",    label:"Category",   w:0.14 },
       { key:"amount", label:"Amount",     right:true, bold:true, color:r=>r._f?[150,150,150]:[234,88,12], w:0.14 },
       { key:"face",   label:"Face value", right:true, w:0.14 },
       { key:"profit", label:"Profit",     right:true, bold:true, color:r=>r._f?[150,150,150]:r._p>0?[22,163,74]:[150,150,150], w:0.16 }],
      bills.map(b=>({
        date:fmtD(b.t.transaction_date), item:b.t.item_name||"—", cat:b.t.category||"Bills",
        amount:b.failed ? "Refunded" : fmtN(b.t.amount), face:b.face!=null ? fmtN(b.face) : "—",
        profit:b.failed ? "Failed" : fmtN(b.profit), _p:b.profit, _f:b.failed,
      }))
    );
    addTotalsBlock([
      { label:`Total bills paid (${paid.length})`, value:fmtN(billTotal), bold:true },
      { label:"Discount on printed PINs",          value:fmtN(pt.discount) },
      { label:"Cashback earned (1%)",              value:fmtN(pt.cashback) },
      { sep:true },
      { label:"Total profit on bills",             value:fmtN(pt.profit), bold:true, highlight:true },
    ]);
    addTable([{ key:"n", label:"Notes", w:1 }], [
      { n:"Bill profit = the discount on printed airtime PINs and bundles (resold at face value) + 1% cashback on airtime and data. Other bills are costs." },
      ...(failedCount ? [{ n:`${failedCount} failed bill${failedCount===1?"":"s"} (${fmtN(failedTotal)}) were refunded and are not counted.` }] : []),
    ], { rowHeight: 6.5 });
  } else if (type === "staff") {
    const { rows, bars } = data;
    addStats([{ label:"Staff Members", value:rows.length, color:"#1d4ed8", bg:"#eff6ff" }]);
    addSectionTitle("Sales by Staff");
    addBarChart(bars);
    addSectionTitle("Staff Performance");
    addTable(
      [{ key:"name",     label:"Staff",     bold:true, w:0.26 },
       { key:"salesIn",  label:"Sales In",  right:true, color:()=>[22,163,74], w:0.18 },
       { key:"salesOut", label:"Sales Out", right:true, color:()=>[220,38,38], w:0.18 },
       { key:"txCount",  label:"Txns",      right:true, w:0.12 },
       { key:"credits",  label:"Credits",   right:true, w:0.13 },
       { key:"aso",      label:"Ajo",       right:true, w:0.13 }],
      rows.map(r=>({
        name:r.name, salesIn:fmtN(r.salesIn), salesOut:fmtN(r.salesOut),
        txCount:r.txCount, credits:r.creditsAdded, aso:r.asoContribs
      }))
    );
  } else if (type === "stock") {
    const { rows, totalRevenue, totals: tt, bars } = data;
    addStats([
      { label:"Revenue",        value:fmtN(totalRevenue),  color:"#0284c7", bg:"#eff6ff" },
      { label:"Cost of Goods",  value:fmtN(tt.cogs),       color:"#64748b", bg:"#f8fafc" },
      { label:"Stock Profit",   value:fmtN(tt.profit),     color:tt.profit>=0?"#16a34a":"#ef4444", bg:"#f0fdf4" },
      { label:"Spent on Stock", value:fmtN(tt.stockSpend), color:"#ef4444", bg:"#fef2f2" },
    ]);
    addSectionTitle("Revenue by Item");
    addBarChart(bars);
    addSectionTitle(`Item Profit — ${rows.length} item${rows.length===1?"":"s"}`);
    addTable(
      [{ key:"item",      label:"Item",      bold:true, w:0.25 },
       { key:"qtySold",   label:"Sold",      right:true, w:0.07 },
       { key:"revenue",   label:"Revenue",   right:true, bold:true, w:0.13 },
       { key:"cogs",      label:"Cost",      right:true, color:()=>[100,99,94], w:0.12 },
       { key:"profit",    label:"Profit",    right:true, bold:true, color:r=>r._p==null?[150,150,150]:r._p>=0?[22,163,74]:[220,38,38], w:0.13 },
       { key:"margin",    label:"Margin",    right:true, w:0.08 },
       { key:"qtyBought", label:"Bought",    right:true, w:0.08 },
       { key:"cost",      label:"Restock",   right:true, color:r=>r._c>0?[220,38,38]:[150,150,150], w:0.14 }],
      rows.map(r=>({
        item:r.item, qtySold:r.qtySold, revenue:fmtN(r.revenue), cogs:r.profit==null?"—":fmtN(r.cogs),
        profit:r.profit==null?(r.revenue>0?"No cost":"—"):fmtN(r.profit)+(r.partial?" *":""), _p:r.profit,
        margin:r.margin==null?"—":`${Math.round(r.margin*100)}%`, qtyBought:r.qtyBought||"—", cost:r.cost>0?fmtN(r.cost):"—", _c:r.cost
      }))
    );
    addTotalsBlock([
      { label:`Revenue (${tt.qtySold} sold)`, value:fmtN(totalRevenue), bold:true },
      { label:"Cost of goods sold",              value:fmtN(tt.cogs) },
      ...(tt.uncosted > 0 ? [{ label:"Sales with no cost price", value:fmtN(tt.uncosted) }] : []),
      { sep:true },
      { label:"Total profit on stock",           value:fmtN(tt.profit), bold:true, highlight:true },
    ]);
    addTable([{ key:"n", label:"Notes", w:1 }], [
      { n:"Profit = revenue − the cost price saved when each item was sold. Restock = what was spent buying the item in this period." },
      ...(tt.uncosted > 0 ? [{ n:"* Part of this item's sales have no cost price, so their profit isn't counted. Add cost prices in Stock." }] : []),
    ], { rowHeight: 6.5 });
  }

  await pdf.save(`KudiAITrack_${PNAMES[type] || "Report"}_Report_${from}_${to}.pdf`);
}

/* ── Main screen ────────────────────────────────────────────────────── */
export default function Reports({ store, onClose }) {
  const t = useT();
  const { transactions, credits, asoClients, profile, staffMap = {} } = store;
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar"], "business", "business.reports");
  const reportsAnnBars = camSlots.announcement_bar || [];

  const [reportType,       setReportType]       = useState("sales");
  const [period,           setPeriod]           = useState("month");
  const [customFrom,       setCustomFrom]       = useState(todayStr());
  const [customTo,         setCustomTo]         = useState(todayStr());
  const [preview,          setPreview]          = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [exportError,      setExportError]      = useState("");
  const [ajoContributions, setAjoContributions] = useState([]);
  const [asoLoading,       setAsoLoading]       = useState(false);
  // Products, only for the cost-price FALLBACK of old sales recorded before each sale saved its own cost price
  // (profitEngine.saleCost: the sale's saved cost always wins).
  const [products,         setProducts]         = useState([]);
  useEffect(() => {
    if ((reportType !== "sales" && reportType !== "stock") || !profile?.id) return;
    let cancelled = false;
    supabase.from("products").select("id, product_name, cost_price, needs_costing").eq("user_id", profile.id)
      .then(({ data }) => { if (!cancelled) setProducts(data || []); }, () => {});
    return () => { cancelled = true; };
  }, [reportType, profile?.id]);

  useEffect(() => {
    if (reportType !== "aso") return;
    const clientIds = asoClients.map(c => c.id);
    if (clientIds.length === 0) { setAjoContributions([]); return; }
    setAsoLoading(true);
    supabase
      .from("ajo_contributions")
      .select("id, aso_client_id, type, amount, status, payment_method, created_at")
      .in("aso_client_id", clientIds)
      .then(({ data }) => { setAjoContributions(data || []); setAsoLoading(false); })
      .catch(() => setAsoLoading(false));
  // asoClients.length used intentionally to avoid refetch on array identity change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, asoClients.length]);

  const REPORT_TYPES = useMemo(() => makeReportTypes(t), [t]);
  const PERIODS      = useMemo(() => makePeriods(t),      [t]);

  const { from, to } = periodRange(period, customFrom, customTo);

  const reportData = (() => {
    switch(reportType) {
      case "sales":  return buildSalesData(transactions, from, to, products);
      case "credit": return buildCreditData(credits);
      case "aso":    return buildAsoLedger(asoClients, ajoContributions, from, to);
      case "bills":  return buildBillsData(transactions, from, to);
      case "staff":  return buildStaffData(transactions, credits, asoClients, staffMap);
      case "stock":  return buildStockData(transactions, from, to, products);
      default:       return {};
    }
  })();

  const exportPDF = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      await buildNativeReportPDF(reportType, reportData, profile, from, to);
    } catch(e) {
      console.error("PDF export:", e);
      setExportError("Export failed — please try again.");
    }
    setExporting(false);
  };

  const exportCSV = async () => {
    setExportError("");
    try {
      let csv, filename;
      switch(reportType) {
        case "sales":
          csv = buildSalesReportCSV(reportData, from, to);
          filename = salesReportCSVFilename(from, to);
          break;
        case "credit":
          csv = buildCreditReportCSV(reportData);
          filename = creditReportCSVFilename();
          break;
        case "bills":
          csv = buildBillsReportCSV(reportData, from, to);
          filename = billsReportCSVFilename(from, to);
          break;
        case "stock":
          csv = buildStockReportCSV(reportData, from, to);
          filename = stockReportCSVFilename(from, to);
          break;
        case "aso":
          csv = buildAsoReportCSV(reportData, from, to);
          filename = asoReportCSVFilename(from, to);
          break;
        default:
          csv = buildStaffReportCSV(reportData?.rows || [], from, to);
          filename = staffReportCSVFilename(from, to);
      }
      await shareCSV(csv, filename);
    } catch(e) {
      console.error("CSV export:", e);
      setExportError("CSV export failed — please try again.");
    }
  };

  if (preview) {
    return (
      <div className="fixed inset-0 z-sheet bg-slate-100 dark:bg-slate-900 flex flex-col">
        {/* Preview header */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pb-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <button onClick={() => setPreview(false)}
            className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
              {REPORT_TYPES.find(r=>r.id===reportType)?.label}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{from===to?fmtD(from):`${fmtD(from)} — ${fmtD(to)}`}</p>
          </div>
          <button onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-sm transition active:scale-95 flex-shrink-0">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            CSV
          </button>
          <button onClick={exportPDF} disabled={exporting || asoLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition active:scale-95 disabled:opacity-50 flex-shrink-0">
            {exporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
                {t("report.exporting")}
              </>
            ) : (
              <>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                {t("report.exportPDF")}
              </>
            )}
          </button>
        </div>

        {/* Aso loading overlay */}
        {asoLoading && reportType === "aso" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/80 dark:bg-slate-900/80">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin"/>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading Ajo data…</p>
            </div>
          </div>
        )}

        {/* Export error */}
        {exportError && (
          <div className="mx-4 mt-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl">
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">{exportError}</p>
          </div>
        )}

        {/* Report preview — always 794px wide, scaled to fit screen */}
        <div className="flex-1 overflow-y-auto bg-slate-300 dark:bg-slate-700 relative">
          <div className="py-4 flex justify-center">
            <div style={{
              zoom: Math.min(1, (window.innerWidth - 16) / 794),
              width: 794,
              flexShrink: 0,
            }}>
              <div style={{width: 794, background:"#fff", boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
                <ReportTemplate
                  type={reportType}
                  reportData={reportData}
                  profile={profile}
                  from={from}
                  to={to}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-sheet bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pb-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <button onClick={onClose}
          className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div>
          <p className="text-lg font-black text-slate-800 dark:text-white">{t("report.title")}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t("report.subtitle")}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">

        <AnnouncementBarSlot campaigns={reportsAnnBars} loading={camLoading} recordEvent={recordCamEvent} />

        {/* Report type grid */}
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">{t("report.selectType")}</p>
        <div className="grid grid-cols-2 gap-2.5 mb-6">
          {REPORT_TYPES.map(rt => (
            <button key={rt.id} onClick={() => setReportType(rt.id)}
              className={`text-left p-3.5 rounded-2xl border-2 transition-all active:scale-[0.97] ${
                reportType === rt.id
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20 shadow-md"
                  : `${rt.color} ${rt.border}`
              }`}>
              <span className="text-2xl leading-none block mb-2">{rt.icon}</span>
              <p className={`text-xs font-extrabold leading-tight ${reportType===rt.id?"text-green-700 dark:text-green-400":"text-slate-700 dark:text-slate-200"}`}>{rt.label}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-tight">{rt.sub}</p>
            </button>
          ))}
        </div>

        {/* Period selector */}
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">{t("report.period")}</p>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-3 rounded-full text-xs font-bold transition-all active:scale-95 min-h-[44px] inline-flex items-center ${
                period === p.id
                  ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {period === "custom" && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-5 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t("report.from")}</p>
              <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none"/>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t("report.to")}</p>
              <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none"/>
            </div>
          </div>
        )}

        {/* Selected range display */}
        {period !== "custom" && (
          <div className="bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2.5 mb-5 flex items-center gap-2">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-slate-400 flex-shrink-0">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-bold text-slate-700 dark:text-slate-200">{fmtD(from)}</span>
              {from !== to && <> → <span className="font-bold text-slate-700 dark:text-slate-200">{fmtD(to)}</span></>}
            </p>
          </div>
        )}

        {/* New-business empty state */}
        {transactions.length === 0 && credits.length === 0 && asoClients.length === 0 && (
          <div className="mb-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/40 rounded-2xl px-4 py-4 text-center">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">No data yet</p>
            <p className="text-xs text-brand-600/70 dark:text-brand-400/70 mt-1 leading-relaxed">Add some transactions to generate your first report. The report will show zeroes until then.</p>
          </div>
        )}

        {/* Aso loading indicator (in main screen) */}
        {asoLoading && reportType === "aso" && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0"/>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading Ajo contributions…</p>
          </div>
        )}

        {/* Generate button */}
        <button onClick={() => setPreview(true)} disabled={asoLoading && reportType === "aso"}
          className="w-full py-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.98] shadow-lg flex items-center justify-center gap-2">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
          </svg>
          {t("report.generate")} {REPORT_TYPES.find(r=>r.id===reportType)?.label}
        </button>

        <div className="h-10" />
      </div>
    </div>
  );
}
