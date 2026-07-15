/**
 * Standardized receipt test fixtures.
 *
 * Data shapes match the common receipt object consumed by ReceiptCard and
 * TransactionDetailModal. Every field that ReceiptCard renders is populated
 * here so the harness exercises the full component, not just the happy path.
 *
 * STRESS RECEIPT
 * ─────────────
 * All three pill states (success / pending / failed) must render the pill
 * with a tight background — not ballooning to the full card width.
 * The fix must not be tuned to 'Successful' only.
 *
 *   Stresses applied:
 *   • Amount: ₦999,999,999.99 — 13-digit formatted string, widest possible
 *   • Business name: 40 characters — wraps in "Issued by" and footer strip
 *   • Reference: KT260715235959ABC — maximum length from receiptFilenames()
 *   • Description: 90-char string — wraps in field value cell
 */

const STRESS_AMOUNT  = 999999999.99;
const STRESS_BIZ     = 'Amaya International Technologies Limited'; // exactly 40 chars
const STRESS_REF     = 'KT260715235959ABC';                        // max length
const STRESS_DATETIME = '15 Jul 2026, 11:59 pm';

const STRESS_FIELDS = [
  { label: 'Transaction Type',  value: 'Income' },
  { label: 'From',              value: 'Mega Wholesale Enterprise Ltd.' },
  { label: 'Description',       value: 'Full payment for Invoice INV-2026-0042 — Annual software subscription, all modules' },
  { label: 'Payment Method',    value: 'Bank Transfer' },
  { label: 'Note',              value: 'End-year settlement · PO/2026/Q4/0042' },
  { label: 'Reference',         value: STRESS_REF, copy: true },
];

export const stressReceiptSuccess = {
  title:         'Payment Received',
  direction:     'in',
  status:        'success',
  amount:        STRESS_AMOUNT,
  datetime:      STRESS_DATETIME,
  fields:        STRESS_FIELDS,
  businessName:  STRESS_BIZ,
  issuedBy:      STRESS_BIZ,
  receiptRef:    STRESS_REF,
  filenames:     { image: 'stress_success.png', pdf: 'stress_success.pdf' },
  processorName: null,
  iconType:      'income',
};

export const stressReceiptPending = {
  ...stressReceiptSuccess,
  status:   'pending',
  title:    'Payment Pending',
  filenames: { image: 'stress_pending.png', pdf: 'stress_pending.pdf' },
};

export const stressReceiptFailed = {
  ...stressReceiptSuccess,
  status:   'failed',
  title:    'Payment Failed',
  filenames: { image: 'stress_failed.png', pdf: 'stress_failed.pdf' },
};

// ── Standard type fixtures (one per type, minimal but complete) ──────────────

export const incomeReceipt = {
  title: 'Payment Received', direction: 'in', status: 'success',
  amount: 15000, datetime: '15 Jul 2026, 10:30 am',
  fields: [
    { label: 'Transaction Type', value: 'Income' },
    { label: 'From',             value: 'Chisom Nwosu' },
    { label: 'Description',      value: 'Product sale — Tomatoes x5' },
    { label: 'Payment Method',   value: 'Cash' },
    { label: 'Reference',        value: 'KT260715103000CHI', copy: true },
  ],
  businessName: 'Nwosu Farms Ltd', issuedBy: 'Nwosu Farms Ltd',
  receiptRef: 'KT260715103000CHI', filenames: { image: 'income.png', pdf: 'income.pdf' },
  processorName: null, iconType: 'income',
};

export const expenseReceipt = {
  title: 'Payment Made', direction: 'out', status: 'success',
  amount: 45000, datetime: '15 Jul 2026, 02:15 pm',
  fields: [
    { label: 'Transaction Type', value: 'Expense' },
    { label: 'To',               value: 'Lagos Market Suppliers' },
    { label: 'Description',      value: 'Stock replenishment — flour, rice, oil' },
    { label: 'Payment Method',   value: 'Bank Transfer' },
    { label: 'Reference',        value: 'KT260715141500LAG', copy: true },
  ],
  businessName: 'Nwosu Farms Ltd', issuedBy: 'Nwosu Farms Ltd',
  receiptRef: 'KT260715141500LAG', filenames: { image: 'expense.png', pdf: 'expense.pdf' },
  processorName: null, iconType: 'expense',
};

export const ajoContributionReceipt = {
  title: 'Ajo Contribution', direction: 'in', status: 'success',
  amount: 20000, datetime: '15 Jul 2026, 09:00 am',
  fields: [
    { label: 'Transaction Type', value: 'Ajo Contribution' },
    { label: 'Member',           value: 'Blessing Okafor' },
    { label: 'Payment Method',   value: 'Cash' },
    { label: 'Reference',        value: 'KT260715090000BLE', copy: true },
  ],
  businessName: 'Ikeja Ajo Cooperative', issuedBy: 'Ikeja Ajo Cooperative',
  receiptRef: 'KT260715090000BLE', filenames: { image: 'ajo_contrib.png', pdf: 'ajo_contrib.pdf' },
  processorName: null, iconType: 'ajo',
};

export const ajoWithdrawalFeeReceipt = {
  title: 'Withdrawal Request', direction: 'out', status: 'pending',
  amount: 95000,  // net after fee
  datetime: '14 Jul 2026, 04:45 pm',
  fields: [
    { label: 'Transaction Type', value: 'Ajo Withdrawal' },
    { label: 'Member',           value: 'Tunde Adeyemi' },
    { label: 'Processing Fee',   value: '₦5,000.00' },
    { label: 'Fee Type',         value: 'Flat' },
    { label: 'Reference',        value: 'KT260714164500TUN', copy: true },
  ],
  businessName: 'Ikeja Ajo Cooperative', issuedBy: 'Ikeja Ajo Cooperative',
  receiptRef: 'KT260714164500TUN', filenames: { image: 'ajo_wd.png', pdf: 'ajo_wd.pdf' },
  processorName: null, iconType: 'ajo',
};

export const esusuPayoutReceipt = {
  title: 'Savings Withdrawal', direction: 'out', status: 'success',
  amount: 150000, datetime: '13 Jul 2026, 11:00 am',
  fields: [
    { label: 'Transaction Type', value: 'Savings Withdrawal' },
    { label: 'Member',           value: 'Fatima Abubakar' },
    { label: 'Payment Method',   value: 'Bank Transfer' },
    { label: 'Balance After',    value: '₦12,750.00' },
    { label: 'Reference',        value: 'KT260713110000FAT', copy: true },
  ],
  businessName: 'Sunrise Cooperative Society', issuedBy: 'Sunrise Cooperative Society',
  receiptRef: 'KT260713110000FAT', filenames: { image: 'esusu_payout.png', pdf: 'esusu_payout.pdf' },
  processorName: null, iconType: 'savings',
};

export const manualDepositReceipt = {
  title: 'Savings Deposit', direction: 'in', status: 'success',
  amount: 50000, datetime: '12 Jul 2026, 08:30 am',
  fields: [
    { label: 'Transaction Type', value: 'Savings Deposit' },
    { label: 'Member',           value: 'Emmanuel Eze' },
    { label: 'Payment Method',   value: 'Cash' },
    { label: 'Balance After',    value: '₦62,750.00' },
    { label: 'Reference',        value: 'KT260712083000EMM', copy: true },
  ],
  businessName: 'Sunrise Cooperative Society', issuedBy: 'Sunrise Cooperative Society',
  receiptRef: 'KT260712083000EMM', filenames: { image: 'manual_deposit.png', pdf: 'manual_deposit.pdf' },
  processorName: null, iconType: 'savings',
};

export const billPaymentReceipt = {
  title: 'Airtime Top-Up', direction: 'out', status: 'success',
  amount: 500, datetime: '15 Jul 2026, 12:00 pm',
  fields: [
    { label: 'Transaction Type', value: 'Airtime Top-Up' },
    { label: 'Network',          value: 'MTN' },
    { label: 'Phone',            value: '08031234567' },
    { label: 'Provider Ref.',    value: 'PS_20260715_MTN_4423' },
    { label: 'Processed via',    value: 'Paystack' },
    { label: 'Reference',        value: 'KT260715120000MTN', copy: true },
  ],
  businessName: 'Nwosu Farms Ltd', issuedBy: 'Nwosu Farms Ltd',
  receiptRef: 'KT260715120000MTN', filenames: { image: 'bill.png', pdf: 'bill.pdf' },
  provider: 'MTN', category: 'airtime',
  processorName: 'Paystack', iconType: null,
};

// All fixtures in test-run order
export const ALL_FIXTURES = [
  { id: 'stress-success',    label: 'Stress — Successful (₦999,999,999.99 · 40-char biz · max ref)', data: stressReceiptSuccess },
  { id: 'stress-pending',    label: 'Stress — Pending pill',                                          data: stressReceiptPending },
  { id: 'stress-failed',     label: 'Stress — Failed pill',                                           data: stressReceiptFailed },
  { id: 'income',            label: 'Sale / Income',                                                  data: incomeReceipt },
  { id: 'expense',           label: 'Disbursement / Expense',                                         data: expenseReceipt },
  { id: 'ajo-contribution',  label: 'Ajo Contribution',                                               data: ajoContributionReceipt },
  { id: 'ajo-withdrawal',    label: 'Ajo Withdrawal + fee breakdown',                                  data: ajoWithdrawalFeeReceipt },
  { id: 'esusu-payout',      label: 'Esusu / Coop Savings Payout',                                    data: esusuPayoutReceipt },
  { id: 'manual-deposit',    label: 'Manual Deposit Confirmation',                                    data: manualDepositReceipt },
  { id: 'bill-payment',      label: 'Bill Payment (Airtime)',                                          data: billPaymentReceipt },
];
