/**
 * Saved bill beneficiaries — stored in localStorage.
 * Auto-saved after every successful payment; shown as quick-select chips on the form.
 */

const STORAGE_KEY = "kt_bill_bens";
const MAX_TOTAL   = 60;

// Categories where saving makes sense (exclude one-time exam pins, wholesale, loans)
export const BEN_CATS = new Set(["airtime", "data", "electricity", "cable", "betting", "spectranet", "smile"]);

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function persist(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

// The unique key that identifies a beneficiary within a category
function dedupeKey(cat, fields) {
  if (cat === "airtime" || cat === "data") return fields.phone || "";
  if (cat === "electricity")               return fields.meterNo || "";
  if (cat === "cable")                     return fields.smartcard || "";
  if (cat === "betting")                   return `${fields.company || ""}:${fields.customerId || ""}`;
  if (cat === "spectranet" || cat === "smile") return fields.accountNo || "";
  return "";
}

// Which form fields to persist per category
function pickFields(cat, form) {
  if (cat === "airtime")    return { phone: form.phone || "", network: form.network || "" };
  if (cat === "data")       return { phone: form.phone || "", network: form.network || "" };
  if (cat === "electricity") return { meterNo: form.meterNo || "", meterType: form.meterType || "", company: form.company || "", phone: form.phone || "" };
  if (cat === "cable")      return { smartcard: form.smartcard || "", provider: form.provider || "", phone: form.phone || "" };
  if (cat === "betting")    return { customerId: form.customerId || "", company: form.company || "" };
  if (cat === "spectranet") return { accountNo: form.accountNo || "" };
  if (cat === "smile")      return { accountNo: form.accountNo || "" };
  return {};
}

// Human-readable primary label
export function benDisplayName(ben) {
  if (ben.verifyName) return ben.verifyName;
  if (ben.phone)      return ben.phone;
  if (ben.meterNo)    return ben.meterNo;
  if (ben.smartcard)  return ben.smartcard;
  if (ben.customerId) return ben.customerId;
  if (ben.accountNo)  return ben.accountNo;
  return "Saved";
}

// Short secondary label (category + key detail)
export function benSubLabel(ben) {
  const catMap = { airtime: "Airtime", data: "Data", electricity: "Electricity", cable: "Cable TV", betting: "Betting", spectranet: "Spectranet", smile: "Smile 4G" };
  const base = catMap[ben.cat] || ben.cat;
  if ((ben.cat === "airtime" || ben.cat === "data") && ben.network) return `${base} · ${ben.network}`;
  if (ben.cat === "electricity" && ben.meterType)  return `${ben.meterType} meter`;
  if (ben.cat === "cable" && ben.provider)          return ben.provider.toUpperCase();
  if (ben.cat === "betting" && ben.company)         return ben.company;
  return base;
}

// Save (or update) after a successful payment. Safe to call always — skips unsupported cats.
export function saveBeneficiary(cat, form, verifyName = "") {
  if (!BEN_CATS.has(cat)) return;
  const fields = pickFields(cat, form);
  const key = dedupeKey(cat, fields);
  if (!key) return;

  const list = load();
  const idx  = list.findIndex(b => b.cat === cat && dedupeKey(b.cat, b) === key);

  const entry = {
    id:          idx >= 0 ? list[idx].id : `ben_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    cat,
    verifyName:  verifyName || (idx >= 0 ? list[idx].verifyName : ""),
    savedAt:     Date.now(),
    ...fields,
  };

  if (idx >= 0) list.splice(idx, 1);   // remove old position
  list.unshift(entry);                  // most-recent first
  persist(list.slice(0, MAX_TOTAL));
}

// Return saved beneficiaries for a given category (most-recent first)
export function getBeneficiaries(cat) {
  return load().filter(b => b.cat === cat);
}

// Delete a single beneficiary by id
export function deleteBeneficiary(id) {
  persist(load().filter(b => b.id !== id));
}

// Most-recent beneficiaries across all categories — for "Buy again" row
export function getRecentBeneficiaries(limit = 5) {
  return load().slice(0, limit);
}
