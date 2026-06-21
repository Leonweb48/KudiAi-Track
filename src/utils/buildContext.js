import { today, fmt } from "./helpers";

export function buildAjoMemberContext(client = {}, contributions = [], ownerInfo = {}) {
  if (!client || !client.full_name) return "Ajo Member Portal | Member data is still loading.";

  const now  = new Date();
  const cm   = now.getMonth();
  const cy   = now.getFullYear();

  const mContribs   = contributions.filter(c => {
    const d = new Date(c.transaction_date || c.date || 0);
    return d.getMonth() === cm && d.getFullYear() === cy;
  });
  const monthlyTotal = mContribs.reduce((s, c) => s + Number(c.amount || 0), 0);

  const isOverdue = client.next_contribution_date && new Date() > new Date(client.next_contribution_date);

  const recentLines = contributions.slice(0, 10).map(c =>
    `  • ₦${fmt(c.amount || 0)} on ${c.transaction_date || c.date || "unknown"} — ${c.transaction_type || c.type || "contribution"}`
  );

  return [
    `AJO SAVINGS MEMBER PORTAL | Member: ${client.full_name} | Today: ${today()}`,
    `SAVINGS BALANCE: ₦${fmt(client.current_balance || 0)} | Total Saved: ₦${fmt(client.total_saved || 0)} | Total Withdrawn: ₦${fmt(client.total_withdrawn || 0)}`,
    `CONTRIBUTION PLAN: ₦${fmt(client.contribution_amount || 0)} ${client.contribution_frequency || ""} | Next Due: ${client.next_contribution_date || "N/A"}${isOverdue ? " [OVERDUE]" : ""}`,
    `STATUS: ${client.status || "active"} | Group: ${client.group_name || client.ajo_group || "No group"}`,
    `THIS MONTH: ₦${fmt(monthlyTotal)} contributed across ${mContribs.length} transaction(s)`,
    `TOTAL CONTRIBUTION RECORDS: ${contributions.length}`,
    contributions.length > 0 ? `RECENT TRANSACTIONS:\n${recentLines.join("\n")}` : "RECENT TRANSACTIONS: None yet",
    ownerInfo?.business_name ? `MANAGED BY: ${ownerInfo.business_name} | Contact: ${ownerInfo.phone || ownerInfo.owner_phone || "N/A"}` : "",
  ].filter(Boolean).join("\n");
}

export function buildCoopMemberContext(member = {}, loans = [], org = {}) {
  if (!member || !member.full_name) return "Cooperative Member Portal | Member data is still loading.";

  const orgName   = org?.name || member?.org?.name || member?.organizations?.name || "Unknown Co-op";
  const orgType   = org?.type || member?.org?.type || member?.organizations?.type || "";

  const activeLoans  = loans.filter(l => l.status === "active" || l.status === "approved");
  const pendingLoans = loans.filter(l => l.status === "pending");
  const totalDebt    = activeLoans.reduce((s, l) => s + Number(l.remaining_balance || l.amount || 0), 0);

  const loanLines = loans.slice(0, 5).map(l =>
    `  • ₦${fmt(l.amount || 0)} — ${l.status} | Monthly: ₦${fmt(l.monthly_payment || 0)} | Remaining: ₦${fmt(l.remaining_balance || 0)}`
  );

  return [
    `COOPERATIVE MEMBER PORTAL | Member: ${member.full_name} | Today: ${today()}`,
    `ORGANIZATION: ${orgName}${orgType ? ` (${orgType})` : ""}`,
    `MEMBER CODE: ${member.member_code || "N/A"} | Status: ${member.status || "active"}`,
    `SAVINGS BALANCE: ₦${fmt(member.savings_balance || member.balance || 0)}`,
    `LOANS: ${activeLoans.length} active | ${pendingLoans.length} pending | Total Debt: ₦${fmt(totalDebt)}`,
    loans.length > 0 ? `LOAN DETAILS:\n${loanLines.join("\n")}` : "LOANS: No loans on record",
    `CONTACT: ${member.email || "N/A"} | ${member.phone || "N/A"}`,
  ].filter(Boolean).join("\n");
}

export function buildContext(store, products, branches = []) {
  const { profile = {}, transactions = [], credits = [], asoClients = [], staffMap = {} } = store;
  const todayStr = today();
  const now      = new Date();
  const cm       = now.getMonth();
  const cy       = now.getFullYear();

  const txIn  = transactions.filter(t => t.type === "in");
  const txOut = transactions.filter(t => t.type === "out");
  const allIn  = txIn.reduce((s, t) => s + t.amount, 0);
  const allOut = txOut.reduce((s, t) => s + t.amount, 0);

  const tdIn  = txIn.filter(t => t.transaction_date === todayStr).reduce((s, t) => s + t.amount, 0);
  const tdOut = txOut.filter(t => t.transaction_date === todayStr).reduce((s, t) => s + t.amount, 0);
  const tdCnt = transactions.filter(t => t.transaction_date === todayStr).length;

  const mTx  = transactions.filter(t => { const d = new Date(t.transaction_date); return d.getMonth() === cm && d.getFullYear() === cy; });
  const mIn  = mTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const mOut = mTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);

  const itemMap = {};
  txIn.forEach(t => { if (t.item_name) itemMap[t.item_name] = (itemMap[t.item_name] || 0) + t.amount; });
  const topItems = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  const custMap = {};
  txIn.forEach(t => { if (t.customer_name) custMap[t.customer_name] = (custMap[t.customer_name] || 0) + t.amount; });
  const topCusts = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (₦${fmt(v)})`);

  const unpaid     = credits.filter(c => c.status !== "paid");
  const overdue    = credits.filter(c => c.status === "overdue");
  const creditOwed = unpaid.reduce((s, c) => s + (c.outstanding || 0), 0);

  const outOfStock = products.filter(p => p.quantity === 0).length;
  const lowStock   = products.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || 5)).length;
  const stockVal   = products.reduce((s, p) => s + (p.selling_price || 0) * p.quantity, 0);

  const ajoActive = asoClients.filter(c => c.status === "active").length;
  const ajoBal    = asoClients.reduce((s, c) => s + (c.current_balance  || 0), 0);
  const ajoSaved  = asoClients.reduce((s, c) => s + (c.total_saved      || 0), 0);
  const ajoWithdr = asoClients.reduce((s, c) => s + (c.total_withdrawn  || 0), 0);
  const ajoOver   = asoClients.filter(c => c.next_contribution_date && new Date() > new Date(c.next_contribution_date));

  const ajoClientLines = asoClients.slice(0, 30).map(c => {
    const isOverdue = c.next_contribution_date && new Date() > new Date(c.next_contribution_date);
    return `  • ${c.full_name || "Unknown"}: Balance ₦${fmt(c.current_balance || 0)}, Saved ₦${fmt(c.total_saved || 0)}, Withdrawn ₦${fmt(c.total_withdrawn || 0)}, Freq: ${c.contribution_frequency || "N/A"}, NextDue: ${c.next_contribution_date || "N/A"}${isOverdue ? " [OVERDUE]" : ""}`;
  });

  const staffNames = Object.values(staffMap || {});
  const branchLines = branches.length
    ? branches.map(b => `${b.name}${b.address ? ` (${b.address})` : ""}${b.is_active === false ? " [inactive]" : ""}`).join(", ")
    : "None";

  return [
    `Business: ${profile.business_name || "Unknown"} | Owner: ${profile.owner_name || profile.full_name || "Unknown"} | Today: ${todayStr}`,
    `ALL-TIME FINANCES: Sales ₦${fmt(allIn)} | Expenses ₦${fmt(allOut)} | Net Profit ₦${fmt(allIn - allOut)}`,
    `THIS MONTH: Sales ₦${fmt(mIn)} | Expenses ₦${fmt(mOut)} | Profit ₦${fmt(mIn - mOut)}`,
    `TODAY: Sales ₦${fmt(tdIn)} | Expenses ₦${fmt(tdOut)} | Transactions: ${tdCnt}`,
    `TOTAL TRANSACTIONS: ${transactions.length}`,
    `TOP ITEMS: ${topItems.join(", ") || "None recorded"}`,
    `TOP CUSTOMERS: ${topCusts.join(", ") || "None recorded"}`,
    `CREDIT: ₦${fmt(creditOwed)} outstanding from ${unpaid.length} customers | ${overdue.length} overdue`,
    `INVENTORY: ${products.length} products | ${outOfStock} out of stock | ${lowStock} low stock | Stock value ₦${fmt(stockVal)}`,
    `AJO/SAVINGS: ${asoClients.length} clients (${ajoActive} active) | Balance ₦${fmt(ajoBal)} | Total Saved ₦${fmt(ajoSaved)} | Total Withdrawn ₦${fmt(ajoWithdr)} | ${ajoOver.length} overdue`,
    asoClients.length > 0 ? `AJO CLIENTS:\n${ajoClientLines.join("\n")}` : "AJO CLIENTS: None yet",
    `STAFF: ${staffNames.length > 0 ? `${staffNames.length} member(s) — ${staffNames.join(", ")}` : "None"}`,
    `BRANCHES: ${branches.length > 0 ? `${branches.length} branch(es) — ${branchLines}` : "None"}`,
  ].join("\n");
}
