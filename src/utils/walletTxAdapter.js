// Adapts wallet_ledger rows into the same shape TxRow (components/shared/TxRow.jsx)
// already renders for regular business transactions, so wallet activity is
// listed/searchable in the SAME "Recent Transactions" list and search box —
// not a separate, easy-to-miss screen. Display-only: this never feeds into
// useStore's own `transactions` state, which profit/liability calculations
// elsewhere depend on meaning exactly "a booked sale or expense" — merging
// wallet rows into that array would silently corrupt those numbers.
import { WALLET_TITLES } from "./receiptConfig";

function humanize(s) {
  return String(s || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// True if a wallet_ledger row already has its own row in `transactions`
// (bill payments, expense-booked transfers, sales) via related_txn_id —
// skip those here so the same real-world event is never listed twice.
export function isStandaloneWalletRow(row) {
  return !row?.related_txn_id;
}

export function walletLedgerToTxShape(row) {
  const isCredit = row.direction === "credit";
  const createdAt = row.created_at ? new Date(row.created_at) : new Date();
  return {
    id:               `wallet-${row.id}`,
    __source:         "wallet",
    __raw:            row,
    __sortKey:        createdAt.getTime(),
    type:             isCredit ? "in" : "out",
    category:         "wallet",
    payment_type:     "wallet",
    item_name:        WALLET_TITLES[row.source] || humanize(row.source),
    customer_name:    (row.narration || "").trim(),
    amount:           Number(row.amount_kobo || 0) / 100,
    transaction_date: createdAt.toISOString().split("T")[0],
  };
}

// Merges real transactions with standalone wallet_ledger rows into one
// chronological array (sorted newest first, matching how `transactions`
// already arrives from useStore). Regular transaction rows are passed
// through untouched — only the added wallet rows carry __sortKey, so real
// transactions are ordered exactly as before relative to each other; the
// sort is only needed to correctly interleave the two sources.
export function mergeWithWalletHistory(transactions, walletLedger) {
  const walletRows = (walletLedger || [])
    .filter(isStandaloneWalletRow)
    .map(walletLedgerToTxShape);
  if (walletRows.length === 0) return transactions;
  const combined = [...transactions, ...walletRows];
  combined.sort((a, b) => {
    const ak = a.__sortKey ?? new Date(a.created_at || a.transaction_date || 0).getTime();
    const bk = b.__sortKey ?? new Date(b.created_at || b.transaction_date || 0).getTime();
    return bk - ak;
  });
  return combined;
}
