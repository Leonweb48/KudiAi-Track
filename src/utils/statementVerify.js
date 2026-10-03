// A statement PDF's verification: a KDR reference saved with its headline figures (report_verifications, the same table
// owner reports use — kudiai.app/verify shows them), and the QR code for its verify link as a module matrix that the
// statement layout draws as vector squares.

import QRCode from "qrcode";
import { supabase } from "./supabase";
import { verifyUrl } from "./statementPdfLayout";

/** { size, isDark(row, col) } for a QR code of `text` (error correction M). */
export function qrMatrix(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: q.modules.size, isDark: (r, c) => !!q.modules.get(r, c) };
}

/**
 * Save the statement's reference — "" when it can't (offline): the PDF is then still made, just without the verify
 * block. Returns { ref, qr } ready for renderStatementPdf's `verify`, or null.
 * @param type savings_statement | wallet_statement | monthly_statement
 * @param fromDate/toDate YYYY-MM-DD (WAT), holderName who it is for, summary [{ label, value }] (≤ 8, as printed)
 */
export async function registerStatement(type, { fromDate, toDate, holderName, summary }) {
  try {
    const { data, error } = await supabase.from("report_verifications")
      .insert({
        report_type: type, period_from: fromDate || null, period_to: toDate || null,
        business_name: String(holderName || "").slice(0, 200) || null,
        summary: (summary || []).slice(0, 8).map((s) => ({ label: String(s.label), value: String(s.value) })),
      })
      .select("ref").single();
    if (error) throw error;
    if (!data?.ref) return null;
    return { ref: data.ref, qr: qrMatrix(verifyUrl(data.ref)) };
  } catch (e) {
    console.warn("[statement] reference not saved:", e?.message || e);
    return null;
  }
}
