// Where an APPROVED client withdrawal is on its way to the client's KudiAI Wallet, in the client's own words.
//
// The owner approving a withdrawal books it against the client's savings straight away, but the money itself moves owner wallet →
// client wallet on the NEXT business day (ajo_wallet_payouts: pending → paid, or failed). The `get-withdrawal-requests` function
// attaches that payout state to each request (payout_status / payout_date / payout_amount_kobo). Requests that are still waiting
// for the owner ("pending") or were declined ("rejected") keep the app's existing wording — this only describes approved ones.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-28" → "Mon 28 Sep" (a plain calendar date, so no timezone shift). "" when unreadable. */
export function expectedDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const STAGE_CLS = {
  blue:   "bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300",
  green:  "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400",
  orange: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400",
};

/**
 * @returns {{ key: "processing"|"paid"|"delayed"|"approved", label: string, tone: "blue"|"green"|"orange", detail: string } | null}
 *          null for a request that is not approved (the caller keeps its own wording for those).
 */
export function withdrawalStage(r) {
  if (!r || r.status !== "approved") return null;
  switch (r.payout_status) {
    case "pending": {
      const day = expectedDay(r.payout_date);
      return { key: "processing", label: "Approved · processing to wallet", tone: "blue", detail: day ? `Expected in your wallet ${day}` : "Arrives in your wallet on the next business day" };
    }
    case "paid":
      return { key: "paid", label: "Approved · paid to wallet", tone: "green", detail: "" };
    case "failed":
      return { key: "delayed", label: "Approved · wallet payout delayed", tone: "orange", detail: "Your agent has been told — it will be retried" };
    default:
      return { key: "approved", label: "Approved", tone: "green", detail: "" };
  }
}
