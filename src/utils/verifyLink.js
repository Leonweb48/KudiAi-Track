// The verify link of a KudiAI document (receipt KDT-…, report / statement / invoice KDR-…) and the words sent along with
// it when the document is shared — so whoever receives the image or PDF can check it at kudiai.app/verify straight away.

export const verifyLink = (ref) => `https://kudiai.app/verify?ref=${encodeURIComponent(ref)}`;

/** "Verify this receipt (Ref KDT-…): https://kudiai.app/verify?ref=KDT-…" — "" when the document has no reference. */
export function verifyShareText(ref, noun = "document") {
  const r = String(ref || "").trim();
  return r ? `Verify this ${noun} (Ref ${r}): ${verifyLink(r)}` : "";
}

/** A receipt's share text — only a receipt with a stored reference can be looked up (data.hasRef). */
export function receiptShareText(data) {
  return data?.hasRef && data?.receiptRef ? verifyShareText(data.receiptRef, "receipt") : "";
}
