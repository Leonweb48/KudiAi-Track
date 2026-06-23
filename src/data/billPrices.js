// Exact selling prices for ClubKonnect data plans.
// Lookup by (network, planName) → selling price (naira).
// CK API is charged its own price; selling price is what the user pays.
// Airtime has no fixed selling price (user enters any amount).

// Keys: sizeKey = normalized size string e.g. "1gb", "500mb", "2.44gb"
// duration: numeric days, "night", "weekend", or "default"
// planType: "sme" | "awoof" | "direct"

const PLAN_PRICES = {
  mtn: {
    sme: {
      "500mb": { 7: 500,  30: 500  },
      "1gb":   { 7: 600,  30: 700  },
      "2gb":   { 7: 1200, 30: 1300 },
      "3gb":   { 7: 1400, 30: 1800 },
      "5gb":   { 7: 2300, 30: 2800 },
    },
    awoof: {
      "110mb": { default: 150  },
      "230mb": { default: 250  },
      "500mb": { default: 350  },
      "1gb":   { default: 550  },
      "2.5gb": { 1: 750, 2: 900 },
      "3.2gb": { default: 1000 },
    },
    direct: {
      "500mb":  { 7: 500  },
      "1gb":    { 7: 800  },
      "1.5gb":  { 7: 1000 },
      "3.5gb":  { 7: 1500,  30: 2550  },
      "6gb":    { 7: 2500  },
      "11gb":   { 7: 3500  },
      "20gb":   { 7: 5000,  30: 7500  },
      "2gb":    { 30: 1600  },
      "2.7gb":  { 30: 2050  },
      "7gb":    { 30: 3500  },
      "10gb":   { 30: 4500  },
      "12.5gb": { 30: 5500  },
      "16.5gb": { 30: 6500  },
      "25gb":   { 30: 9000  },
      "36gb":   { 30: 11000 },
      "75gb":   { 30: 18000 },
      "165gb":  { 30: 35000 },
      "150gb":  { 60: 40000 },
      "480gb":  { 90: 90000 },
    },
  },

  glo: {
    sme: {
      "200mb": { default: 200  },
      "500mb": { default: 250  },
      "1gb":   { 3: 330, 7: 365, night: 400, 30: 500  },
      "2gb":   { 30: 950  },
      "3gb":   { 3: 1095, 7: 1100, night: 1100, 30: 1500 },
      "5gb":   { 3: 1825, 7: 1850, night: 2000, 30: 2400 },
      "10gb":  { night: 3650, 30: 4700 },
    },
    awoof: {
      "125mb": { default: 200 },
      "260mb": { default: 200 },
      "875mb": { default: 200 },
      "2gb":   { 1: 600, default: 600 },
      "2.5gb": { weekend: 600, default: 600 },
    },
    direct: {
      "1.5gb":  { 14: 500,  default: 500  },
      "2.6gb":  { default: 1000  },
      "5gb":    { default: 1500  },
      "6gb":    { 7: 1500,  default: 1500 },
      "6.15gb": { default: 2000  },
      "7.5gb":  { default: 2500  },
      "10gb":   { default: 3000  },
      "12.5gb": { default: 4000  },
      "16gb":   { default: 5000  },
      "28gb":   { default: 8000  },
      "38gb":   { default: 9900  },
      "64gb":   { default: 15000 },
      "107gb":  { default: 20000 },
      "165gb":  { default: 30000 },
      "220gb":  { default: 40000 },
      "320gb":  { default: 49500 },
      "380gb":  { default: 60000 },
      "475gb":  { default: 75000 },
      "1tb":    { default: 165000 },
    },
  },

  airtel: {
    awoof: {
      "1gb":   { 1: 500, default: 500  },
      "1.5gb": { default: 800  },
      "2gb":   { default: 800  },
      "3gb":   { default: 1000 },
      "5gb":   { default: 1500 },
    },
    direct: {
      "500mb":  { 7: 500  },
      "1gb":    { 7: 800  },
      "1.5gb":  { 7: 1000 },
      "3.5gb":  { 7: 1500  },
      "6gb":    { 7: 2500  },
      "10gb":   { 7: 3000,  30: 4000  },
      "18gb":   { 7: 5000,  30: 6000  },
      "2gb":    { 30: 1500  },
      "3gb":    { 30: 2000  },
      "4gb":    { 30: 2500  },
      "8gb":    { 30: 3000  },
      "13gb":   { 30: 5000  },
      "25gb":   { 30: 8000  },
      "35gb":   { 30: 10000 },
      "60gb":   { 30: 15000 },
      "100gb":  { 30: 20000 },
      "160gb":  { 30: 30000 },
      "210gb":  { 30: 40000 },
      "300gb":  { 90: 50000 },
      "350gb":  { 90: 60000 },
    },
  },

  "9mobile": {
    sme: {
      "50mb":  { default: 50    },
      "100mb": { default: 100   },
      "300mb": { default: 250   },
      "500mb": { default: 350   },
      "1gb":   { default: 800   },
      "2gb":   { default: 1000  },
      "3gb":   { default: 1500  },
      "4gb":   { default: 2100  },
      "5gb":   { default: 2550  },
      "10gb":  { default: 5000  },
      "15gb":  { default: 7500  },
      "20gb":  { default: 10000 },
      "25gb":  { default: 13000 },
    },
    awoof: {
      "100mb": { default: 100 },
      "180mb": { default: 150 },
      "250mb": { default: 250 },
      "450mb": { default: 400 },
      "650mb": { default: 500 },
    },
    direct: {
      "1.75gb": { 7: 1500,  default: 1500  },
      "650mb":  { 14: 700,  default: 700   },
      "1.1gb":  { default: 1000  },
      "1.4gb":  { default: 1250  },
      "2.44gb": { default: 2050  },
      "3.17gb": { default: 2550  },
      "3.91gb": { default: 3050  },
      "5.1gb":  { default: 4000  },
      "6.5gb":  { default: 5000  },
      "16gb":   { default: 12000 },
      "24.3gb": { default: 18500 },
      "26.5gb": { default: 20000 },
      "39gb":   { 60: 30000 },
      "78gb":   { 90: 60000 },
      "190gb":  { 180: 150000 },
    },
  },
};

function normSize(raw) {
  return parseFloat(raw).toString();
}

function parsePlanInfo(planName) {
  const n = planName.toLowerCase();

  // Plan type
  let type = "direct";
  if (n.includes("sme")) type = "sme";
  else if (n.includes("awoof")) type = "awoof";

  // Size key
  let sizeKey = null;
  const tbM = n.match(/(\d+(?:\.\d+)?)\s*tb/);
  const gbM = n.match(/(\d+(?:\.\d+)?)\s*gb/);
  const mbM = n.match(/(\d+(?:\.\d+)?)\s*mb/);
  if (tbM)      sizeKey = normSize(tbM[1]) + "tb";
  else if (gbM) sizeKey = normSize(gbM[1]) + "gb";
  else if (mbM) sizeKey = normSize(mbM[1]) + "mb";

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
  if (sizeMap[duration]    !== undefined) return sizeMap[duration];
  if (sizeMap["default"]   !== undefined) return sizeMap["default"];

  const keys = Object.keys(sizeMap).filter(k => k !== "default");
  if (keys.length === 1) return sizeMap[keys[0]];

  return null;
}
