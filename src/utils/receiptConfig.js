// Builds standardized receipt data from raw transaction records per screen type.
// Every function returns a common shape consumed by TransactionDetailModal + ReceiptCard.

import { ledgerTypeLabel } from './helpers';

// Change this when migrating payment processors (e.g. to Anchor).
export const PROCESSOR_NAME = 'Paystack';

export function formatReceiptDateTime(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    return d.toLocaleString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return String(dt); }
}

// Filenames are `<title>_<ref>_<YYYYMMDD-HHMM>.<ext>` e.g.
//   airtime-top-up_KT260910143012ABC_20260910-1430.pdf
export function receiptFilenames(id, createdAt, title) {
  const d = createdAt ? new Date(createdAt) : new Date();
  const pad = n => String(n).padStart(2, '0');
  const yy  = String(d.getFullYear()).slice(2);
  const mm  = pad(d.getMonth() + 1);
  const dd  = pad(d.getDate());
  const hh  = pad(d.getHours());
  const mi  = pad(d.getMinutes());
  const ss  = pad(d.getSeconds());
  const suffix = String(id || '').replace(/-/g, '').slice(0, 3).toUpperCase() || '000';
  const ref = `KT${yy}${mm}${dd}${hh}${mi}${ss}${suffix}`;
  const slug = String(title || 'receipt')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'receipt';
  const base = `${slug}_${ref}_${d.getFullYear()}${mm}${dd}-${hh}${mi}`;
  return { ref, image: `${base}.png`, pdf: `${base}.pdf` };
}

// Locale-independent: always produces ₦15,000.00 regardless of WebView locale.
function fmtAmt(n) {
  const [int, dec] = Number(n || 0).toFixed(2).split('.');
  return '₦' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function humanize(s) {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Standard transaction (income/expense from Transactions screen) ─────────────
export function buildTransactionReceipt(txn, profile) {
  const isIn   = txn.type === 'in';
  const status =
    txn._pending         ? 'pending' :
    txn.bill_status === 'failed' ? 'failed' : 'success';

  const isMulti = Array.isArray(txn.line_items) && txn.line_items.length > 1;
  const liFields = isMulti
    ? txn.line_items.map(li => ({
        label: li.name ? `${li.name}${(li.qty || 1) > 1 ? ` ×${li.qty}` : ''}` : '—',
        value: fmtAmt(li.lineTotal),
      }))
    : [];
  const title = isMulti
    ? `${txn.line_items.length} items`
    : txn.item_name || humanize(txn.category) || (isIn ? 'Payment Received' : 'Payment Made');
  const { ref, image, pdf } = receiptFilenames(txn.id, txn.created_at || txn.transaction_date, title);

  return {
    title,
    direction:   isIn ? 'in' : 'out',
    status,
    amount:      txn.amount,
    datetime:    formatReceiptDateTime(txn.created_at || txn.transaction_date),
    fields: [
      ...liFields,
      { label: 'Transaction Type', value: isIn ? 'Income' : 'Expense' },
      txn.customer_name && { label: isIn ? 'From'  : 'To',     value: txn.customer_name },
      !isMulti && txn.item_name && { label: 'Description',      value: txn.item_name },
      txn.category      && { label: 'Category',                 value: humanize(txn.category) },
      txn.payment_type  && { label: 'Payment Method',           value: humanize(txn.payment_type) },
      !isMulti && txn.quantity > 1 && { label: 'Quantity',      value: String(txn.quantity) },
      txn.note          && { label: 'Note',                     value: txn.note },
      txn.staff_name    && { label: 'Recorded by',              value: txn.staff_name },
                           { label: 'Reference',                value: ref, copy: true },
    ].filter(Boolean),
    businessName:  profile?.business_name || 'My Business',
    issuedBy:      profile?.business_name || 'My Business',
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      isIn ? 'income' : 'expense',
  };
}

// ── Ajo/Aso contribution or withdrawal (from Aso screen) ─────────────────────
function buildDestinationLabel(contribution) {
  const ctx  = contribution.contribution_context || 'personal_savings';
  const type = contribution.type || '';
  const grp  = contribution.group_name || '';
  const cyc  = contribution.cycle_label || '';
  const rnd  = contribution.round_number ? ` (Round ${contribution.round_number})` : '';

  if (type === 'registration_fee')  return `Registration fee — one-time`;
  if (type === 'commission')         return `Collector's fee — Day 1${cyc ? ` of ${cyc}` : ''}`;
  if (type === 'withdrawal_fee')     return `Withdrawal fee${cyc ? ` — ${contribution.fee_percent ? contribution.fee_percent + '% of ' : ''}${cyc}` : ''}`;
  if (type === 'disbursement' && grp) {
    if (ctx === 'esusu_rotation') return `Esusu payout — ${grp}${rnd}, your turn`;
    return `Savings group release — ${grp}`;
  }
  if (type === 'group_release' && grp) return `Released from savings group — ${grp}`;
  if (type === 'withdrawal') {
    if (grp) return `From: Released group funds — ${grp}`;
    return `From: Personal Savings${cyc ? ` — ${cyc}` : ''}`;
  }
  if (ctx === 'esusu_rotation')  return `To: Esusu — ${grp}${rnd}`;
  if (ctx === 'group_savings')   return `To: Savings Group — ${grp}`;
  return `To: Personal Savings${cyc ? ` — ${cyc}` : ''}`;
}

export function buildAsoContributionReceipt(contribution, clientName, businessName, recordedByName) {
  const isWithdrawal = contribution.type === 'withdrawal';
  const isReg        = contribution.type === 'registration_fee';
  const status       = contribution.status === 'pending' ? 'pending' : 'success';
  const { ref, image, pdf } = receiptFilenames(contribution.id, contribution.created_at || contribution.date);
  const destination  = buildDestinationLabel(contribution);

  return {
    title:     isReg ? 'Registration Fee' : isWithdrawal ? 'Withdrawal' : 'Contribution',
    direction: isWithdrawal ? 'out' : 'in',
    status,
    amount:    contribution.amount,
    datetime:  formatReceiptDateTime(contribution.created_at || contribution.date),
    fields: [
      { label: 'Transaction Type', value: isReg ? 'Registration Fee' : isWithdrawal ? 'Ajo Withdrawal' : 'Ajo Contribution' },
      destination                 && { label: isWithdrawal ? 'From' : 'To',  value: destination },
      clientName                  && { label: 'Member',         value: clientName },
      contribution.payment_method && { label: 'Payment Method', value: humanize(contribution.payment_method) },
      contribution.notes          && { label: 'Note',           value: contribution.notes },
      recordedByName              && { label: 'Recorded by',    value: recordedByName },
                                     { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'ajo',
  };
}

// ── Ajo withdrawal request (from AjoMemberPortal screen) ─────────────────────
export function buildAjoWithdrawalReceipt(req, clientName, businessName) {
  const statusMap = { pending: 'pending', approved: 'success', rejected: 'failed' };
  const { ref, image, pdf } = receiptFilenames(req.id, req.requested_at, 'Withdrawal Request');
  const destination = req.group_name
    ? `From: Released group funds — ${req.group_name}`
    : `From: Personal Savings${req.cycle_label ? ` — ${req.cycle_label}` : ''}`;

  return {
    title:     'Withdrawal Request',
    direction: 'out',
    status:    statusMap[req.status] || 'pending',
    amount:    req.net_amount ?? req.amount,
    datetime:  formatReceiptDateTime(req.requested_at),
    fields: [
      { label: 'Transaction Type', value: 'Ajo Withdrawal' },
      destination        && { label: 'From',           value: destination },
      clientName         && { label: 'Member',         value: clientName },
      req.fee_amount > 0 && { label: 'Processing Fee', value: fmtAmt(req.fee_amount) },
      req.fee_type       && { label: 'Fee Type',        value: humanize(req.fee_type) },
                            { label: 'Reference',       value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          req.fee_amount || 0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'ajo',
  };
}

// ── Debt repayment (from Credit screen) ────────────────────────────────────
export function buildCreditPaymentReceipt(payment, credit, businessName) {
  const { ref, image, pdf } = receiptFilenames(payment.id, payment.created_at || payment.payment_date, 'Debt Repayment');
  const remaining = (credit?.outstanding != null && payment.amount != null)
    ? credit.outstanding - payment.amount : null;

  return {
    title:     'Debt Repayment',
    direction: 'in',
    status:    'success',
    amount:    payment.amount,
    datetime:  formatReceiptDateTime(payment.created_at || payment.payment_date),
    fields: [
      { label: 'Transaction Type', value: 'Debt Repayment' },
      credit?.customer_name  && { label: 'Customer',          value: credit.customer_name },
      payment.payment_method && { label: 'Payment Method',    value: humanize(payment.payment_method) },
      remaining != null      && { label: 'Remaining Balance', value: fmtAmt(remaining) },
      payment.notes          && { label: 'Note',              value: payment.notes },
                                { label: 'Reference',          value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'credit',
  };
}

// ── Coop savings deposit/withdrawal (from CoopMemberPortal / CoopDashboard) ──
export function buildCoopSavingsReceipt(record, memberName, orgName) {
  const isWithdrawal = record.type === 'withdrawal';
  const { ref, image, pdf } = receiptFilenames(record.id, record.created_at);

  return {
    title:     isWithdrawal ? 'Savings Withdrawal' : 'Savings Deposit',
    direction: isWithdrawal ? 'out' : 'in',
    status:    'success',
    amount:    record.amount,
    datetime:  formatReceiptDateTime(record.created_at),
    fields: [
      { label: 'Transaction Type', value: isWithdrawal ? 'Savings Withdrawal' : 'Savings Deposit' },
      memberName                    && { label: 'Member',         value: memberName },
      record.payment_method         && { label: 'Payment Method', value: humanize(record.payment_method) },
      record.balance_after != null  && { label: 'Balance After',  value: fmtAmt(record.balance_after) },
                                       { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName:  orgName,
    issuedBy:      orgName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'savings',
  };
}

// ── Coop withdrawal request (from CoopMemberPortal) ──────────────────────────
export function buildCoopWithdrawalRequestReceipt(request, memberName, orgName) {
  const statusMap = { pending: 'pending', approved: 'success', rejected: 'failed' };
  const { ref, image, pdf } = receiptFilenames(request.id, request.created_at, 'Withdrawal Request');

  return {
    title:     'Withdrawal Request',
    direction: 'out',
    status:    statusMap[request.status] || 'pending',
    amount:    request.amount,
    datetime:  formatReceiptDateTime(request.created_at),
    fields: [
      { label: 'Transaction Type', value: 'Savings Withdrawal' },
      memberName       && { label: 'Member',    value: memberName },
      request.reason   && { label: 'Reason',    value: request.reason },
      request.status   && { label: 'Status',    value: humanize(request.status) },
                          { label: 'Reference', value: ref, copy: true },
    ].filter(Boolean),
    businessName:  orgName,
    issuedBy:      orgName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'savings',
  };
}

// ── Ajo contribution (logged — from AjoMemberPortal history list) ────────────
// periodSplit: optional { splits: [{idx, amount}] } from allocateForReceipt —
// when provided, adds per-period breakdown rows to the receipt fields.
export function buildAjoContributionReceipt(contribution, clientName, businessName, periodSplit = null) {
  const t        = contribution.type || '';
  const label    = t === 'contribution' ? 'Ajo Contribution'
                 : t === 'withdrawal'   ? 'Ajo Withdrawal'
                 : ledgerTypeLabel(contribution);
  const isOut    = t === 'withdrawal' || t === 'withdrawal_fee' || t === 'registration_fee'
                 || t === 'commission' || t.startsWith('reversal_');
  const statusMap = { completed: 'success', confirmed: 'success', pending: 'pending', rejected: 'failed', declined: 'failed' };
  const { ref, image, pdf } = receiptFilenames(contribution.id, contribution.created_at || contribution.date);
  const destination = buildDestinationLabel(contribution);

  const splitFields = (periodSplit?.splits || []).map(s => ({
    label: `  Period ${s.idx + 1}`,
    value: `₦${Number(s.amount).toLocaleString('en-NG')}`,
  }));

  return {
    title:     label,
    direction: isOut ? 'out' : 'in',
    status:    statusMap[contribution.status] || 'pending',
    amount:    contribution.amount,
    datetime:  formatReceiptDateTime(contribution.created_at || contribution.date),
    fields: [
      { label: 'Transaction Type', value: label },
      destination                 && { label: isOut ? 'From' : 'To', value: destination },
      clientName                  && { label: 'Member',         value: clientName },
      splitFields.length > 0      && { label: 'Allocation',     value: `${splitFields.length} period${splitFields.length > 1 ? 's' : ''}` },
      ...splitFields,
      contribution.payment_method && { label: 'Payment Method', value: humanize(contribution.payment_method) },
                                     { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'ajo',
  };
}

// ── Bill payment (airtime, data, electricity, cable, betting — from BillPayments) ──
// `bill` is the output of billToReceipt() in BillPayments.jsx (already parsed from note).
const BILL_CAT_LABELS = {
  airtime: 'Airtime Top-Up', data: 'Data Bundle', electricity: 'Electricity',
  cable: 'Cable TV', betting: 'Betting Wallet', waec: 'WAEC ePin',
  jamb: 'JAMB ePin', spectranet: 'Spectranet Internet', smile: 'Smile 4G',
  'print-airtime': 'Airtime Print', 'print-data': 'Data Print',
  'airtime-bundle': 'Airtime Bundle',
};
export function buildBillReceipt(bill) {
  const businessName = bill.businessName || 'My Business';
  const title = BILL_CAT_LABELS[bill.category] || humanize(bill.category) || 'Bill Payment';
  const { ref, image, pdf } = receiptFilenames(bill.id, bill.created_at || bill.transaction_date, title);

  const fields = [
    { label: 'Transaction Type', value: title },
    bill.network      && { label: 'Network',      value: bill.network },
    bill.phone        && { label: 'Phone',         value: bill.phone },
    bill.planName     && { label: 'Plan',          value: bill.planName },
    bill.smartcard    && { label: 'Smartcard No.', value: bill.smartcard },
    bill.meterNo      && { label: 'Meter No.',     value: bill.meterNo },
    bill.meterAddress && { label: 'Address',       value: bill.meterAddress },
    bill.meterTypeName && { label: 'Meter Type',   value: bill.meterTypeName },
    bill.providerName && { label: 'Provider',      value: bill.providerName },
    bill.packageName  && { label: 'Package',       value: bill.packageName },
    bill.customerId   && { label: 'Customer ID',   value: bill.customerId },
    // electricity token — present value or mark as retrievable
    bill.category === 'electricity' && {
      label:       'Token',
      value:       bill.token || (bill.apiRef ? null : '—'),
      retrievable: !bill.token && !!bill.apiRef,
      orderId:     bill.apiRef,
    },
    bill.cardDetails && { label: 'Card Details', value: bill.cardDetails },
    bill.pinsArr?.length > 0 && {
      label: 'Pins Issued',
      value: `${bill.pinsArr.length} token${bill.pinsArr.length > 1 ? 's' : ''} (tap PDF to view)`,
    },
    bill.apiRef && { label: 'Provider Ref.', value: bill.apiRef, copy: true },
    bill.staffName && { label: 'Served by',   value: bill.staffName },
    { label: 'Processed via', value: PROCESSOR_NAME },
    { label: 'Reference',     value: ref, copy: true },
  ].filter(Boolean);

  return {
    title,
    direction:    'out',
    status:       bill.bill_status === 'failed' ? 'failed' : 'success',
    amount:       bill.amount,
    datetime:     formatReceiptDateTime(bill.created_at || bill.transaction_date),
    fields,
    businessName,
    issuedBy:     businessName,
    fees:         0,
    receiptRef:   ref,
    filenames:    { image, pdf },
    provider:      bill.network || bill.providerName || bill.platformName || null,
    category:      bill.category || null,
    processorName: PROCESSOR_NAME,
    iconType:      null,
    // Raw structured data for specialized display in TransactionDetailModal
    elecToken:    bill.token      || undefined,
    cardDetails:  bill.cardDetails || undefined,
    pinsArr:      bill.pinsArr?.length > 0 ? bill.pinsArr : undefined,
  };
}

// ── Credit/loan statement (from Credit screen — tap "Statement" on a record) ──
export function buildCreditStatementReceipt(credit, businessName) {
  const { ref, image, pdf } = receiptFilenames(credit.id, credit.created_at);
  const statusMap = { active: 'pending', overdue: 'failed', settled: 'success' };

  return {
    title:     'Credit Statement',
    direction: 'out',
    status:    statusMap[credit.status] || 'pending',
    amount:    credit.outstanding || 0,
    datetime:  formatReceiptDateTime(credit.created_at),
    fields: [
      { label: 'Transaction Type', value: 'Credit Statement' },
      credit.customer_name && { label: 'Customer',     value: credit.customer_name },
      credit.phone         && { label: 'Phone',         value: credit.phone },
      credit.item_name     && { label: 'Item / Purpose', value: credit.item_name },
      { label: 'Total Given',   value: fmtAmt(credit.amount_given || credit.amount || 0) },
      { label: 'Total Repaid',  value: fmtAmt(credit.total_paid || 0) },
      { label: 'Outstanding',   value: fmtAmt(credit.outstanding || 0) },
      credit.due_date && {
        label: 'Due Date',
        value: new Date(credit.due_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      credit.status && { label: 'Status', value: humanize(credit.status) },
      { label: 'Reference', value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'statement',
  };
}

// ── Ajo/Aso client savings statement (from Aso screen — tap "Statement" on a client) ──
export function buildAsoClientReceipt(client, businessName) {
  const { ref, image, pdf } = receiptFilenames(client.id, client.joined_at || client.created_at, 'Ajo Member Statement');

  return {
    title:     'Ajo Member Statement',
    direction: 'in',
    status:    'success',
    amount:    client.current_balance || 0,
    datetime:  formatReceiptDateTime(new Date().toISOString()),
    fields: [
      { label: 'Transaction Type', value: 'Ajo Member Statement' },
      client.full_name && { label: 'Member', value: client.full_name },
      client.phone     && { label: 'Phone',  value: client.phone },
      { label: 'Total Deposited',   value: fmtAmt(client.total_saved || 0) },
      { label: 'Total Withdrawn',  value: fmtAmt(client.total_withdrawn || 0) },
      { label: 'Current Balance',  value: fmtAmt(client.current_balance || 0) },
      client.contribution_amount && {
        label: 'Contribution',
        value: fmtAmt(client.contribution_amount) + (client.contribution_frequency ? ` / ${client.contribution_frequency}` : ''),
      },
      client.joined_at && {
        label: 'Member Since',
        value: new Date(client.joined_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      { label: 'Reference', value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'statement',
  };
}

// ── Coop/Org loan repayment (from CoopDashboard & CoopMemberPortal LoansTab) ──
export function buildCoopLoanRepaymentReceipt(repayment, loan, memberName, orgName) {
  const { ref, image, pdf } = receiptFilenames(repayment.id, repayment.created_at, 'Loan Repayment');
  return {
    title:     'Loan Repayment',
    direction: 'in',
    status:    'success',
    amount:    repayment.amount,
    datetime:  formatReceiptDateTime(repayment.created_at),
    fields: [
      { label: 'Transaction Type',   value: 'Loan Repayment' },
      memberName                        && { label: 'Member',            value: memberName },
      loan?.loan_purpose                && { label: 'Loan Purpose',      value: loan.loan_purpose },
      repayment.principal_portion > 0   && { label: 'Principal Paid',    value: fmtAmt(repayment.principal_portion) },
      repayment.interest_portion  > 0   && { label: 'Interest Paid',     value: fmtAmt(repayment.interest_portion) },
      repayment.payment_method          && { label: 'Payment Method',    value: humanize(repayment.payment_method) },
      loan?.outstanding_balance != null && { label: 'Remaining Balance', value: fmtAmt(loan.outstanding_balance) },
                                           { label: 'Reference',         value: ref, copy: true },
    ].filter(Boolean),
    businessName:  orgName,
    issuedBy:      orgName,
    fees:          0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: null,
    iconType:      'savings',
  };
}

// ── Wallet ledger entry (from the Wallet screen — tap a transaction) ─────────
// Flutterwave returns e.g. "Flutterwave MFB (Formerly OK MFB)" — drop the aside.
export const cleanBankName = (n) =>
  String(n || '').replace(/\s*\((?:formerly|former|prev\.?|previously)[^)]*\)/i, '').trim();

const WALLET_TITLES = {
  topup:               'Wallet Funding',
  sale:                'Payment Received',
  bill_spend:          'Bill Payment',
  bill_reversal:       'Bill Refund',
  withdrawal:          'Transfer',
  withdrawal_reversal: 'Transfer Refund',
  adjustment:          'Wallet Adjustment',
};

// A two-line "Name / Bank • Account" value, OPay-receipt style. ReceiptCard
// renders the first line prominent and the rest muted.
function party(name, bank, account) {
  const head = String(name || '').trim() || '—';
  const tail = [bank, account].map((s) => String(s || '').trim()).filter(Boolean).join('  •  ');
  return tail ? `${head}\n${tail}` : head;
}

// ctx (all optional): businessName, walletAccountNumber,
//   withdrawal (wallet_withdrawals row), request (wallet_payment_requests row),
//   originator (deposit sender name), recipientBankName (resolved from bank_code)
export function buildWalletReceipt(row, ctx = {}) {
  const credit = row.direction === 'credit';
  const src    = row.source;
  const title  = WALLET_TITLES[src] || humanize(src);
  const status = row.status === 'pending' || row.status === 'processing' ? 'pending'
               : row.status === 'reversed' || row.status === 'failed' ? 'failed'
               : 'success';
  const { ref, image, pdf } = receiptFilenames(row.id, row.created_at, title);
  const amount = (row.amount_kobo || 0) / 100;

  // The business's own side of every wallet movement — the receipt shows the
  // business name (not the BVN name or the "Flutterwave MFB" bank behind the VA).
  const businessName = ctx.businessName || 'My Business';
  const walletAcct   = ctx.walletAccountNumber || '';
  const walletParty  = party(businessName, 'KudiAI Wallet', walletAcct);
  const wd           = ctx.withdrawal || null;
  const rq           = ctx.request || null;
  const narration    = (wd?.narration || row.narration || '').trim();

  let fields;
  if (src === 'withdrawal' || src === 'withdrawal_reversal') {
    const rcptBank = ctx.recipientBankName || cleanBankName(wd?.bank_name) || wd?.bank_code || '';
    fields = [
      { label: 'Transaction Type', value: src === 'withdrawal_reversal' ? 'Transfer reversal — refunded to wallet' : 'Wallet transfer' },
      { label: 'Recipient Details', value: party(wd?.account_name || narration || 'Bank account', rcptBank, wd?.account_number) },
      { label: 'Sender Details',    value: walletParty },
      narration && !/^transfer to bank$/i.test(narration) && { label: 'Narration', value: narration },
      wd?.fee_kobo ? { label: 'Fee', value: fmtAmt(wd.fee_kobo / 100) } : null,
      wd?.flw_transfer_id && { label: 'Transaction No.', value: wd.flw_transfer_id, copy: true },
      wd?.session_id      && { label: 'Session ID',      value: wd.session_id, copy: true },
      row.balance_after_kobo != null && { label: 'Wallet balance after', value: fmtAmt(row.balance_after_kobo / 100) },
      { label: 'Payment Method', value: 'KudiAI Wallet' },
      { label: 'Status',    value: humanize(row.status) },
      { label: 'Reference', value: ref, copy: true },
    ];
  } else if (src === 'topup') {
    fields = [
      { label: 'Transaction Type', value: 'Wallet funding (bank transfer)' },
      { label: 'Recipient Details', value: walletParty },
      { label: 'Sender Details',    value: party(ctx.originator || 'Bank transfer', '', '') },
      row.flw_reference && { label: 'Transaction No.', value: row.flw_reference, copy: true },
      row.balance_after_kobo != null && { label: 'Wallet balance after', value: fmtAmt(row.balance_after_kobo / 100) },
      { label: 'Payment Method', value: 'Bank transfer' },
      { label: 'Status',    value: humanize(row.status) },
      { label: 'Reference', value: ref, copy: true },
    ];
  } else if (src === 'sale') {
    const note = (rq?.note || narration || '').replace(/^Sale —\s*/i, '').trim();
    fields = [
      { label: 'Transaction Type', value: 'Payment received' },
      { label: 'Recipient Details', value: walletParty },
      { label: 'Sender Details',    value: party(rq?.customer_name || ctx.originator || 'Customer', '', '') },
      note && { label: 'For', value: note },
      row.flw_reference && { label: 'Transaction No.', value: row.flw_reference, copy: true },
      row.balance_after_kobo != null && { label: 'Wallet balance after', value: fmtAmt(row.balance_after_kobo / 100) },
      { label: 'Payment Method', value: 'Bank transfer' },
      { label: 'Status',    value: humanize(row.status) },
      { label: 'Reference', value: ref, copy: true },
    ];
  } else if (src === 'bill_spend' || src === 'bill_reversal') {
    fields = [
      { label: 'Transaction Type', value: src === 'bill_reversal' ? 'Bill refund — credited to wallet' : 'Bill payment' },
      narration && { label: src === 'bill_reversal' ? 'Refund for' : 'Paid for', value: narration },
      { label: src === 'bill_reversal' ? 'Credited to' : 'Paid from', value: walletParty },
      row.flw_reference && { label: 'Provider Ref.', value: row.flw_reference, copy: true },
      row.balance_after_kobo != null && { label: 'Wallet balance after', value: fmtAmt(row.balance_after_kobo / 100) },
      { label: 'Payment Method', value: 'KudiAI Wallet' },
      { label: 'Status',    value: humanize(row.status) },
      { label: 'Reference', value: ref, copy: true },
    ];
  } else {
    fields = [
      { label: 'Transaction Type', value: title },
      { label: credit ? 'Money in' : 'Money out', value: fmtAmt(amount) },
      narration && { label: 'Details', value: narration },
      row.balance_after_kobo != null && { label: 'Wallet balance after', value: fmtAmt(row.balance_after_kobo / 100) },
      { label: 'Status',    value: humanize(row.status) },
      { label: 'Reference', value: ref, copy: true },
    ];
  }

  return {
    title,
    direction: credit ? 'in' : 'out',
    status,
    amount,
    datetime:  formatReceiptDateTime(row.created_at),
    fields:    fields.filter(Boolean),
    businessName,
    issuedBy:      businessName,
    fees:          wd?.fee_kobo ? wd.fee_kobo / 100 : 0,
    receiptRef:    ref,
    filenames:     { image, pdf },
    processorName: 'KudiAI Track',
    iconType:      credit ? 'income' : 'expense',
  };
}
