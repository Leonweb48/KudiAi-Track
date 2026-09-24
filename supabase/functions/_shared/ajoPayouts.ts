// Where an approved Ajo withdrawal is on its way to the client's KudiAI Wallet.
//
// The owner approving a withdrawal books it at once, but the money moves owner wallet → client wallet on the NEXT business day
// (ajo_wallet_payouts: pending → paid, or failed). `get-withdrawal-requests` uses these two helpers to tell the client app which
// requests are "processing to wallet" and which payouts are still pending (including ones with no request, e.g. a matured card).

export interface Payout {
  id: string;
  request_id: string | null;
  status: string;
  amount_kobo: number;
  scheduled_date: string;
  paid_at: string | null;
  created_at: string;
}

/**
 * Adds payout_status / payout_amount_kobo / payout_date / payout_paid_at to each request that has a payout. `payouts` must be
 * newest-first: when a request somehow has more than one, the newest wins. Requests without a payout are returned untouched.
 */
export function attachPayouts<R extends { id: string }>(requests: R[], payouts: Payout[]) {
  const byRequest = new Map<string, Payout>();
  for (const p of payouts) if (p.request_id && !byRequest.has(p.request_id)) byRequest.set(p.request_id, p);
  return requests.map((r) => {
    const p = byRequest.get(r.id);
    return p
      ? { ...r, payout_status: p.status, payout_amount_kobo: p.amount_kobo, payout_date: p.scheduled_date, payout_paid_at: p.paid_at }
      : r;
  });
}

/** Payouts that have been approved but have not landed yet — what the wallet shows as Pending. */
export const pendingPayouts = (payouts: Payout[]) => payouts.filter((p) => p.status === "pending");
