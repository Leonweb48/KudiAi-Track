/* Business analytics: sales predictions, restock, slow-mover analysis */

const MS_DAY = 86400000;

/* ── Sales prediction from transaction history ─────────────────── */
export function getSalesPrediction(transactions) {
  const now = new Date();
  const cut28 = new Date(now.getTime() - 28 * MS_DAY);

  // This week (Sun–Sat) actual — always computed so the stat card is never blank
  const dow = now.getDay();
  const startOfWeek = new Date(now.getTime() - dow * MS_DAY);
  startOfWeek.setHours(0, 0, 0, 0);
  const thisWeekActual = transactions
    .filter(t => t.type === "in" && new Date(t.transaction_date) >= startOfWeek)
    .reduce((s, t) => s + t.amount, 0);

  // This month actual — always computed
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const thisMonthActual = transactions
    .filter(t => t.type === "in" && new Date(t.transaction_date) >= startOfMonth)
    .reduce((s, t) => s + t.amount, 0);

  // Build daily revenue map for last 28 days (needed for projections)
  const dailyMap = {};
  transactions
    .filter(t => t.type === "in" && new Date(t.transaction_date) >= cut28)
    .forEach(t => {
      dailyMap[t.transaction_date] = (dailyMap[t.transaction_date] || 0) + t.amount;
    });

  const dailyValues = Object.values(dailyMap);
  if (dailyValues.length < 3) {
    // Not enough history for projections — return actuals only
    return { thisWeekActual, thisMonthActual, projectedWeek: null, projectedMonth: null, avgDaily: 0, trend: null, trendPct: null };
  }

  const avgDaily = dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length;
  const projectedWeek  = Math.round(thisWeekActual  + avgDaily * (6 - dow));
  const projectedMonth = Math.round(thisMonthActual + avgDaily * (daysInMonth - now.getDate()));

  // Trend: last 14 days vs previous 14 days
  const cut14 = new Date(now.getTime() - 14 * MS_DAY);
  const last14 = transactions
    .filter(t => t.type === "in" && new Date(t.transaction_date) >= cut14)
    .reduce((s, t) => s + t.amount, 0);
  const prev14 = transactions
    .filter(t => t.type === "in" && new Date(t.transaction_date) >= cut28 && new Date(t.transaction_date) < cut14)
    .reduce((s, t) => s + t.amount, 0);

  const trendPct = prev14 > 0 ? Math.round(((last14 - prev14) / prev14) * 100) : null;
  const trend = trendPct === null ? "neutral"
    : trendPct >= 10 ? "up"
    : trendPct <= -10 ? "down"
    : "stable";

  return { avgDaily, projectedWeek, projectedMonth, thisWeekActual, thisMonthActual, trend, trendPct };
}

/* ── Restock & fast-moving analysis ────────────────────────────── */
export function getRestockData(products, transactions) {
  const now  = new Date();
  const cut30 = new Date(now.getTime() - 30 * MS_DAY);

  // Per-product units sold in last 30 days
  const salesMap = {};
  transactions
    .filter(t => t.type === "in" && t.item_name && new Date(t.transaction_date) >= cut30)
    .forEach(t => {
      if (!salesMap[t.item_name]) salesMap[t.item_name] = 0;
      salesMap[t.item_name] += (t.quantity || 1);
    });

  const toRestock = [];
  const fastMoving = [];

  products.forEach(p => {
    const monthlyQty = salesMap[p.product_name || p.name] || 0;
    const threshold  = p.low_stock_threshold || 5;

    if (monthlyQty >= 5) {
      fastMoving.push({ ...p, monthlyQty });
    }

    const daysLeft = monthlyQty > 0 ? Math.round((p.quantity / monthlyQty) * 30) : null;
    const needsRestock = p.quantity <= threshold || (daysLeft !== null && daysLeft < 14);

    if (needsRestock) {
      const target    = Math.max(Math.ceil(monthlyQty * 2), threshold * 4, 10);
      const recommended = Math.max(target - p.quantity, 1);
      toRestock.push({ ...p, monthlyQty, recommended, daysLeft });
    }
  });

  return {
    toRestock:   toRestock.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)).slice(0, 8),
    fastMoving:  fastMoving.sort((a, b) => b.monthlyQty - a.monthlyQty).slice(0, 5),
    lowStock:    products
                   .filter(p => p.quantity <= (p.low_stock_threshold || 5))
                   .sort((a, b) => a.quantity - b.quantity)
                   .slice(0, 6),
  };
}

/* ── Slow-moving product analysis ───────────────────────────────── */
export function getSlowMovers(products, transactions) {
  const now  = new Date();
  const cut30 = new Date(now.getTime() - 30 * MS_DAY);

  // Last sale date + units sold in last 30 days per product
  const lastSaleMap = {};
  const qty30Map    = {};

  transactions
    .filter(t => t.type === "in" && t.item_name)
    .forEach(t => {
      const d = new Date(t.transaction_date);
      if (!lastSaleMap[t.item_name] || d > lastSaleMap[t.item_name]) {
        lastSaleMap[t.item_name] = d;
      }
      if (d >= cut30) {
        qty30Map[t.item_name] = (qty30Map[t.item_name] || 0) + (t.quantity || 1);
      }
    });

  return products
    .filter(p => p.quantity > 0)
    .map(p => {
      const pName        = p.product_name || p.name;
      const lastSale     = lastSaleMap[pName] || null;
      const soldLast30   = qty30Map[pName]    || 0;
      const daysSinceSale = lastSale ? Math.floor((now - lastSale) / MS_DAY) : null;

      // Discount: 20% off but not below cost + 10%
      const floor = p.cost_price ? Math.round(p.cost_price * 1.10) : null;
      const raw20  = p.selling_price ? Math.round(p.selling_price * 0.80) : null;
      const discountPrice = raw20 && floor ? Math.max(raw20, floor) : null;
      const discountPct   = discountPrice && p.selling_price
        ? Math.round(((p.selling_price - discountPrice) / p.selling_price) * 100)
        : null;

      return {
        ...p,
        lastSaleDate:  lastSale ? lastSale.toISOString().split("T")[0] : null,
        soldLast30,
        daysSinceSale,
        discountPrice,
        discountPct,
      };
    })
    .filter(p => p.soldLast30 < 2 && (p.daysSinceSale === null || p.daysSinceSale > 14))
    .sort((a, b) => (b.daysSinceSale ?? 9999) - (a.daysSinceSale ?? 9999))
    .slice(0, 8);
}
