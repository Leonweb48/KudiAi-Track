// What a HISTORY ROW shows for a transaction, OPay-style: who the money went to / came from (or which bill it paid), with that bank's
// or provider's logo, a status pill and — for the wallet — a title like "Transfer to ADA OBI" / "Transfer from CHIDI OKEKE".
//
// Pure functions, no React: the wallet list, the general history (owner, staff, manager) and the client portal all build their rows
// from these, so a transfer looks the same everywhere and the receipt behind the row names the same bank.
//
//   walletEntry(ledgerRow, ctx)  → { title, status, direction, avatar }      ctx is the same as the receipt's (withdrawal, request,
//                                                                            originator, originatorBank, recipientBankName)
//   txEntry(transactionRow)      → { status, bill }                          bill = { logoUrl, name, icon } for a bill payment, else null
//   billVisual({ category, text, record }) → { logoUrl, name, icon }         the logo (or icon) of a bill from any text / record
//
// avatar = { logoUrl (null without one), name, icon, dir ('in' | 'out' | null — the little arrow badge on a bank logo), tone }

import { describeBank } from "./bankLogos";
import { discoFromText, discoFromRecord, electricityLogoUrl, DISCO_LABELS } from "./electricityLogos";
import { billBrandFromText, billBrandFromRecord, billLogoUrl } from "./billLogos";
import { getProviderLogo } from "./logoMap";
import { WALLET_SOURCE, WALLET_FEE_SOURCES } from "./walletSources";

export const NETWORK_CATEGORIES = new Set(["airtime", "data", "print-airtime", "print-data", "airtime-bundle"]);
export const BILL_CATEGORIES = new Set(["airtime", "data", "cable", "electricity", "betting", "waec", "jamb", "spectranet", "smile", "print-airtime", "print-data", "airtime-bundle"]);

// The icon a bill gets when it has no logo (paths live in components/shared/HistoryRow.jsx)
const ICON_FOR_CATEGORY = {
  electricity: "bulb", airtime: "phone", data: "phone", "print-airtime": "phone", "print-data": "phone", "airtime-bundle": "phone",
  cable: "tv", spectranet: "wifi", smile: "wifi", waec: "book", jamb: "book", betting: "bills",
};

/** "MTN" | "Airtel" | "Glo" | "9mobile" named anywhere in a text, or null */
export function networkFromText(text) {
  const t = String(text ?? "");
  if (/\bmtn\b/i.test(t)) return "MTN";
  if (/\bairtel\b/i.test(t)) return "Airtel";
  if (/\bglo\b/i.test(t)) return "Glo";
  if (/9\s?mobile|etisalat/i.test(t)) return "9mobile";
  return null;
}

/** "ADA OBI" → "Ada Obi" (a name a bank shouts is tidied; one that already has lower-case letters is left alone) */
export function tidyName(name) {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

// A bill's category, guessed from its text when the row does not carry one (a wallet ledger row only has a narration)
function guessCategory(t) {
  if (/electric|\bmeter\b|\btoken\b|prepaid|postpaid/i.test(t)) return "electricity";
  if (/dstv|gotv|startimes?|showmax|cable/i.test(t)) return "cable";
  // the named providers before the generic "data" test below — "Spectranet 20GB" is a Spectranet plan, not a phone data bundle
  if (/spectranet/i.test(t)) return "spectranet";
  if (/\bsmile\b/i.test(t)) return "smile";
  if (/waec/i.test(t)) return "waec";
  if (/jamb/i.test(t)) return "jamb";
  if (/wallet top-?up|\bbet/i.test(t)) return "betting";
  if (/airtime/i.test(t)) return "airtime";
  if (/\bdata\b|\d+(\.\d+)?\s?(gb|mb)\b/i.test(t)) return "data";
  return null;
}

/**
 * The logo (and fallback icon) of a bill. Give it the row's category when it has one, the text it carries (item name, note or
 * narration) and — for a stored bill — the record itself, so the raw codes the payment webhook stores are understood too.
 */
export function billVisual({ category, text, record } = {}) {
  const t = String(text ?? "");
  const cat = category || (record && record.category) || guessCategory(t);

  if (cat === "electricity" || !cat) {
    const disco = record ? discoFromRecord({ ...record, category: "electricity" }) : discoFromText(t, { allowNames: cat === "electricity" });
    if (disco && electricityLogoUrl(disco)) return { logoUrl: electricityLogoUrl(disco), name: DISCO_LABELS[disco] || disco, icon: "bulb" };
    if (cat === "electricity") return { logoUrl: null, name: null, icon: "bulb" };
  }

  const brand = record && cat ? billBrandFromRecord({ ...record, category: cat }) : billBrandFromText(t, cat || undefined);
  if (brand) return { logoUrl: billLogoUrl(brand), name: brand.name, icon: ICON_FOR_CATEGORY[brand.category] || "bills" };

  if ((cat && NETWORK_CATEGORIES.has(cat)) || (!cat && /airtime|\bdata\b/i.test(t))) {
    const net = networkFromText(t);
    return { logoUrl: net ? getProviderLogo(net, "airtime") : null, name: net, icon: "phone" };
  }
  return { logoUrl: null, name: null, icon: (cat && ICON_FOR_CATEGORY[cat]) || "bills" };
}

/** A status pill: { key, label, tone } — tone is ok | pending | failed | muted */
export function statusOf(status, credit = false) {
  if (status === "pending" || status === "processing") return { key: "pending", label: credit ? "Pending" : "Processing", tone: "pending" };
  if (status === "reversed") return { key: "reversed", label: "Reversed", tone: "muted" };
  if (status === "failed" || status === "rejected") return { key: "failed", label: "Failed", tone: "failed" };
  return { key: "success", label: "Successful", tone: "ok" };
}

const humanize = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A wallet ledger row as a history entry.
 * ctx (all optional, same as the receipt's): withdrawal (wallet_withdrawals row), request (wallet_payment_requests row),
 *   originator (who paid in), originatorBank (their bank), recipientBankName (resolved from the withdrawal's bank code)
 */
export function walletEntry(row, ctx = {}) {
  const src = row.source;
  const credit = row.direction === "credit";
  const dir = credit ? "in" : "out";
  const cfg = WALLET_SOURCE[src] || { label: humanize(src), icon: "wallet" };
  const narration = String(row.narration || ctx.withdrawal?.narration || "").trim();

  let title = cfg.label;
  let bank = null;
  let bill = null;

  if (src === "withdrawal") {
    const who = tidyName(ctx.withdrawal?.account_name);
    if (who) title = `Transfer to ${who}`;
    bank = describeBank({ code: ctx.withdrawal?.bank_code, name: ctx.recipientBankName || ctx.withdrawal?.bank_name });
  } else if (src === "topup" || src === "sale") {
    const who = tidyName(ctx.request?.customer_name || ctx.originator);
    if (who) title = src === "sale" ? `Payment from ${who}` : `Transfer from ${who}`;
    bank = describeBank({ name: ctx.originatorBank });
  } else if (src === "bill_spend" || src === "bill_reversal") {
    const head = narration.split(/\s+[—–-]\s+/)[0].trim();
    if (head) title = src === "bill_reversal" ? `Refund: ${head}` : head;
    bill = billVisual({ text: narration });
  }

  const status = statusOf(row.status, credit);
  const logoUrl = (bank && bank.logoUrl) || (bill && bill.logoUrl) || null;
  const icon = bill ? bill.icon
    : WALLET_FEE_SOURCES.has(src) ? "percent"
    : cfg.icon === "wallet" ? "wallet"
    : credit ? "down" : "up";
  return {
    title,
    status,
    direction: dir,
    avatar: {
      logoUrl,
      name: (bank && bank.name) || (bill && bill.name) || null,
      icon,
      dir: bank && bank.logoUrl ? dir : null,      // the arrow badge only rides on a bank's logo (a bill is always money out)
      tone: status.tone,
    },
  };
}

/** A general-history transaction row: its status pill, and — for a bill payment — the provider's logo / icon. */
export function txEntry(tx) {
  const isBill = tx.payment_type === "bill_payment" || (BILL_CATEGORIES.has(tx.category) && tx.type !== "in");
  const bill = isBill
    ? billVisual({ category: BILL_CATEGORIES.has(tx.category) ? tx.category : undefined, text: `${tx.item_name || ""} ${tx.note || ""}`, record: tx })
    : null;
  const st = tx.bill_status === "failed" ? "failed" : tx._pending || tx.bill_status === "pending" ? "pending" : "completed";
  return { status: statusOf(st, tx.type === "in"), bill };
}
