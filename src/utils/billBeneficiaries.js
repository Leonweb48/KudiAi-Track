/**
 * Saved bill beneficiaries.
 * localStorage — instant offline access.
 * Supabase bill_beneficiaries — cross-device persistence.
 */

const STORAGE_KEY  = "kt_bill_bens";
const BACKFILL_KEY = "kt_bill_bens_synced";
const MAX_TOTAL    = 60;

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
  if (cat === "airtime")     return { phone: form.phone || "", network: form.network || "" };
  if (cat === "data")        return { phone: form.phone || "", network: form.network || "" };
  if (cat === "electricity") return { meterNo: form.meterNo || "", meterType: form.meterType || "", company: form.company || "", phone: form.phone || "" };
  if (cat === "cable")       return { smartcard: form.smartcard || "", provider: form.provider || "", phone: form.phone || "" };
  if (cat === "betting")     return { customerId: form.customerId || "", company: form.company || "" };
  if (cat === "spectranet")  return { accountNo: form.accountNo || "" };
  if (cat === "smile")       return { accountNo: form.accountNo || "" };
  return {};
}

// Human-readable primary label — nickname wins if set
export function benDisplayName(ben) {
  if (ben.nickname)    return ben.nickname;
  if (ben.verifyName)  return ben.verifyName;
  if (ben.phone)       return ben.phone;
  if (ben.meterNo)     return ben.meterNo;
  if (ben.smartcard)   return ben.smartcard;
  if (ben.customerId)  return ben.customerId;
  if (ben.accountNo)   return ben.accountNo;
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

// ─── localStorage operations (synchronous, offline-first) ────────────────────

export function saveBeneficiary(cat, form, verifyName = "") {
  if (!BEN_CATS.has(cat)) return;
  const fields = pickFields(cat, form);
  const key = dedupeKey(cat, fields);
  if (!key) return;

  const list = load();
  const idx  = list.findIndex(b => b.cat === cat && dedupeKey(b.cat, b) === key);

  const entry = {
    id:         idx >= 0 ? list[idx].id : `ben_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    cat,
    verifyName: verifyName || (idx >= 0 ? list[idx].verifyName : ""),
    nickname:   idx >= 0 ? (list[idx].nickname || "") : "",
    savedAt:    Date.now(),
    ...fields,
  };

  if (idx >= 0) list.splice(idx, 1);
  list.unshift(entry);
  persist(list.slice(0, MAX_TOTAL));
}

export function getBeneficiaries(cat) {
  return load().filter(b => b.cat === cat);
}

export function deleteBeneficiary(id) {
  persist(load().filter(b => b.id !== id));
}

export function getRecentBeneficiaries(limit = 5) {
  return load().slice(0, limit);
}

// ─── Supabase operations (async, cross-device) ───────────────────────────────

function rowToBen(row) {
  return {
    id:         row.id,
    cat:        row.category,
    verifyName: row.verify_name  || "",
    nickname:   row.nickname     || "",
    savedAt:    new Date(row.saved_at).getTime(),
    network:    row.network      || "",
    meterType:  row.meter_type   || "",
    provider:   row.provider     || "",
    company:    row.company      || "",
    phone:      row.phone        || "",
    meterNo:    row.meter_no     || "",
    smartcard:  row.smartcard    || "",
    customerId: row.customer_id  || "",
    accountNo:  row.account_no   || "",
  };
}

function toRow(ownerId, cat, form, verifyName) {
  const fields = pickFields(cat, form);
  return {
    owner_id:    ownerId,
    category:    cat,
    identifier:  dedupeKey(cat, fields),
    verify_name: verifyName || "",
    network:     fields.network    || null,
    meter_type:  fields.meterType  || null,
    provider:    fields.provider   || null,
    company:     fields.company    || null,
    phone:       fields.phone      || null,
    meter_no:    fields.meterNo    || null,
    smartcard:   fields.smartcard  || null,
    customer_id: fields.customerId || null,
    account_no:  fields.accountNo  || null,
    saved_at:    new Date().toISOString(),
  };
}

export async function upsertRemote(sb, ownerId, cat, form, verifyName = "") {
  if (!BEN_CATS.has(cat) || !ownerId) return;
  const row = toRow(ownerId, cat, form, verifyName);
  if (!row.identifier) return;
  await sb.from("bill_beneficiaries").upsert(row, {
    onConflict: "owner_id,category,identifier",
    ignoreDuplicates: false,
  });
}

// One-time backfill: push localStorage entries to Supabase then mark done.
export async function syncLocalToRemote(sb, ownerId) {
  if (!ownerId) return;
  if (localStorage.getItem(BACKFILL_KEY) === "1") return;
  const list = load();
  if (!list.length) { localStorage.setItem(BACKFILL_KEY, "1"); return; }
  const rows = list
    .filter(b => BEN_CATS.has(b.cat))
    .map(b => {
      const identifier = dedupeKey(b.cat, b);
      if (!identifier) return null;
      return {
        owner_id:    ownerId,
        category:    b.cat,
        identifier,
        verify_name: b.verifyName  || "",
        nickname:    b.nickname    || "",
        network:     b.network     || null,
        meter_type:  b.meterType   || null,
        provider:    b.provider    || null,
        company:     b.company     || null,
        phone:       b.phone       || null,
        meter_no:    b.meterNo     || null,
        smartcard:   b.smartcard   || null,
        customer_id: b.customerId  || null,
        account_no:  b.accountNo   || null,
        saved_at:    b.savedAt ? new Date(b.savedAt).toISOString() : new Date().toISOString(),
      };
    })
    .filter(Boolean);
  if (rows.length) {
    await sb.from("bill_beneficiaries").upsert(rows, {
      onConflict: "owner_id,category,identifier",
      ignoreDuplicates: false,
    });
  }
  localStorage.setItem(BACKFILL_KEY, "1");
}

export async function fetchRemoteRecent(sb, ownerId, limit = 5) {
  if (!ownerId) return [];
  const { data } = await sb
    .from("bill_beneficiaries")
    .select("*")
    .eq("owner_id", ownerId)
    .order("saved_at", { ascending: false })
    .limit(limit);
  return (data || []).map(rowToBen);
}

export async function fetchAllRemote(sb, ownerId) {
  if (!ownerId) return [];
  const { data } = await sb
    .from("bill_beneficiaries")
    .select("*")
    .eq("owner_id", ownerId)
    .order("saved_at", { ascending: false });
  return (data || []).map(rowToBen);
}

export async function deleteRemote(sb, id) {
  await sb.from("bill_beneficiaries").delete().eq("id", id);
}

export async function updateRemoteNickname(sb, id, nickname) {
  await sb.from("bill_beneficiaries").update({ nickname }).eq("id", id);
}
