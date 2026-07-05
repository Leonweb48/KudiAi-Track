// Builds standardized receipt data from raw transaction records per screen type.
// Every function returns a common shape consumed by TransactionDetailModal + ReceiptCard.

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
      txn.customer_name && { label: isIn ? 'From'  : 'To',     value: txn.customer_name },
      txn.item_name     && { label: 'Description',              value: txn.item_name },
      txn.category      && { label: 'Category',                 value: humanize(txn.category) },
      txn.payment_type  && { label: 'Payment Method',           value: humanize(txn.payment_type) },
      txn.quantity > 1  && { label: 'Quantity',                 value: String(txn.quantity) },
      txn.note          && { label: 'Note',                     value: txn.note },
                           { label: 'Reference',                value: ref, copy: true },
    ].filter(Boolean),
    businessName: profile?.business_name || 'My Business',
    issuedBy:     profile?.business_name || 'My Business',
    fees:         0,
    receiptRef:   ref,
    filenames:    { image, pdf },
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
      clientName                  && { label: 'Member',         value: clientName },
      contribution.payment_method && { label: 'Payment Method', value: humanize(contribution.payment_method) },
      contribution.notes          && { label: 'Note',           value: contribution.notes },
                                     { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy: businessName,
    fees:     0,
    receiptRef: ref,
    filenames:  { image, pdf },
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
      clientName         && { label: 'Member',         value: clientName },
      req.fee_amount > 0 && { label: 'Processing Fee', value: fmtAmt(req.fee_amount) },
      req.fee_type       && { label: 'Fee Type',        value: humanize(req.fee_type) },
                            { label: 'Reference',       value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy: businessName,
    fees:     req.fee_amount || 0,
    receiptRef: ref,
    filenames:  { image, pdf },
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
      credit?.customer_name  && { label: 'Customer',          value: credit.customer_name },
      payment.payment_method && { label: 'Payment Method',    value: humanize(payment.payment_method) },
      remaining != null      && { label: 'Remaining Balance', value: fmtAmt(remaining) },
      payment.notes          && { label: 'Note',              value: payment.notes },
                                { label: 'Reference',          value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy: businessName,
    fees:     0,
    receiptRef: ref,
    filenames:  { image, pdf },
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
      memberName                    && { label: 'Member',         value: memberName },
      record.payment_method         && { label: 'Payment Method', value: humanize(record.payment_method) },
      record.balance_after != null  && { label: 'Balance After',  value: fmtAmt(record.balance_after) },
                                       { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName: orgName,
    issuedBy: orgName,
    fees:     0,
    receiptRef: ref,
    filenames:  { image, pdf },
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
      memberName       && { label: 'Member',    value: memberName },
      request.reason   && { label: 'Reason',    value: request.reason },
      request.status   && { label: 'Status',    value: humanize(request.status) },
                          { label: 'Reference', value: ref, copy: true },
    ].filter(Boolean),
    businessName: orgName,
    issuedBy: orgName,
    fees:     0,
    receiptRef: ref,
    filenames:  { image, pdf },
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
      clientName                  && { label: 'Member',         value: clientName },
      contribution.payment_method && { label: 'Payment Method', value: humanize(contribution.payment_method) },
                                     { label: 'Reference',      value: ref, copy: true },
    ].filter(Boolean),
    businessName,
    issuedBy: businessName,
    fees:     0,
    receiptRef: ref,
    filenames:  { image, pdf },
  };
}
