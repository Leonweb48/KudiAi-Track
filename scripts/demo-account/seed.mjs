// Fictional data for the Google Play reviewer's demo business — "Adaeze Fresh Mart (Demo)", a provisions shop in Ikeja.
// Pure: given a user id and a clock it returns rows; nothing here touches the network. Everything is invented (phone numbers are 0800000000x).
import { randomUUID } from "node:crypto";

export const DEMO_EMAIL = "demo.reviewer@kudiai.app";
export const DEMO_BUSINESS = "Adaeze Fresh Mart (Demo)";
export const TESTER_EMAIL = "test.upgrade@kudiai.app";
export const TESTER_BUSINESS = "KudiAI Upgrade Test (Test)";
export const DEMO_APP_PIN = "246813";   // 6 digits, not on pin-manager's "too predictable" list
export const DEMO_TXN_PIN = "2468";     // 4 digits

// small deterministic generator so a re-run makes the same-looking shop
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// name, category, cost (per unit), price, qty on shelf, low-stock threshold
const PRODUCTS = [
  ["Golden Penny Rice 50kg", "Grains", 78000, 84500, 14, 5],
  ["Mama Gold Rice 25kg", "Grains", 41000, 44500, 9, 4],
  ["Peak Milk Tin 400g", "Dairy", 1850, 2200, 96, 24],
  ["Indomie Chicken (carton of 40)", "Noodles", 7400, 8200, 22, 6],
  ["Kings Vegetable Oil 5L", "Oil", 9800, 11200, 3, 6],
  ["Dangote Sugar 500g", "Sugar", 850, 1000, 120, 30],
  ["Semovita 1kg", "Flour", 1500, 1800, 60, 20],
  ["Garri Ijebu (1 paint)", "Grains", 2600, 3200, 4, 8],
  ["Titus Sardine Tin", "Canned", 950, 1200, 72, 24],
  ["Milo Refill 500g", "Beverage", 2900, 3400, 38, 12],
  ["Bournvita 900g", "Beverage", 4300, 5000, 2, 6],
  ["Eggs (crate of 30)", "Fresh", 3900, 4500, 18, 6],
  ["Bottled Water (pack of 12)", "Beverage", 1700, 2200, 45, 15],
  ["Coca-Cola 50cl (crate of 12)", "Beverage", 3100, 3700, 26, 8],
  ["Ariel Detergent 900g", "Household", 2600, 3100, 0, 6],
  ["Spaghetti (carton of 20)", "Pasta", 9600, 10800, 11, 4],
  ["Honey Beans (1 paint)", "Grains", 3800, 4600, 16, 6],
  ["Gino Tomato Paste (carton of 50)", "Canned", 7800, 9000, 7, 3],
  ["Maggi Star Cubes (box)", "Seasoning", 3800, 4500, 30, 10],
  ["Hypo Toothpaste", "Household", 700, 950, 40, 12],
];

// customer, phone, total owed, paid so far, days until due (negative = overdue), note
const CREDITS = [
  ["Emeka Nwosu", "08000000011", 62000, 20000, 5, "Rice, oil and sugar for his restaurant"],
  ["Mrs. Bisi Adebayo", "08000000012", 28500, 10000, -3, "Provisions for the naming ceremony"],
  ["Tunde Bakare", "08000000013", 45000, 0, 9, "Bags of rice and beans"],
  ["Chioma Obi", "08000000014", 17800, 17800, -20, "Monthly provisions"],
  ["Alhaji Musa Danjuma", "08000000015", 94000, 30000, 14, "Bulk order — spaghetti and tomato paste"],
  ["Sister Grace Ogundele", "08000000016", 12600, 4000, 2, "Church event supplies"],
];

const CUSTOMERS = [
  ["Emeka Nwosu", "08000000011"], ["Mrs. Bisi Adebayo", "08000000012"], ["Tunde Bakare", "08000000013"], ["Chioma Obi", "08000000014"],
  ["Alhaji Musa Danjuma", "08000000015"], ["Sister Grace Ogundele", "08000000016"], ["Ngozi Eze", "08000000017"], ["Kunle Adeyemi", "08000000018"],
];

const iso = (d) => d.toISOString();
const dayStr = (now, n) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const at = (now, n, h, m, sec = 0) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(h, m, sec, 0); return iso(d); };

export function buildProfile(userId, now = new Date()) {
  return {
    id: userId,
    full_name: "Adaeze Okonkwo",
    business_name: DEMO_BUSINESS,
    phone: "08000000000",
    // email is deliberately left empty: transaction / welcome emails read profiles.email, and nothing should ever be mailed for a demo shop
    gender: "Female", date_of_birth: "1988-06-14",
    address: "12 Demo Street, Ikeja", state: "Lagos", lga: "Ikeja",
    business_type: "Sole Proprietorship", reg_status: "Registered (CAC)", industry: "Retail & Trading", business_category: "Retail & Trading",
    business_size: "2–5 people", products_services_type: "Provisions and groceries",
    business_state: "Lagos", business_lga: "Ikeja", business_address: "12 Demo Street, Ikeja, Lagos",
    verification_status: "tier2_verified", nin_verified: true,
    member_since: dayStr(now, 120),
  };
}

/** The free-plan test account (used to try "register in the app, upgrade elsewhere"): same fictional shop data, its own name. */
export function buildTesterProfile(userId, now = new Date()) {
  return { ...buildProfile(userId, now), full_name: "Test Owner", business_name: TESTER_BUSINESS, phone: "08000000002" };
}

export function buildProducts(userId, now = new Date()) {
  return PRODUCTS.map(([product_name, category, cost_price, selling_price, quantity, low_stock_threshold], i) => ({
    user_id: userId, product_name, sku: "AFM-" + (1000 + i), category, cost_price, selling_price, quantity, low_stock_threshold,
    needs_costing: false, source: "manual", created_at: at(now, 80, 9, 0), updated_at: at(now, 0, 8, 0),
  }));
}

export function buildCustomers(userId, now = new Date()) {
  return CUSTOMERS.map(([name, phone]) => ({ user_id: userId, name, phone, address: "Ikeja, Lagos", created_at: at(now, 40, 10, 0) }));
}

/** Credits + their part-payments. Ids are made here so a payment can point at its credit. */
export function buildCredits(userId, now = new Date()) {
  const credits = CREDITS.map(([customer_name, phone, total_amount, amount_paid, dueIn, notes], i) => ({
    id: randomUUID(), user_id: userId, customer_name, phone, address: "Ikeja, Lagos", state: "Lagos", lga: "Ikeja",
    total_amount, amount_paid, outstanding: total_amount - amount_paid,
    date_given: dayStr(now, 20 + i * 3), due_date: dayStr(now, -dueIn), status: amount_paid >= total_amount ? "paid" : "active",
    notes, created_at: at(now, 20 + i * 3, 11, 0),
  }));
  const payments = credits.filter((c) => c.amount_paid > 0).map((c, i) => ({
    id: randomUUID(), owner_id: userId, credit_id: c.id, amount: c.amount_paid, payment_date: dayStr(now, 6 + i), created_at: at(now, 6 + i, 15, 0), note: "Part payment",
  }));
  return { credits, payments };
}

/** 30 days of sales, restocking and running costs, plus a few bill payments, oldest first (the balance_after trigger runs on insert order). */
export function buildTransactions(userId, now = new Date(), days = 30) {
  const rnd = rng(20260926);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const PAY = ["cash", "cash", "cash", "transfer", "transfer", "pos"];
  const weights = PRODUCTS.map((p) => (p[3] < 2500 ? 6 : p[3] < 6000 ? 3 : p[3] < 15000 ? 2 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => { let r = rnd() * wsum; for (let i = 0; i < PRODUCTS.length; i++) { r -= weights[i]; if (r <= 0) return PRODUCTS[i]; } return PRODUCTS[0]; };
  const tx = [];
  const row = (o) => ({ user_id: userId, staff_id: null, branch_id: null, quantity: null, cost_price: null, customer_name: "", note: "", bill_status: null, line_items: null, bill_details: null, client_txn_id: randomUUID(), ...o });

  for (let d = days - 1; d >= 0; d--) {
    const dow = new Date(dayStr(now, d) + "T12:00:00Z").getUTCDay();
    const n = (dow === 6 ? 13 : dow === 0 ? 8 : 10) + int(-1, 2);
    for (let k = 0; k < n; k++) {
      const p = pickProduct();
      if (p[0] === "Ariel Detergent 900g" && d < 12) continue;                 // out of stock lately
      const qty = p[3] > 20000 ? 1 : p[3] > 6000 ? int(1, 2) : int(1, 6);
      tx.push(row({ type: "in", category: "sale", amount: p[3] * qty, item_name: p[0], quantity: qty, cost_price: p[2], payment_type: pick(PAY),
        transaction_date: dayStr(now, d), created_at: at(now, d, int(8, 19), int(0, 59), int(0, 59)) }));
    }
    if (dow === 1 || dow === 4) {
      const p = pick(PRODUCTS.slice(0, 8)); const qty = int(3, 8);
      tx.push(row({ type: "out", category: "stock", amount: p[2] * qty, item_name: p[0], quantity: qty, payment_type: "cash", note: "Stock restock",
        transaction_date: dayStr(now, d), created_at: at(now, d, 7, 30, int(0, 59)) }));
    }
    if (dow === 3) tx.push(row({ type: "out", category: "expense", amount: int(8, 16) * 1000, item_name: "Generator fuel", payment_type: "cash", note: "Diesel",
      transaction_date: dayStr(now, d), created_at: at(now, d, 9, 10, int(0, 59)) }));
    if (dow === 5) tx.push(row({ type: "out", category: "expense", amount: 25000, item_name: "Shop assistant wages", payment_type: "cash", note: "Weekly wages",
      transaction_date: dayStr(now, d), created_at: at(now, d, 17, 40, int(0, 59)) }));
  }
  tx.push(row({ type: "out", category: "expense", amount: 60000, item_name: "Shop rent", payment_type: "transfer", note: "Monthly rent",
    transaction_date: dayStr(now, 3), created_at: at(now, 3, 10, 5) }));

  // a few bill payments so the Bills page has history (these are records only — nothing was actually bought)
  const bill = (d, h, category, item_name, who, amount, extra = {}) => row({
    type: "out", category, amount, item_name, customer_name: who, payment_type: "bill_payment", bill_status: "success", note: extra.note || "",
    bill_details: extra.details || null, transaction_date: dayStr(now, d), created_at: at(now, d, h, 12, 5),
  });
  tx.push(
    bill(1, 8, "airtime", "MTN Airtime", "08000000021", 5000),
    bill(2, 16, "data", "MTN Data 10GB", "08000000021", 3000),
    bill(3, 9, "electricity", "IKEDC Prepaid Electricity", "00000000001", 15000, { details: { token: "0000-0000-0000-0000-0000", units: "412.6 kWh" } }),
    bill(5, 13, "cable", "DStv Compact", "0000000001", 15700),
    bill(6, 10, "airtime", "Airtel Airtime", "08000000012", 2000),
    bill(8, 15, "data", "Glo Data 5GB", "08000000013", 1500),
  );
  tx.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return tx;
}

// ── "showcase": a wallet, Ajo savers, a savings card and an esusu circle for the same fictional shop ─────────────────
// Used only to photograph the screens for marketing flyers, then removed again (ACTION=showcase-clear). Every wallet is
// FROZEN (the server refuses every debit from a frozen wallet) and its account number fails the NUBAN check digit for
// the bank shown, so it can never be a real account. Nothing here touches the network.
export const SHOWCASE_CLIENT_EMAIL = "demo.client@kudiai.app";
export const SHOWCASE_CLIENT_NAME = "Ngozi Eze";
const OWNER_ACCOUNT = "9034521870";     // Wema (035) check digit would be 5 — this one is deliberately invalid
const CLIENT_ACCOUNT = "9048617268";    // Wema check digit would be 3 — invalid on purpose
const ESUSU_GROUP = "Ikeja Esusu Circle";

// name, phone, frequency, amount, registered (days ago), paid today?, in the esusu circle?, paid this esusu round?, withdrawn
const SAVERS = [
  ["Kemi Balogun", "08000000031", "weekly", 5000, 60, false, true, true, 0],
  ["Halima Yusuf", "08000000032", "weekly", 5000, 46, false, true, true, 0],
  ["Chinedu Okeke", "08000000033", "weekly", 5000, 53, false, true, true, 0],
  ["Funke Adeyemi", "08000000034", "weekly", 5000, 39, false, true, true, 0],
  ["Tope Adewale", "08000000035", "weekly", 5000, 35, false, true, false, 0],
  ["Aisha Bello", "08000000036", "daily", 1000, 24, true, false, false, 0],
  ["Uche Nnamdi", "08000000037", "monthly", 20000, 95, false, false, false, 20000],
  ["Blessing Okafor", "08000000038", "daily", 500, 29, false, false, false, 0],
  ["Ibrahim Sani", "08000000039", "weekly", 10000, 57, false, false, false, 0],
  ["Grace Etim", "08000000040", "monthly", 15000, 64, false, false, false, 0],
];
const STEP = { daily: 1, weekly: 7, monthly: 30 };
const atUtc = (...a) => at(...a);

function frozenWallet(userId, number, name, now) {
  const stamp = iso(now);
  return {
    id: randomUUID(), user_id: userId, balance_kobo: 0, currency: "NGN", status: "frozen", tier: 2,
    flw_account: "business", flw_customer_id: `DEMO-CUST-${number}`, flw_virtual_account_id: `DEMO-VA-${number}`,
    flw_account_number: number, flw_account_bank: "Wema Bank", flw_account_name: `KudiAI Wallet - ${name}`,
    migration_notified_at: stamp, migration_emailed_at: stamp, account_details_emailed_at: stamp, migration_reminded_at: stamp,
    created_at: at(now, 40, 9, 0),
  };
}

/** Ledger rows for a wallet, oldest first, each with the running balance; the wallet's balance is set to the total. */
function ledger(wallet, entries) {
  let bal = 0;
  const rows = entries.map((e) => {
    bal += e.direction === "credit" ? e.amount * 100 : -e.amount * 100;
    return {
      id: randomUUID(), wallet_id: wallet.id, user_id: wallet.user_id, direction: e.direction, amount_kobo: e.amount * 100,
      balance_after_kobo: bal, source: e.source, status: "completed", reference: e.reference || null, flw_reference: e.flw_reference || null,
      related_txn_id: e.related || null, narration: e.narration, meta: e.meta || {}, created_at: e.created_at,
    };
  });
  wallet.balance_kobo = bal;
  return rows;
}

export function buildShowcase(ownerId, clientUserId, now = new Date()) {
  // a time today that has not happened yet is pulled back to just before the run (keeping the day's order), so nothing is future-dated
  const at = (_now, d, h, m, s = 0) => {
    const t = atUtc(now, d, h, m, s);
    if (d > 0 || Date.parse(t) < now.getTime() - 3600e3) return t;
    return new Date(now.getTime() - 3600e3 - (24 - h) * 60e3 - (60 - m) * 1e3).toISOString();
  };
  const contributions = [];
  const contrib = (o) => {
    const row = {
      id: randomUUID(), owner_id: ownerId, type: "contribution", payment_method: "cash", status: "completed", paystack_status: "completed",
      contribution_context: "personal_savings", cycle_id: null, group_id: null, initiated_by: "business", notes: "",
      fee_for_contribution_id: null, ...o,
    };
    row.paid_at = row.created_at;
    contributions.push(row);
    return row;
  };
  const clients = [];
  const client = (name, phone, freq, amount, regDays, extra = {}) => {
    const c = {
      id: randomUUID(), user_id: ownerId, staff_id: null, created_by: null, branch_id: null, full_name: name, phone, email: "",
      address: "Ikeja, Lagos", state: "Lagos", lga: "Ikeja", ward: "", nin: "", next_of_kin: "", next_of_kin_phone: "", next_of_kin_email: "", next_of_kin_address: "",
      contribution_frequency: freq, contribution_amount: amount, registration_charge: 0, withdrawal_fee_percent: 5,
      commission_model: "none", commission_percent: null, total_saved: 0, total_withdrawn: 0, current_balance: 0,
      next_contribution_date: dayStr(now, 0), registration_date: dayStr(now, regDays), notes: "", status: "active",
      membership_number: `AJO-DEMO-${String(clients.length + 1).padStart(4, "0")}`, portal_pin: null, portal_active: true,
      ajo_group_id: null, client_user_id: null, bvn_verified: false, created_at: at(now, regDays, 9, 30), ...extra,
    };
    clients.push(c);
    return c;
  };

  // the esusu circle: one active round that started 6 days ago, Kemi collects first
  const group = { id: randomUUID(), owner_id: ownerId, name: ESUSU_GROUP, description: "Weekly esusu for traders on Allen Avenue", group_mode: "rotating",
    contribution_amount: 5000, contribution_frequency: "weekly", is_active: true, privacy_show_names: true, privacy_show_amounts: false, created_at: at(now, 20, 10, 0) };
  const round = { id: randomUUID(), group_id: group.id, round_number: 1, status: "active", started_at: at(now, 6, 8, 0), created_at: at(now, 6, 8, 0) };
  const members = [];

  // ── Ngozi: the client who signs in — a 90-day school-fees card (collector takes day 1), esusu member, own wallet ──
  const ngozi = client(SHOWCASE_CLIENT_NAME, "08000000017", "daily", 2000, 33, {
    client_user_id: clientUserId, commission_model: "first_period", bvn_verified: true, next_contribution_date: dayStr(now, -1),
  });
  const card = { id: randomUUID(), client_id: ngozi.id, owner_id: ownerId, start_date: dayStr(now, 33), length_periods: 90, expected_amount_per_period: 2000,
    status: "active", label: "School Fees 2027", frequency: "daily", commission_model: "first_period", commission_balance: 2000, created_at: at(now, 33, 9, 0) };
  const ngoziPaid = [];
  for (let d = 33; d >= 0; d--) {
    const viaWallet = d === 0;
    const r = contrib({ aso_client_id: ngozi.id, amount: 2000, cycle_id: card.id, created_at: at(now, d, d === 0 ? 7 : 8 + (d % 6), 10 + (d % 40)),
      ...(viaWallet ? { payment_method: "wallet", initiated_by: "client", notes: "Paid from KudiAI Wallet", payment_channel: "wallet" } : {}) });
    ngoziPaid.push(r);
    if (d === 33) contrib({ aso_client_id: ngozi.id, amount: 2000, type: "commission", cycle_id: card.id, notes: "Collector's fee — Day 1",
      fee_for_contribution_id: r.id, created_at: at(now, 33, 8 + (33 % 6), 11 + (33 % 40)) });
  }
  members.push([ngozi, true]);

  // ── the other savers (no logins) ──
  for (const [name, phone, freq, amount, reg, paidToday, esusu, paidRound, withdrawn] of SAVERS) {
    const c = client(name, phone, freq, amount, reg);
    let last = null;
    for (let d = reg; d >= (paidToday ? 0 : 1); d -= STEP[freq]) {
      contrib({ aso_client_id: c.id, amount, created_at: at(now, d, 8 + (d % 9), (d * 7) % 60) });
      last = d;
    }
    const nextIn = STEP[freq] - last;                       // days from today until the next one is due
    c.next_contribution_date = dayStr(now, -Math.max(0, nextIn));
    if (withdrawn) contrib({ aso_client_id: c.id, amount: withdrawn, type: "withdrawal", notes: "Withdrawal for shop rent", created_at: at(now, 9, 14, 20) });
    if (esusu) members.push([c, paidRound]);
  }

  // esusu contributions this round (Ngozi paid hers from her wallet 3 days ago)
  let ngoziEsusu = null;
  members.forEach(([c, paid], i) => {
    if (!paid) return;
    const isNgozi = c.id === ngozi.id;
    const r = contrib({ aso_client_id: c.id, amount: 5000, contribution_context: "esusu_rotation", group_id: group.id,
      created_at: at(now, isNgozi ? 3 : 5 - (i % 4), 9 + i, 5 + i * 7),
      ...(isNgozi ? { payment_method: "wallet", initiated_by: "client", notes: "Paid from KudiAI Wallet", payment_channel: "wallet" } : {}) });
    if (isNgozi) ngoziEsusu = r;
  });
  const order = [1, 2, 0, 3, 4, 5];                          // Kemi, Halima, Ngozi, Chinedu, Funke, Tope
  const memberships = members.map(([c]) => ({ id: randomUUID(), client_id: c.id, group_id: group.id, owner_id: ownerId, status: "active", created_at: at(now, 20, 10, 5) }));
  const turns = order.map((mi, pos) => ({
    id: randomUUID(), round_id: round.id, group_id: group.id, position: pos + 1, client_id: members[mi][0].id,
    expected_payout_date: dayStr(now, -(2 + pos * 7)), period_start: pos === 0 ? round.started_at : null, status: pos === 0 ? "current" : "upcoming",
    created_at: round.created_at,
  }));

  // per-client totals and the running balance on every row (oldest first)
  contributions.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.type === "contribution" ? -1 : 1)));
  const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
  for (const r of contributions) {
    const c = byId[r.aso_client_id];
    const sign = r.type === "contribution" ? 1 : -1;
    c.current_balance += sign * r.amount;
    if (r.type === "contribution") c.total_saved += r.amount;
    if (r.type === "withdrawal") c.total_withdrawn += r.amount;
    r.balance_after = c.current_balance;
  }

  // ── wallets ──
  const ownerWallet = frozenWallet(ownerId, OWNER_ACCOUNT, DEMO_BUSINESS, now);
  const topup = (d, h, amount, originator, bank, n) => ({ direction: "credit", source: "topup", amount, narration: "Wallet top-up (bank transfer)",
    flw_reference: `DEMO-AFM-T${String(n).padStart(3, "0")}`, meta: { originator, originator_bank: bank, sender_narration: "Payment for goods" }, created_at: at(now, d, h, 17 + n) });
  const collection = (r) => ({ direction: "credit", source: "ajo_collection", amount: r.amount, reference: r.id, related: r.id,
    narration: `Ajo contribution — ${SHOWCASE_CLIENT_NAME}`, created_at: new Date(Date.parse(r.created_at) + 1000).toISOString() });
  const ownerLedger = ledger(ownerWallet, [
    topup(14, 10, 40000, "KUNLE ADEYEMI", "Access Bank", 1),
    topup(10, 12, 25000, "CHIOMA OBI", "Moniepoint MFB", 2),
    topup(7, 9, 30000, "ALHAJI MUSA DANJUMA", "Zenith Bank", 3),
    topup(5, 15, 8600, "SISTER GRACE OGUNDELE", "OPay", 4),
    collection(ngoziEsusu),
    topup(2, 16, 46200, "EMEKA NWOSU", "Guaranty Trust Bank", 5),
    topup(1, 11, 18500, "BISI ADEBAYO", "PalmPay", 6),
    collection(ngoziPaid[ngoziPaid.length - 1]),
    topup(0, 9, 12000, "TUNDE BAKARE", "United Bank for Africa", 7),
  ].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)));

  const clientWallet = frozenWallet(clientUserId, CLIENT_ACCOUNT, SHOWCASE_CLIENT_NAME, now);
  const spend = (r) => ({ direction: "debit", source: "ajo_contribution", amount: r.amount, reference: r.id, related: r.id, narration: "Ajo contribution", created_at: r.created_at });
  const clientLedger = ledger(clientWallet, [
    { direction: "credit", source: "topup", amount: 20000, narration: "Wallet top-up (bank transfer)", flw_reference: "DEMO-NGE-T001",
      meta: { originator: "NGOZI EZE", originator_bank: "OPay", sender_narration: "Savings" }, created_at: at(now, 12, 18, 40) },
    { direction: "credit", source: "topup", amount: 21500, narration: "Wallet top-up (bank transfer)", flw_reference: "DEMO-NGE-T002",
      meta: { originator: "EMEKA EZE", originator_bank: "Moniepoint MFB", sender_narration: "For school fees" }, created_at: at(now, 5, 17, 5) },
    spend(ngoziEsusu),
    spend(ngoziPaid[ngoziPaid.length - 1]),
  ].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)));

  return { clients, card, group, round, memberships, turns, contributions, ownerWallet, ownerLedger, clientWallet, clientLedger };
}
