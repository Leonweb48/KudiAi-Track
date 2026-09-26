// Electricity distribution company (DISCO) logos + one place that works out WHICH DISCO a bill belongs to.
//
// The logo files live in public/logos/electricity logos/ (the folder name has a space, so every URL is encoded).
// A bill record can name its DISCO in several shapes, all handled here so the bill screen, the receipt card, the receipt
// PDF and the history list agree:
//   • "EKEDC (Eko)"            – client-recorded provider / item name (abbreviation in front)
//   • "Eko Electricity …"      – a full company name
//   • "01 Electric"            – the payment webhook stores the ClubKonnect company CODE instead of a name
//   • bill_details.company     – structured field when present

export const ELECTRICITY_LOGO_DIR = "/logos/electricity logos/";

// DISCO → file inside the folder. Exactly as named in the folder; APLE has no new logo yet (falls back to its old badge).
export const ELECTRICITY_LOGO_FILES = {
  AEDC:  "aedc (abuja).jpg",
  BEDC:  "bedc (benini).jpg",
  EEDC:  "eedc (Enugu).jpg",
  EKEDC: "ekedc (Eko).png",
  IBEDC: "ibedc (ibadan).jpg",
  IKEDC: "ikedc (ikeja).jpg",
  JEDC:  "jedc (jos).jpg",
  KAEDC: "kaedc (kaduna).jpg",
  KEDC:  "kedc (kano).png",
  PHEDC: "phedc (port harcout).png",
  YEDC:  "yedc (yola).jpg",
};

// ClubKonnect electricity company codes used by the app (BillPayments ELECTRICITY_COMPANIES)
export const DISCO_BY_CODE = {
  "01": "EKEDC", "02": "IKEDC", "03": "AEDC", "04": "KEDC", "05": "PHEDC", "06": "JEDC",
  "07": "IBEDC", "08": "KAEDC", "09": "EEDC", "10": "BEDC", "11": "YEDC", "12": "APLE",
};

// Word-bounded so "AEDC" never matches inside "KAEDC" and "KEDC" never matches inside "EKEDC".
const ABBREVIATION = /\b(EKEDC|IKEDC|KAEDC|AEDC|PHEDC|JEDC|IBEDC|KEDC|EEDC|BEDC|YEDC|APLE)\b/i;

// Company / city names, for records that carry the long name. "Abuja" is deliberately last: APLE is also in Abuja and
// carries its abbreviation, which is matched first.
const NAME_HINTS = [
  [/\beko\b/i, "EKEDC"], [/\bikeja\b/i, "IKEDC"], [/\bport[\s-]*harcourt\b/i, "PHEDC"], [/\bkaduna\b/i, "KAEDC"],
  [/\bibadan\b/i, "IBEDC"], [/\benugu\b/i, "EEDC"], [/\bbenin\b/i, "BEDC"], [/\bkano\b/i, "KEDC"],
  [/\byola\b/i, "YEDC"], [/\bjos\b/i, "JEDC"], [/\babuja\b/i, "AEDC"],
];

// Display names, as shown in the bill screen
export const DISCO_LABELS = {
  EKEDC: "EKEDC (Eko)", IKEDC: "IKEDC (Ikeja)", AEDC: "AEDC (Abuja)", KEDC: "KEDC (Kano)", PHEDC: "PHEDC (Port Harcourt)", JEDC: "JEDC (Jos)",
  IBEDC: "IBEDC (Ibadan)", KAEDC: "KAEDC (Kaduna)", EEDC: "EEDC (Enugu)", BEDC: "BEDC (Benin)", YEDC: "YEDC (Yola)", APLE: "APLE (Abuja)",
};

/** The DISCO named by one piece of text ("EKEDC (Eko) Prepaid", "Ikeja Electric"), or null. */
export function discoFromText(text, { allowNames = true } = {}) {
  const s = String(text ?? "");
  if (!s.trim()) return null;
  const abbr = s.match(ABBREVIATION);
  if (abbr) return abbr[1].toUpperCase();
  if (allowNames) for (const [rx, disco] of NAME_HINTS) if (rx.test(s)) return disco;
  return null;
}

/**
 * The DISCO a stored bill / transaction belongs to. Looks at the fields most likely to name it, most reliable first.
 * The free-text note is only searched for an ABBREVIATION (a customer name in it must never be read as a city).
 */
export function discoFromRecord(bill) {
  if (!bill || typeof bill !== "object") return null;
  const bd = bill.bill_details || {};
  const named = [bd.provider, bd.company, bd.disco, bill.providerName, bill.provider, bill.item_name];
  for (const v of named) { const d = discoFromText(v); if (d) return d; }
  // the webhook writes the company code in front of the item name: "01 Electric"
  const code = String(bill.item_name ?? "").match(/^\s*(\d{2})\b/)?.[1] || String(bd.company ?? "").match(/^\d{2}$/)?.[0];
  if (code && DISCO_BY_CODE[code]) return DISCO_BY_CODE[code];
  const fromNote = String(bill.note ?? "").match(/Provider:\s*([^|]+)/i)?.[1];
  return discoFromText(fromNote) || discoFromText(bill.note, { allowNames: false });
}

/** URL of the new logo for a DISCO ("EKEDC" → "/logos/electricity%20logos/ekedc%20(Eko).png"), or null when it has none. */
export function electricityLogoUrl(disco) {
  const file = ELECTRICITY_LOGO_FILES[String(disco ?? "").toUpperCase()];
  return file ? encodeURI(ELECTRICITY_LOGO_DIR + file) : null;
}
