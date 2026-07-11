// Builds standardized receipt data from raw transaction records per screen type.
// Every function returns a common shape consumed by TransactionDetailModal + ReceiptCard.

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

export function receiptFilenames(id, createdAt) {
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
  return { ref, image: `receipt_${ref}.png`, pdf: `receipt_${ref}.pdf` };
}

function fmtAmt(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
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
  const { ref, image, pdf } = receiptFilenames(txn.id, txn.created_at || txn.transaction_date);

  return {
    title:       isIn ? 'Payment Received' : 'Payment Made',
    direction:   isIn ? 'in' : 'out',
    status,
    amount:      txn.amount,
    datetime:    formatReceiptDateTime(txn.created_at || txn.transaction_date),
    fields: [
      { label: 'Transaction Type', value: isIn ? 'Income' : 'Expense' },
      txn.customer_name && { label: isIn ? 'From'  : 'To',     value: txn.customer_name },
      txn.item_name     && { label: 'Description',              value: txn.item_name },
      txn.category      && { label: 'Category',                 value: humanize(txn.category) },
      txn.payment_type  && { label: 'Payment Method',           value: humanize(txn.payment_type) },
      txn.quantity > 1  && { label: 'Quantity',                 value: String(txn.quantity) },
      txn.note          && { label: 'Note',                     value: txn.note },
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
export function buildAsoContributionReceipt(contribution, clientName, businessName) {
  const isWithdrawal = contribution.type === 'withdrawal';
  const isReg        = contribution.type === 'registration_fee';
  const status       = contribution.status === 'pending' ? 'pending' : 'success';
  const { ref, image, pdf } = receiptFilenames(contribution.id, contribution.created_at || contribution.date);

  return {
    title:     isReg ? 'Registration Fee' : isWithdrawal ? 'Withdrawal' : 'Contribution',
    direction: isWithdrawal ? 'out' : 'in',
    status,
    amount:    contribution.amount,
    datetime:  formatReceiptDateTime(contribution.created_at || contribution.date),
    fields: [
      { label: 'Transaction Type', value: isReg ? 'Registration Fee' : isWithdrawal ? 'Ajo Withdrawal' : 'Ajo Contribution' },
      clientName                  && { label: 'Member',         value: clientName },
      contribution.payment_method && { label: 'Payment Method', value: humanize(contribution.payment_method) },
      contribution.notes          && { label: 'Note',           value: contribution.notes },
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
  const { ref, image, pdf } = receiptFilenames(req.id, req.requested_at);

  return {
    title:     'Withdrawal Request',
    direction: 'out',
    status:    statusMap[req.status] || 'pending',
    amount:    req.net_amount ?? req.amount,
    datetime:  formatReceiptDateTime(req.requested_at),
    fields: [
      { label: 'Transaction Type', value: 'Ajo Withdrawal' },
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
  const { ref, image, pdf } = receiptFilenames(payment.id, payment.created_at || payment.payment_date);
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
  const { ref, image, pdf } = receiptFilenames(request.id, request.created_at);

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
export function buildAjoContributionReceipt(contribution, clientName, businessName) {
  const isWithdrawal = contribution.type === 'withdrawal';
  const statusMap = { completed: 'success', confirmed: 'success', pending: 'pending' };
  const { ref, image, pdf } = receiptFilenames(contribution.id, contribution.created_at || contribution.date);

  return {
    title:     isWithdrawal ? 'Ajo Withdrawal' : 'Ajo Contribution',
    direction: isWithdrawal ? 'out' : 'in',
    status:    statusMap[contribution.status] || 'success',
    amount:    contribution.amount,
    datetime:  formatReceiptDateTime(contribution.created_at || contribution.date),
    fields: [
      { label: 'Transaction Type', value: isWithdrawal ? 'Ajo Withdrawal' : 'Ajo Contribution' },
      clientName                  && { label: 'Member',         value: clientName },
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
  const { ref, image, pdf } = receiptFilenames(bill.id, bill.created_at || bill.transaction_date);
  const title = BILL_CAT_LABELS[bill.category] || humanize(bill.category) || 'Bill Payment';

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
    bill.pinsArr?.length > 0 && {
      label: 'Pins Issued',
      value: `${bill.pinsArr.length} token${bill.pinsArr.length > 1 ? 's' : ''} (see PDF)`,
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
    provider:      bill.network || bill.providerName || null,
    category:      bill.category || null,
    processorName: PROCESSOR_NAME,
    iconType:      null,
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
  const { ref, image, pdf } = receiptFilenames(client.id, client.joined_at || client.created_at);

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
      { label: 'Total Saved',      value: fmtAmt(client.total_saved || 0) },
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
  const { ref, image, pdf } = receiptFilenames(repayment.id, repayment.created_at);
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
