// WAEC and JAMB e-PIN prices and product codes, from the provider's own catalogue.
//
// Why this exists: the app sold WAEC/JAMB PINs without ever knowing their price — checkout stopped at "Invalid amount"
// before reaching the server. The price now comes from the provider that would sell the PIN (exam-price action), and the
// purchase uses the provider's own product code. Shapes below are ClubKonnect's live answers (2026-09-29):
//   APIWAECPackagesV2 → {"EXAM_TYPE":[{"PRODUCT_CODE":"waec-registraion","PRODUCT_DESCRIPTION":"WAEC Registration PIN",
//                        "PRODUCT_AMOUNT":"37500.00"},{"PRODUCT_CODE":"waecdirect",...,"PRODUCT_AMOUNT":"5350.00"}]}
//   APIJAMBPackagesV2 → {"EXAM_TYPE":[]}   (JAMB PINs are seasonal — an empty list means none on sale)
// ClubKonnect (like VTpass) spells the registration product "waec-registraion"; the app says "waec-registration".

export interface ExamProduct { code: string; name: string; amount: number }

/** The app's exam codes → other spellings a provider may use for the same product. */
export const EXAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "waec-registration": ["waec-registraion"],
};

/** ClubKonnect's WAEC/JAMB package list → products with a usable price. Anything malformed is skipped, never thrown. */
export function parseCkExamCatalogue(d: unknown): ExamProduct[] {
  const root = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
  const list = root.EXAM_TYPE ?? root.exam_type ?? root.PRODUCT ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((p: Record<string, unknown>) => ({
      code: String(p?.PRODUCT_CODE ?? p?.PRODUCT_ID ?? "").trim(),
      name: String(p?.PRODUCT_DESCRIPTION ?? p?.PRODUCT_NAME ?? "").trim(),
      amount: Math.round((Number(p?.PRODUCT_AMOUNT) || 0) * 100) / 100,
    }))
    .filter((p) => p.code && p.amount > 0);
}

/** The product for an app exam code: its own code first, then a known alias. null = not on sale. */
export function findExamProduct(list: ExamProduct[], examType: string): ExamProduct | null {
  const want = [examType, ...(EXAM_ALIASES[examType] ?? [])].map((c) => c.toLowerCase());
  for (const w of want) {
    const hit = list.find((p) => p.code.toLowerCase() === w);
    if (hit) return hit;
  }
  return null;
}

/** The code to send the provider: the catalogue's own code when known, else the first alias (the provider's spelling). */
export function providerExamCode(list: ExamProduct[], examType: string): string {
  return findExamProduct(list, examType)?.code ?? EXAM_ALIASES[examType]?.[0] ?? examType;
}
