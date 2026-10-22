// The verify link of a KudiAI document (receipt KDT-…, report / statement / invoice KDR-…) and the words sent along with
// it when the document is shared — so whoever receives the image or PDF can check it at kudiai.app/verify straight away.

export const verifyLink = (ref) => `https://kudiai.app/verify?ref=${encodeURIComponent(ref)}`;

/**
 * "*Verify this receipt:* https://kudiai.app/verify?ref=KDT-…" — "" when the document has no reference.
 * Owner, 2026-10-22: just the words in bold (WhatsApp's *…* = bold), a colon, then the link — the reference is in the link,
 * so it isn't repeated (the old "(Ref KDT-…)" made the caption a hard-to-read blob).
 */
export function verifyShareText(ref, noun = "document") {
  const r = String(ref || "").trim();
  return r ? `*Verify this ${noun}:* ${verifyLink(r)}` : "";
}

/** A receipt's share text — only a receipt with a stored reference can be looked up (data.hasRef). */
export function receiptShareText(data) {
  return data?.hasRef && data?.receiptRef ? verifyShareText(data.receiptRef, "receipt") : "";
}
