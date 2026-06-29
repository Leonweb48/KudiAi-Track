import { useState, useMemo, useRef } from "react";
import { jsPDF }      from "jspdf";
import html2canvas    from "html2canvas";
import { fmt }        from "../utils/helpers";
import { useT }       from "../contexts/LanguageContext";
import { savePdf }    from "../utils/pdfSave";

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
function buildSalesData(transactions, from, to) {
  const tx = transactions.filter(t => inRange(t.transaction_date, from, to));
  const cashIn  = tx.filter(t=>t.type==="in").reduce((s,t)=>s+t.amount,0);
  const cashOut = tx.filter(t=>t.type==="out").reduce((s,t)=>s+t.amount,0);

  // Daily bars
  const datesInRange = [];
  let cur = from;
  while (cur <= to) { datesInRange.push(cur); cur = addDays(cur,1); if(datesInRange.length>60) break; }

  const byDate = {};
  tx.forEach(t => {
    if (!byDate[t.transaction_date]) byDate[t.transaction_date] = {v1:0,v2:0};
    if (t.type==="in") byDate[t.transaction_date].v1 += t.amount;
    else               byDate[t.transaction_date].v2 += t.amount;
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

  return { tx, cashIn, cashOut, profit: cashIn-cashOut, bars, byCat };
}

function buildCreditData(credits) {
  const totalDebt = credits.reduce((s,c)=>s+(c.total_amount||0),0);
  const totalPaid = credits.reduce((s,c)=>s+(c.amount_paid||0),0);
  const totalOut  = credits.reduce((s,c)=>s+(c.outstanding||0),0);
  const overdue   = credits.filter(c=>c.status==="overdue");
  return { credits, totalDebt, totalPaid, totalOut, overdueCount: overdue.length, overdueDue: overdue.reduce((s,c)=>s+c.outstanding,0) };
}

function buildAsoData(asoClients) {
  const totalBal    = asoClients.reduce((s,c)=>s+(c.current_balance||0),0);
  const totalSaved  = asoClients.reduce((s,c)=>s+(c.total_saved||0),0);
  const totalWithdr = asoClients.reduce((s,c)=>s+(c.total_withdrawn||0),0);
  const FREQ = {daily:1,weekly:7,monthly:30};
  const enriched = asoClients.map(c => {
    const days = FREQ[c.contribution_frequency]||30;
    const since = c.registration_date
      ? Math.floor((new Date()-new Date(c.registration_date))/86400000)
      : 0;
    const expected = Math.floor(since/days);
    const made     = c.contribution_amount>0 ? Math.floor((c.total_saved||0)/c.contribution_amount) : 0;
    const missed   = Math.max(0, expected-made);
    return { ...c, made, expected, missed };
  });
  const bars = asoClients.slice(0,20).map(c=>({
    label: (c.full_name||"?").split(" ")[0],
    v: c.current_balance||0, color:"#7c3aed"
  }));
  return { enriched, totalBal, totalSaved, totalWithdr, bars };
}

function buildBillsData(transactions, from, to) {
  const bills = transactions.filter(t => t.payment_type==="bill_payment" && inRange(t.transaction_date,from,to));
  const total = bills.reduce((s,t)=>s+t.amount,0);
  const byCat = {};
  bills.forEach(t => {
    const k=t.category||"Bills";
    if(!byCat[k]) byCat[k]={total:0,count:0};
    byCat[k].total+=t.amount; byCat[k].count++;
  });
  return { bills, total, byCat };
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

function buildStockData(transactions, from, to) {
  const tx = transactions.filter(t => inRange(t.transaction_date,from,to) && t.item_name);
  const byItem = {};
  tx.forEach(t => {
    const k = t.item_name;
    if (!byItem[k]) byItem[k] = { item:k, category:t.category||"—", qtySold:0, revenue:0, qtyBought:0, cost:0 };
    if (t.type==="in") { byItem[k].qtySold += (t.quantity||1); byItem[k].revenue += t.amount; }
    else               { byItem[k].qtyBought += (t.quantity||1); byItem[k].cost   += t.amount; }
  });
  const rows = Object.values(byItem).sort((a,b)=>b.revenue-a.revenue);
  const totalRevenue = rows.reduce((s,r)=>s+r.revenue,0);
  const bars = rows.slice(0,12).map(r=>({ label:r.item.slice(0,8), v:r.revenue, color:"#0284c7" }));
  return { rows, totalRevenue, bars };
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
    pay: t.payment_type||"—",
    _type: t.type,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Cash In",    value:fmt(data.cashIn),  color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Cash Out",   value:fmt(data.cashOut), color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
        { label:"Net Profit", value:fmt(data.profit),  color: data.profit>=0?"#16a34a":"#ef4444", bg:"#f8fafc", border:"#e2e8f0" },
        { label:"Transactions", value:data.tx.length,  color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
      ]}/>
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
  const rows = data.credits.map(c=>({
    name:  c.customer_name,
    phone: c.phone||"—",
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
        { label:"Overdue Accs", value:data.overdueCount,      color:"#dc2626", bg:"#fff1f2",   border:"#fecdd3" },
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
          {key:"name",  label:"Customer",    bold:true, w:"19%"},
          {key:"phone", label:"Phone",                  w:"12%"},
          {key:"total", label:"Total",       right:true, w:"11%"},
          {key:"paid",  label:"Paid",        right:true, color:()=>"#16a34a", w:"11%"},
          {key:"owed",  label:"Owed",        right:true, bold:true, color:r=>r._s==="overdue"?"#dc2626":"#ef4444", w:"12%"},
          {key:"due",   label:"Due Date",               w:"13%"},
          {key:"status",label:"Status",      color:r=>r._s==="overdue"?"#dc2626":r._s==="paid"?"#16a34a":"#64748b", bold:true, w:"14%"},
          {key:"late",  label:"Late",        right:true, color:r=>r.late!=="—"?"#dc2626":"#94a3b8", w:"8%"},
        ]}
        rows={rows}
        highlight={r=>r._s==="overdue"?"#fff5f5":undefined}/>
    </div>
  );
}

function AsoSection({ data }) {
  const rows = data.enriched.map(c=>({
    name:    c.full_name,
    freq:    c.contribution_frequency,
    contrib: fmt(c.contribution_amount||0),
    saved:   fmt(c.total_saved||0),
    withdr:  fmt(c.total_withdrawn||0),
    balance: fmt(c.current_balance||0),
    made:    c.made,
    missed:  c.missed,
    next:    fmtD(c.next_contribution_date),
    status:  c.status,
    _m:      c.missed,
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Total Balance",   value:fmt(data.totalBal),    color:"#7c3aed", bg:"#faf5ff", border:"#e9d5ff" },
        { label:"Total Saved",     value:fmt(data.totalSaved),  color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Total Withdrawn", value:fmt(data.totalWithdr), color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
        { label:"Clients",         value:data.enriched.length,  color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
      ]}/>
      {data.bars.length > 0 && (<>
        <SectionTitle>Balance by Client</SectionTitle>
        <BarChart bars={data.bars} maxH={110}/>
      </>)}
      <SectionTitle>Client Details</SectionTitle>
      <Table
        cols={[
          {key:"name",   label:"Name",        bold:true, w:"20%"},
          {key:"freq",   label:"Frequency",              w:"11%"},
          {key:"contrib",label:"Contrib",     right:true, w:"13%"},
          {key:"saved",  label:"Saved",       right:true, color:()=>"#16a34a", w:"13%"},
          {key:"balance",label:"Balance",     right:true, bold:true, color:()=>"#7c3aed", w:"13%"},
          {key:"made",   label:"Paid",        right:true, w:"8%"},
          {key:"missed", label:"Missed",      right:true, color:r=>r._m>0?"#dc2626":"#94a3b8", bold:true, w:"8%"},
          {key:"next",   label:"Next Due",               w:"14%"},
        ]}
        rows={rows}
        highlight={r=>r._m>0?"#fff5f5":undefined}/>
    </div>
  );
}

function BillsSection({ data }) {
  const catRows = Object.entries(data.byCat).sort((a,b)=>b[1].total-a[1].total).map(([cat,v])=>({
    cat, total:fmt(v.total), count:v.count, avg:fmt(v.total/v.count)
  }));
  const rows = data.bills.slice(0,60).map(t=>({
    date: fmtD(t.transaction_date),
    item: t.item_name||"—",
    cat:  t.category||"—",
    amount: fmt(t.amount),
    pay:  t.payment_type||"—",
    note: t.note||"—",
  }));
  return (
    <div>
      <StatGrid stats={[
        { label:"Total Bills Paid", value:fmt(data.total),    color:"#dc2626", bg:"#fef2f2", border:"#fecaca" },
        { label:"Transactions",    value:data.bills.length,  color:"#64748b", bg:"#f8fafc", border:"#e2e8f0" },
        { label:"Avg per Bill",    value:fmt(data.bills.length?data.total/data.bills.length:0), color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
        { label:"Categories",      value:Object.keys(data.byCat).length, color:"#7c3aed", bg:"#faf5ff", border:"#e9d5ff" },
      ]}/>
      <SectionTitle>By Category</SectionTitle>
      <Table
        cols={[
          {key:"cat",  label:"Category",    bold:true, w:"42%"},
          {key:"total",label:"Total Paid",  right:true, bold:true, color:()=>"#dc2626", w:"26%"},
          {key:"count",label:"Count",       right:true, w:"14%"},
          {key:"avg",  label:"Avg/Bill",    right:true, w:"18%"},
        ]}
        rows={catRows}/>
      <SectionTitle>Bill Transactions</SectionTitle>
      <Table
        cols={[
          {key:"date",  label:"Date",     w:"14%"},
          {key:"item",  label:"Item",     bold:true, w:"30%"},
          {key:"cat",   label:"Category", w:"20%"},
          {key:"amount",label:"Amount",   right:true, bold:true, color:()=>"#dc2626", w:"18%"},
          {key:"pay",   label:"Payment",  w:"18%"},
        ]}
        rows={rows}/>
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
  return (
    <div>
      <StatGrid stats={[
        { label:"Unique Items",   value:data.rows.length,           color:"#0284c7", bg:"#eff6ff", border:"#bfdbfe" },
        { label:"Total Revenue",  value:fmt(data.totalRevenue),     color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
        { label:"Items Tracked",  value:data.rows.reduce((s,r)=>s+r.qtySold,0), color:"#334155", bg:"#f8fafc", border:"#e2e8f0" },
        { label:"Top Item",       value:data.rows[0]?.item?.slice(0,12)||"—", color:"#7c3aed", bg:"#faf5ff", border:"#e9d5ff" },
      ]}/>
      {data.bars.length > 0 && (<>
        <SectionTitle>Revenue by Item</SectionTitle>
        <BarChart bars={data.bars} maxH={110}/>
      </>)}
      <SectionTitle>Item Performance</SectionTitle>
      <Table
        cols={[
          {key:"item",     label:"Item",      bold:true, w:"24%"},
          {key:"category", label:"Category",            w:"15%"},
          {key:"qtySold",  label:"Qty Sold",  right:true, w:"10%"},
          {key:"revenue",  label:"Revenue",   right:true, bold:true, color:()=>"#16a34a", w:"15%"},
          {key:"qtyBought",label:"Qty Bought",right:true, w:"11%"},
          {key:"cost",     label:"Cost",      right:true, color:()=>"#ef4444", w:"13%"},
          {key:"margin",   label:"Margin",    right:true, bold:true, w:"12%"},
        ]}
        rows={data.rows.map(r=>({...r,revenue:fmt(r.revenue),cost:fmt(r.cost),margin:fmt(r.revenue-r.cost)}))}/>
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
      <div style={{background:"linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%)",padding:"28px 36px 22px",display:"flex",alignItems:"center",gap:16}}>
        <div style={{width:52,height:52,borderRadius:12,background:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden",padding:4}}>
          <img src="/logo.png" alt="KudiAI" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
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
      <div style={{background:"#f0fdf4",borderBottom:"3px solid #16a34a",padding:"14px 36px"}}>
        <p style={S({color:"#16a34a",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:2,margin:"0 0 3px"})}>{TITLES[type]}</p>
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
    { id:"aso",    label:t("report.ajo"),    sub:"Savings clients, contributions & balance",  icon:"🏦", color:"bg-violet-50 dark:bg-violet-900/20",border:"border-violet-200 dark:border-violet-800",active:"bg-violet-600"},
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

/* eslint-disable no-unused-vars, no-undef */
function hexToRgb(hex) {
  if (!hex || !hex.startsWith("#")) return [51, 65, 85];
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
async function buildNativeReportPDF(type, data, profile, from, to) {
  const doc = new jsPDF({ orientation:"p", unit:"mm", format:"a4" });
  const W  = doc.internal.pageSize.getWidth();
  const H  = doc.internal.pageSize.getHeight();
  const M  = 10;
  const CW = W - 2*M;
  const fmtN = n => `N${Number(n||0).toLocaleString("en-NG",{minimumFractionDigits:2})}`;

  const TNAMES = {
    sales:"Sales Report", credit:"Credit Report", aso:"Ajo Savings Report",
    bills:"Bills Report", staff:"Staff Performance Report", stock:"Stock Report",
  };
  const THEME = {
    sales:[22,163,74], credit:[220,38,38], aso:[124,58,237],
    bills:[234,88,12], staff:[37,99,235],  stock:[14,116,144],
  };
  const tc  = THEME[type] || [22,163,74];
  const biz = profile?.business_name || "My Business";
  const prd = from===to ? fmtD(from) : `${fmtD(from)} - ${fmtD(to)}`;

  // Header band
  doc.setFillColor(...tc);
  doc.rect(0,0,W,28,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold");
  doc.setFontSize(8);
  doc.text("KudiAI Track", W/2, 8, {align:"center"});
  doc.setFontSize(13);
  doc.text(biz, W/2, 18, {align:"center"});
  doc.setFontSize(8);
  doc.setFont("helvetica","normal");
  doc.text(`${TNAMES[type]}  .  ${prd}`, W/2, 26, {align:"center"});

  let y = 36;

  function newPage() { doc.addPage(); y = 14; }
  function need(h)   { if (y+h > H-14) newPage(); }

  function sectionTitle(title) {
    need(16); y += 3;
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
    doc.setTextColor(...tc);
    doc.text(title.toUpperCase(), M, y);
    doc.setDrawColor(226,232,240); doc.setLineWidth(0.3);
    doc.line(M, y+2, W-M, y+2);
    y += 9;
  }

  function drawStats(stats) {
    const bw=(CW-4)/2, bh=18;
    for (let i=0; i<stats.length; i+=2) {
      need(bh+3);
      for (let j=0; j<2 && i+j<stats.length; j++) {
        const s=stats[i+j], x=M+j*(bw+4);
        const bg=typeof s.bg==="string"?hexToRgb(s.bg):[248,250,252];
        doc.setFillColor(...bg); doc.rect(x,y,bw,bh,"F");
        doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(148,163,184);
        doc.text(String(s.label||"").toUpperCase(), x+4, y+6);
        const vc=typeof s.color==="string"?hexToRgb(s.color):[30,41,59];
        doc.setTextColor(...vc); doc.setFont("helvetica","bold"); doc.setFontSize(11);
        doc.text(String(s.value??""), x+4, y+14, {maxWidth:bw-6});
      }
      y += bh+3;
    }
    y += 2;
  }

  function drawBarChart(bars) {
    if (!bars?.length) return;
    const ch=40;
    need(ch+18);
    const maxV=Math.max(...bars.map(b=>Math.max(b.v1||0,b.v2||b.v||0)),1);
    const slot=CW/bars.length;
    const bw=Math.min(slot*0.4,7);
    const isDual=bars[0]?.v1!==undefined;
    doc.setDrawColor(226,232,240); doc.setLineWidth(0.2);
    [0.25,0.5,0.75,1].forEach(f=>{ const ly=y+ch-ch*f; doc.line(M,ly,W-M,ly); });
    const skip=Math.ceil(bars.length/14);
    bars.forEach((b,i)=>{
      const cx=M+i*slot+slot/2;
      if (isDual) {
        const h1=Math.max(0.5,(b.v1/maxV)*ch), h2=Math.max(0.5,(b.v2/maxV)*ch);
        doc.setFillColor(22,163,74);  doc.rect(cx-bw-0.5, y+ch-h1, bw, h1, "F");
        doc.setFillColor(239,68,68);  doc.rect(cx+0.5,    y+ch-h2, bw, h2, "F");
      } else {
        const h=Math.max(0.5,((b.v||0)/maxV)*ch);
        doc.setFillColor(...(b.color?hexToRgb(b.color):tc));
        doc.rect(cx-bw/2, y+ch-h, bw, h, "F");
      }
      if (i%skip===0) {
        doc.setFont("helvetica","normal"); doc.setFontSize(5.5); doc.setTextColor(100,116,139);
        doc.text(String(b.label||"").slice(0,7), cx, y+ch+5, {align:"center"});
      }
    });
    y += ch+10;
    if (isDual) {
      doc.setFillColor(22,163,74);  doc.rect(M,    y, 5, 3.5, "F");
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(100,116,139);
      doc.text("Income",   M+7,  y+3);
      doc.setFillColor(239,68,68); doc.rect(M+30, y, 5, 3.5, "F");
      doc.text("Expenses", M+37, y+3);
      y += 8;
    }
  }

  function drawTable(cols, rows) {
    const rh=6.5;
    need(rh*2);
    const drawHdr=()=>{
      doc.setFillColor(241,245,249); doc.rect(M,y,CW,rh,"F");
      doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(71,85,105);
      let x=M+2;
      cols.forEach(c=>{
        const cw=CW*(parseFloat(c.w)||1/cols.length);
        if (c.right) doc.text(String(c.label||"").toUpperCase(), x+cw-3, y+4.5, {align:"right"});
        else         doc.text(String(c.label||"").toUpperCase(), x, y+4.5);
        x+=cw;
      });
      y+=rh;
    };
    drawHdr();
    if (!rows?.length) {
      doc.setFont("helvetica","italic"); doc.setFontSize(7); doc.setTextColor(148,163,184);
      doc.text("No data for this period", M+CW/2, y+5, {align:"center"}); y+=10; return;
    }
    rows.forEach((r,ri)=>{
      if (y+rh>H-14) { newPage(); drawHdr(); }
      if (ri%2===1) { doc.setFillColor(248,250,252); doc.rect(M,y,CW,rh,"F"); }
      doc.setDrawColor(241,245,249); doc.setLineWidth(0.15); doc.line(M,y+rh,W-M,y+rh);
      let x=M+2;
      cols.forEach(c=>{
        const cw=CW*(parseFloat(c.w)||1/cols.length);
        const val=String(r[c.key]??"—");
        if (c.color) {
          const hx=typeof c.color==="function"?c.color(r):c.color;
          doc.setTextColor(...(hx&&hx.startsWith("#")?hexToRgb(hx):[51,65,85]));
        } else { doc.setTextColor(51,65,85); }
        doc.setFont("helvetica", c.bold?"bold":"normal"); doc.setFontSize(7);
        if (c.right) doc.text(val, x+cw-3, y+4.5, {align:"right", maxWidth:cw-4});
        else         doc.text(val, x, y+4.5, {maxWidth:cw-3});
        x+=cw;
      });
      y+=rh;
    });
    y+=4;
  }

  /* ── report sections ── */
  if (type==="sales") {
    const {cashIn,cashOut,profit,tx,bars,byCat}=data;
    drawStats([
      {label:"Cash In",     value:fmtN(cashIn),  color:"#16a34a",bg:"#f0fdf4"},
      {label:"Cash Out",    value:fmtN(cashOut), color:"#ef4444",bg:"#fef2f2"},
      {label:"Net Profit",  value:fmtN(profit),  color:profit>=0?"#16a34a":"#ef4444",bg:"#f8fafc"},
      {label:"Transactions",value:tx.length,     color:"#0284c7",bg:"#eff6ff"},
    ]);
    sectionTitle("Income vs Expenses");
    drawBarChart(bars);
    sectionTitle("Category Breakdown");
    drawTable(
      [{key:"cat",  label:"Category", bold:true, w:0.35},
       {key:"in_",  label:"Income",   right:true, color:()=>"#16a34a", w:0.20},
       {key:"out_", label:"Expenses", right:true, color:()=>"#ef4444", w:0.20},
       {key:"net",  label:"Net",      right:true, w:0.14},
       {key:"count",label:"Count",    right:true, w:0.11}],
      Object.entries(byCat).sort((a,b)=>b[1].in-a[1].in).map(([cat,v])=>({
        cat, in_:fmtN(v.in), out_:fmtN(v.out), net:fmtN(v.in-v.out), count:v.count
      }))
    );
    sectionTitle("Transaction Log");
    drawTable(
      [{key:"date",  label:"Date",     w:0.14},
       {key:"item",  label:"Item",     bold:true, w:0.24},
       {key:"type",  label:"Type",     bold:true, color:r=>r._t==="in"?"#16a34a":"#ef4444", w:0.11},
       {key:"amount",label:"Amount",   right:true, bold:true, w:0.17},
       {key:"cat",   label:"Category", w:0.17},
       {key:"pay",   label:"Payment",  w:0.17}],
      tx.slice(0,80).map(t=>({
        date:fmtD(t.transaction_date), item:t.item_name||"—",
        type:t.type==="in"?"Income":"Expense", amount:fmtN(t.amount),
        cat:t.category||"—", pay:t.payment_type||"—", _t:t.type
      }))
    );
  }
  else if (type==="credit") {
    const {credits,totalDebt,totalPaid,totalOut,overdueCount,overdueDue}=data;
    drawStats([
      {label:"Total Debt",  value:fmtN(totalDebt),  color:"#334155",bg:"#f8fafc"},
      {label:"Outstanding", value:fmtN(totalOut),   color:"#ef4444",bg:"#fef2f2"},
      {label:"Recovered",   value:fmtN(totalPaid),  color:"#16a34a",bg:"#f0fdf4"},
      {label:"Overdue Accs",value:overdueCount,     color:"#dc2626",bg:"#fff1f2"},
    ]);
    if (overdueCount>0) {
      need(14);
      doc.setFillColor(254,242,242); doc.rect(M,y,CW,12,"F");
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(220,38,38);
      doc.text(`${overdueCount} overdue account${overdueCount>1?"s":""}  -  ${fmtN(overdueDue)} outstanding`, M+4, y+8);
      y+=16;
    }
    sectionTitle("Credit Accounts");
    drawTable(
      [{key:"name",  label:"Customer", bold:true, w:0.24},
       {key:"total", label:"Total",    right:true, w:0.16},
       {key:"paid",  label:"Paid",     right:true, color:()=>"#16a34a", w:0.16},
       {key:"owed",  label:"Owed",     right:true, color:r=>r._s==="overdue"?"#ef4444":undefined, w:0.16},
       {key:"due",   label:"Due Date", w:0.14},
       {key:"status",label:"Status",   bold:true, color:r=>r._s==="overdue"?"#ef4444":r._s==="paid"?"#16a34a":undefined, w:0.14}],
      credits.map(c=>({
        name:c.customer_name, total:fmtN(c.total_amount||0), paid:fmtN(c.amount_paid||0),
        owed:fmtN(c.outstanding||0), due:fmtD(c.due_date),
        status:(c.status||"active").replace(/_/g," ").toUpperCase(), _s:c.status
      }))
    );
  }
  else if (type==="aso") {
    const {enriched,totalBal,totalSaved,totalWithdr,bars}=data;
    drawStats([
      {label:"Total Balance",  value:fmtN(totalBal),   color:"#7c3aed",bg:"#f5f3ff"},
      {label:"Total Saved",    value:fmtN(totalSaved), color:"#16a34a",bg:"#f0fdf4"},
      {label:"Total Withdrawn",value:fmtN(totalWithdr),color:"#334155",bg:"#f8fafc"},
      {label:"Total Clients",  value:enriched.length,  color:"#0284c7",bg:"#eff6ff"},
    ]);
    sectionTitle("Balance by Client");
    drawBarChart(bars);
    sectionTitle("Client Details");
    drawTable(
      [{key:"name", label:"Client",       bold:true, w:0.24},
       {key:"freq", label:"Frequency",    w:0.15},
       {key:"amt",  label:"Contribution", right:true, w:0.18},
       {key:"bal",  label:"Balance",      right:true, bold:true, color:()=>"#7c3aed", w:0.18},
       {key:"saved",label:"Total Saved",  right:true, w:0.14},
       {key:"miss", label:"Missed",       right:true, color:r=>Number(r.miss)>0?"#ef4444":undefined, w:0.11}],
      enriched.map(c=>({
        name:c.full_name||"—", freq:c.contribution_frequency||"—",
        amt:fmtN(c.contribution_amount||0), bal:fmtN(c.current_balance||0),
        saved:fmtN(c.total_saved||0), miss:c.missed
      }))
    );
  }
  else if (type==="bills") {
    const {bills, total: billTotal, byCat}=data;
    drawStats([
      {label:"Total Bills",value:fmtN(billTotal),color:"#ea580c",bg:"#fff7ed"},
      {label:"Bill Count", value:bills.length,   color:"#0284c7",bg:"#eff6ff"},
    ]);
    sectionTitle("By Category");
    drawTable(
      [{key:"cat",  label:"Category",bold:true, w:0.50},
       {key:"count",label:"Count",   right:true, w:0.20},
       {key:"total",label:"Total",   right:true, bold:true, w:0.30}],
      Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total).map(([cat,v])=>({
        cat, count:v.count, total:fmtN(v.total)
      }))
    );
    sectionTitle("Bill Transactions");
    drawTable(
      [{key:"date",  label:"Date",     w:0.18},
       {key:"item",  label:"Item",     bold:true, w:0.36},
       {key:"cat",   label:"Category", w:0.22},
       {key:"amount",label:"Amount",   right:true, bold:true, color:()=>"#ea580c", w:0.24}],
      bills.map(t=>({
        date:fmtD(t.transaction_date), item:t.item_name||"—",
        cat:t.category||"Bills", amount:fmtN(t.amount)
      }))
    );
  }
  else if (type==="staff") {
    const {rows,bars}=data;
    drawStats([{label:"Staff Members",value:rows.length,color:"#1d4ed8",bg:"#eff6ff"}]);
    sectionTitle("Sales by Staff");
    drawBarChart(bars);
    sectionTitle("Staff Performance");
    drawTable(
      [{key:"name",    label:"Staff",     bold:true, w:0.26},
       {key:"salesIn", label:"Sales In",  right:true, color:()=>"#16a34a", w:0.18},
       {key:"salesOut",label:"Sales Out", right:true, color:()=>"#ef4444", w:0.18},
       {key:"txCount", label:"Txns",      right:true, w:0.12},
       {key:"credits", label:"Credits",   right:true, w:0.13},
       {key:"aso",     label:"Ajo",       right:true, w:0.13}],
      rows.map(r=>({
        name:r.name, salesIn:fmtN(r.salesIn), salesOut:fmtN(r.salesOut),
        txCount:r.txCount, credits:r.creditsAdded, aso:r.asoContribs
      }))
    );
  }
  else if (type==="stock") {
    const {rows,totalRevenue,bars}=data;
    drawStats([
      {label:"Total Revenue",value:fmtN(totalRevenue),color:"#0e7490",bg:"#ecfeff"},
      {label:"Unique Items", value:rows.length,       color:"#0284c7",bg:"#eff6ff"},
    ]);
    sectionTitle("Revenue by Item");
    drawBarChart(bars);
    sectionTitle("Item Details");
    drawTable(
      [{key:"item",      label:"Item",      bold:true, w:0.28},
       {key:"cat",       label:"Category",  w:0.18},
       {key:"qtySold",   label:"Qty Sold",  right:true, w:0.13},
       {key:"revenue",   label:"Revenue",   right:true, bold:true, color:()=>"#16a34a", w:0.17},
       {key:"qtyBought", label:"Bought",    right:true, w:0.13},
       {key:"cost",      label:"Cost",      right:true, color:()=>"#ef4444", w:0.11}],
      rows.map(r=>({
        item:r.item, cat:r.category, qtySold:r.qtySold, revenue:fmtN(r.revenue),
        qtyBought:r.qtyBought, cost:fmtN(r.cost)
      }))
    );
  }

  // Footer on every page
  const totalPg = doc.internal.getNumberOfPages();
  const genDate = new Date().toLocaleString("en-NG");
  for (let i=1; i<=totalPg; i++) {
    doc.setPage(i);
    doc.setFillColor(248,250,252); doc.rect(0, H-10, W, 10, "F");
    doc.setDrawColor(226,232,240); doc.setLineWidth(0.2); doc.line(0, H-10, W, H-10);
    doc.setFont("helvetica","italic"); doc.setFontSize(6); doc.setTextColor(148,163,184);
    doc.text(
      `Generated by KudiAI Track  .  ${genDate}  .  Page ${i} of ${totalPg}`,
      W/2, H-5, {align:"center"}
    );
  }

  const PNAMES={sales:"Sales",credit:"Credit",aso:"Ajo",bills:"Bills",staff:"Staff",stock:"Stock"};
  await savePdf(doc, `KudiAITrack_${PNAMES[type]}_Report_${from}_${to}.pdf`);
}
/* eslint-enable no-unused-vars, no-undef */

/* ── Main screen ────────────────────────────────────────────────────── */
export default function Reports({ store, onClose }) {
  const t = useT();
  const { transactions, credits, asoClients, profile, staffMap = {} } = store;

  const [reportType, setReportType] = useState("sales");
  const [period,     setPeriod]     = useState("month");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo,   setCustomTo]   = useState(todayStr());
  const [preview,    setPreview]    = useState(false);
  const [exporting,  setExporting]  = useState(false);

  const REPORT_TYPES = useMemo(() => makeReportTypes(t), [t]);
  const PERIODS      = useMemo(() => makePeriods(t),      [t]);

  const { from, to } = periodRange(period, customFrom, customTo);

  const reportData = (() => {
    switch(reportType) {
      case "sales":  return buildSalesData(transactions, from, to);
      case "credit": return buildCreditData(credits);
      case "aso":    return buildAsoData(asoClients);
      case "bills":  return buildBillsData(transactions, from, to);
      case "staff":  return buildStaffData(transactions, credits, asoClients, staffMap);
      case "stock":  return buildStockData(transactions, from, to);
      default:       return {};
    }
  })();

  const reportRef = useRef(null);
  const PNAMES = {sales:"Sales",credit:"Credit",aso:"Ajo",bills:"Bills",staff:"Staff",stock:"Stock"};

  const exportPDF = async () => {
    if (exporting || !reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, { scale:2, useCORS:true, allowTaint:true, logging:false });
      const imgData = canvas.toDataURL("image/png");
      const doc = new jsPDF({ unit:"mm", format:"a4" });
      const pgW = doc.internal.pageSize.getWidth();
      const pgH = doc.internal.pageSize.getHeight();
      const imgH = (canvas.height / canvas.width) * pgW;
      let posY = 0;
      while (posY < imgH) {
        if (posY > 0) doc.addPage();
        doc.addImage(imgData, "PNG", 0, -posY, pgW, imgH);
        posY += pgH;
      }
      await savePdf(doc, `KudiAITrack_${PNAMES[reportType]||reportType}_Report_${from}_${to}.pdf`);
    } catch(e) {
      console.error("PDF export:", e);
    }
    setExporting(false);
  };

  if (preview) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-100 dark:bg-slate-900 flex flex-col">
        {/* Preview header */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pt-11 pb-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setPreview(false)}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
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
          <button onClick={exportPDF} disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition active:scale-95 disabled:opacity-50 flex-shrink-0">
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

        {/* Report preview — always 794px wide, scaled to fit screen */}
        <div className="flex-1 overflow-y-auto bg-slate-300 dark:bg-slate-700">
          <div className="py-4 flex justify-center">
            <div style={{
              zoom: Math.min(1, (window.innerWidth - 16) / 794),
              width: 794,
              flexShrink: 0,
            }}>
              <div ref={reportRef} style={{width: 794, background:"#fff", boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
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
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 pt-11 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
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
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
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

        {/* Generate button */}
        <button onClick={() => setPreview(true)}
          className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.98] shadow-lg flex items-center justify-center gap-2">
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
