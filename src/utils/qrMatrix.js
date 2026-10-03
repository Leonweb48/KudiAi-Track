// A QR code as a module matrix — { size, isDark(row, col) } — drawn by the PDF engines as vector squares (no canvas, so
// the same drawing works on the server). Error correction M, the library the server uses too (npm:qrcode@1.5.4).

import QRCode from "qrcode";

export function qrMatrix(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: q.modules.size, isDark: (r, c) => !!q.modules.get(r, c) };
}
