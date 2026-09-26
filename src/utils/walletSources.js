// What each wallet ledger `source` is called, and which icon it gets when it has no bank / provider logo.
// (Lives here — not in WalletPanel.jsx — so the history logic in historyEntries.js can use it without importing a component.
// WalletPanel re-exports it for the screens that already import it from there.)
export const WALLET_SOURCE = {
  topup:               { label: "Wallet funding",     icon: "arrow-down", credit: true },
  sale:                { label: "Payment received",   icon: "arrow-down", credit: true },
  bill_reversal:       { label: "Bill refund",        icon: "arrow-down", credit: true },
  withdrawal_reversal: { label: "Transfer refund",    icon: "arrow-down", credit: true },
  bill_spend:          { label: "Bill payment",       icon: "bills",      credit: false },
  withdrawal:          { label: "Transfer",           icon: "send",       credit: false },
  adjustment:          { label: "Adjustment",         icon: "wallet",     credit: false },
  // Ajo — client wallet -> owner wallet (contribution) and owner -> client
  // (withdrawal payout); label/icon only, actual credit/debit styling always
  // follows row.direction so one entry covers both sides of each source.
  ajo_contribution:    { label: "Savings contribution", icon: "send",       credit: false },
  ajo_collection:      { label: "Contribution received", icon: "arrow-down", credit: true },
  ajo_payout:          { label: "Savings withdrawal",   icon: "send",       credit: false },
  // Client-started esusu circles: members pay into the creator's wallet, payouts come out of it
  peer_esusu_contribution: { label: "Circle contribution",          icon: "send",       credit: false },
  peer_esusu_collection:   { label: "Circle contribution received", icon: "arrow-down", credit: true },
  peer_esusu_payout:       { label: "Circle payout",                icon: "arrow-down", credit: true },
  peer_esusu_payout_sweep: { label: "Circle pot paid out",          icon: "send",       credit: false },
  transfer_fee:        { label: "Transfer fee",         icon: "wallet",     credit: false },
  cbn_levy:            { label: "CBN transfer levy",    icon: "wallet",     credit: false },
  wallet_fee:          { label: "Wallet transfer fee",  icon: "wallet",     credit: false },
};

// Sources that are charges on a transfer — shown with the "%" icon
export const WALLET_FEE_SOURCES = new Set(["transfer_fee", "cbn_levy", "wallet_fee"]);
