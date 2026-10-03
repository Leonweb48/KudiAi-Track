// Wallet statement PDF — now drawn by the shared statement layout (statementPdfLayout.js), which also draws clients'
// savings statements and the monthly statement they are emailed. Kept as the wallet statement's entry point.

export {
  walletEntries as buildStatementEntries,
  groupByMonth,
  renderWalletStatementPdf,
} from "./statementPdfLayout";
