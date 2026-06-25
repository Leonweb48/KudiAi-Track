// Exact selling prices for ClubKonnect data plans.
// Lookup by (network, planName) → selling price (naira).
// planType: "top_deals" (SME) | "awoof" | "weekly" | "monthly"

const PLAN_PRICES = {
  mtn: {
    top_deals: {
      "500mb": { 7: 400,  30: 500  },
      "1gb":   { 7: 500,  30: 700  },
      "2gb":   { 7: 1200, 30: 1500 },
      "3gb":   { 7: 1400, 30: 1800 },
      "5gb":   { 7: 2350, 30: 2850 },
    },
    awoof: {
      "110mb": { default: 150  },
      "230mb": { default: 250  },
      "500mb": { default: 400  },
      "1gb":   { default: 500  },
      "2.5gb": { 1: 750, 2: 900 },
      "3.2gb": { default: 1200 },
    },
    weekly: {
      "500mb":  { default: 500  },
      "1gb":    { default: 800  },
      "1.5gb":  { default: 1000 },
      "3.5gb":  { default: 1500 },
      "6gb":    { default: 2500 },
      "11gb":   { default: 3500 },
      "20gb":   { default: 5000 },
    },
    monthly: {
      "2gb":    { default: 1600  },
      "2.7gb":  { default: 2050  },
      "3.5gb":  { default: 2550  },
      "7gb":    { default: 3500  },
      "10gb":   { default: 4500  },
      "12.5gb": { default: 5500  },
      "16.5gb": { default: 6500  },
      "20gb":   { default: 7500  },
      "25gb":   { default: 9000  },
      "36gb":   { default: 11000 },
      "75gb":   { default: 18000 },
      "165gb":  { default: 35000 },
      "150gb":  { 60: 40000 },
      "480gb":  { 90: 90000 },
    },
  },

  glo: {
    top_deals: {
      "200mb": { default: 200  },
      "500mb": { default: 250  },
      "1gb":   { 3: 370, 7: 400, night: 400, 30: 500 },
      "2gb":   { 30: 950  },
      "3gb":   { 3: 1095, 7: 1095, night: 1100, 30: 1500 },
      "5gb":   { 3: 1800, 7: 1850, night: 2000, 30: 2400 },
      "10gb":  { night: 3650, 30: 4700 },
    },
    awoof: {
      "125mb": { default: 120 },
      "260mb": { default: 220 },
      "875mb": { weekend: 300, default: 300 },
      "2gb":   { 1: 600, default: 600 },
      "2.5gb": { weekend: 700, default: 700 },
    },
    weekly: {
      "6gb": { default: 1500 },
    },
    monthly: {
      "1.5gb":  { default: 500   },
      "2.6gb":  { default: 1000  },
      "5gb":    { default: 1500  },
      "6.15gb": { default: 2000  },
      "7.5gb":  { default: 2500  },
      "10gb":   { default: 3000  },
      "12.5gb": { default: 4000  },
      "16gb":   { default: 5000  },
      "28gb":   { default: 8000  },
      "38gb":   { default: 10000 },
      "64gb":   { default: 15000 },
      "107gb":  { default: 20000 },
      "165gb":  { default: 30000 },
      "220gb":  { default: 40000 },
      "320gb":  { default: 50000 },
      "380gb":  { default: 60000 },
      "475gb":  { default: 80000 },
      "1tb":    { default: 155000 },
    },
  },

  airtel: {
    awoof: {
      "1gb":   { 1: 500, default: 500 },
      "1.5gb": { default: 700  },
      "2gb":   { default: 800  },
      "3gb":   { default: 1000 },
      "5gb":   { default: 1500 },
    },
    weekly: {
      "500mb":  { default: 500  },
      "1gb":    { default: 800  },
      "1.5gb":  { default: 1000 },
      "3.5gb":  { default: 1500 },
      "6gb":    { default: 2500 },
      "10gb":   { default: 3000 },
      "18gb":   { default: 5000 },
    },
    monthly: {
      "2gb":   { default: 1500  },
      "3gb":   { default: 2000  },
      "4gb":   { default: 2500  },
      "8gb":   { default: 3000  },
      "13gb":  { default: 5000  },
      "25gb":  { default: 8000  },
      "35gb":  { default: 10000 },
      "60gb":  { default: 15000 },
      "100gb": { default: 20000 },
      "160gb": { default: 30000 },
      "210gb": { default: 40000 },
      "300gb": { 90: 50000 },
      "350gb": { 90: 60000 },
    },
  },

  "9mobile": {
    top_deals: {
      "50mb":  { default: 50    },
      "100mb": { default: 100   },
      "300mb": { default: 250   },
      "500mb": { default: 350   },
      "1gb":   { default: 600   },
      "2gb":   { default: 1200  },
      "3gb":   { default: 1650  },
      "4gb":   { default: 2100  },
      "5gb":   { default: 2600  },
      "10gb":  { default: 5000  },
      "15gb":  { default: 7500  },
      "20gb":  { default: 10000 },
      "25gb":  { default: 13000 },
    },
    awoof: {
      "100mb": { default: 120 },
      "180mb": { default: 170 },
      "250mb": { default: 220 },
      "450mb": { default: 400 },
      "650mb": { default: 500 },
    },
    weekly: {
      "1.75gb": { default: 1500 },
    },
    monthly: {
      "650mb":  { default: 600   },
      "1.1gb":  { default: 1000  },
      "1.4gb":  { default: 1200  },
      "2.44gb": { default: 2000  },
      "3.17gb": { default: 2500  },
      "3.91gb": { default: 3000  },
      "5.1gb":  { default: 4000  },
      "6.5gb":  { default: 5000  },
      "16gb":   { default: 11800 },
      "24.3gb": { default: 18300 },
      "26.5gb": { default: 20000 },
      "39gb":   { 60: 30000  },
      "78gb":   { 90: 60000  },
      "190gb":  { 180: 150000 },
    },
  },
};

function parsePlanInfo(planName) {
  const n = planName.toLowerCase();

  // Duration
  let duration = "default";
  if (n.includes("night")) {
    duration = "night";
  } else if (n.includes("weekend")) {
    duration = "weekend";
  } else {
    const moM  = n.match(/(\d+)\s*month/);
    const wkM  = n.match(/(\d+)\s*week/);
    const dayM = n.match(/(\d+)\s*day/);
    const dM   = n.match(/\b(\d+)\s*d\b/);
    if (moM)       duration = parseInt(moM[1])  * 30;
    else if (wkM)  duration = parseInt(wkM[1])  * 7;
    else if (dayM) duration = parseInt(dayM[1]);
    else if (dM)   duration = parseInt(dM[1]);
    else if (n.includes("weekly"))  duration = 7;
    else if (n.includes("monthly")) duration = 30;
  }

  // Plan type — sme→top_deals, awoof→awoof, else split direct by duration
  let type;
  if (n.includes("sme")) {
    type = "top_deals";
  } else if (n.includes("awoof")) {
    type = "awoof";
  } else {
    const days = typeof duration === "number" ? duration : 0;
    type = (days > 0 && days <= 7) ? "weekly" : "monthly";
  }

  // Size key
  let sizeKey = null;
  const tbM = n.match(/(\d+(?:\.\d+)?)\s*tb/);
  const gbM = n.match(/(\d+(?:\.\d+)?)\s*gb/);
  const mbM = n.match(/(\d+(?:\.\d+)?)\s*mb/);
  if (tbM)      sizeKey = parseFloat(tbM[1]).toString() + "tb";
  else if (gbM) sizeKey = parseFloat(gbM[1]).toString() + "gb";
  else if (mbM) sizeKey = parseFloat(mbM[1]).toString() + "mb";

  return { type, sizeKey, duration };
}

export function lookupDataPrice(network, planName) {
  if (!network || !planName) return null;

  const net = network.toLowerCase() === "9mobile" || network.toLowerCase() === "t2mobile"
    ? "9mobile"
    : network.toLowerCase();

  const { type, sizeKey, duration } = parsePlanInfo(planName);
  if (!sizeKey) return null;

  const netMap  = PLAN_PRICES[net];
  if (!netMap) return null;

  const typeMap = netMap[type];
  if (!typeMap) return null;

  const sizeMap = typeMap[sizeKey];
  if (!sizeMap) return null;

  // Exact duration match first, then "default", then single-key fallback
  if (sizeMap[duration]  !== undefined) return sizeMap[duration];
  if (sizeMap["default"] !== undefined) return sizeMap["default"];

  const keys = Object.keys(sizeMap).filter(k => k !== "default");
  if (keys.length === 1) return sizeMap[keys[0]];

  return null;
}
