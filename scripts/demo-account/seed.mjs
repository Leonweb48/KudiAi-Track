// Fictional data for the Google Play reviewer's demo business — "Adaeze Fresh Mart (Demo)", a provisions shop in Ikeja.
// Pure: given a user id and a clock it returns rows; nothing here touches the network. Everything is invented (phone numbers are 0800000000x).
import { randomUUID } from "node:crypto";

export const DEMO_EMAIL = "demo.reviewer@kudiai.app";
export const DEMO_BUSINESS = "Adaeze Fresh Mart (Demo)";
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
