// Amount in words, cheque style, for the receipt PDF:
//   15000    -> "FIFTEEN THOUSAND NAIRA ONLY"
//   1250.75  -> "ONE THOUSAND TWO HUNDRED AND FIFTY NAIRA, SEVENTY-FIVE KOBO ONLY"
//   0.5      -> "FIFTY KOBO ONLY"
// Returns "" for anything that is not a usable amount, so a caller can simply
// leave the line out rather than print something wrong.

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const SCALES = ["", "THOUSAND", "MILLION", "BILLION", "TRILLION"];

// 1..999
function belowThousand(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} HUNDRED`);
  if (r) {
    const t = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
    parts.push(h ? `AND ${t}` : t);
  }
  return parts.join(" ");
}

export function integerToWords(n) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return "";
  if (n === 0) return "ZERO";
  const groups = [];
  let rest = Math.floor(n);
  while (rest > 0) { groups.push(rest % 1000); rest = Math.floor(rest / 1000); }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    words.push(belowThousand(groups[i]) + (SCALES[i] ? ` ${SCALES[i]}` : ""));
  }
  let out = words.join(" ");
  // "ONE THOUSAND AND FIFTY", "ONE MILLION AND ONE": a bare tens/units tail after a bigger group.
  if (groups.length > 1 && groups[0] > 0 && groups[0] < 100) {
    const tail = belowThousand(groups[0]);
    out = out.slice(0, out.length - tail.length) + `AND ${tail}`;
  }
  return out;
}

export function amountToWords(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  const kobo = Math.round(Math.abs(value) * 100);
  const naira = Math.floor(kobo / 100);
  const minor = kobo % 100;
  const nairaWords = integerToWords(naira);
  if (!nairaWords) return "";
  if (!minor) return `${nairaWords} NAIRA ONLY`;
  const koboWords = integerToWords(minor);
  return naira ? `${nairaWords} NAIRA, ${koboWords} KOBO ONLY` : `${koboWords} KOBO ONLY`;
}
