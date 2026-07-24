/**
 * notifyEngine — single client-side entry point for all non-email notifications.
 * Server-side callers (edge functions) invoke notify-send directly.
 *
 * notify(event) → calls notify-send edge function.
 *
 * Standing suppression laws:
 *  • Own-session: userId === originUserId → skip (staff who records a sale doesn't see a notification)
 *  • Unknown type → warn + skip
 *  • All cross-user calls validated by notify-send (staff → owner check)
 */

import { supabase } from "../utils/supabase";

// ── Event templates ──────────────────────────────────────────────────────────
// Each entry: { priority, category, title(data), body(data), deepLink, dedupeKey(data) }
const EVENTS = {
  // ── Owner-received: staff transactions ──────────────────────────────────
  staff_cash_in: {
    priority: "high", category: "money",
    title: () => "New Sale",
    body:  (d) => `${d.staffName || "Staff"} recorded ₦${fmt(d.amount)} sale`,
    deepLink:  { tab: "transactions" },
    dedupeKey: (d) => `cash_in_${d.ownerId}`,
  },

  staff_cash_out: {
    priority: "high", category: "money",
    title: () => "Expense Recorded",
    body:  (d) => `${d.staffName || "Staff"} recorded ₦${fmt(d.amount)} expense`,
    deepLink:  { tab: "transactions" },
    dedupeKey: (d) => `cash_out_${d.ownerId}`,
  },

  credit_created: {
    priority: "high", category: "money",
    title: () => "Credit Extended",
    body:  (d) => `${d.staffName || "Staff"} gave ₦${fmt(d.amount)} credit to ${d.customerName || "a customer"}`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `credit_new_${d.creditId}`,
  },

  credit_repayment: {
    priority: "normal", category: "money",
    title: () => "Credit Repayment",
    body:  (d) => `${d.customerName || "Customer"} paid ₦${fmt(d.amount)} — ₦${fmt(d.outstanding)} left`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `credit_repay_${d.creditId}`,
  },

  credit_completed: {
    priority: "high", category: "money",
    title: () => "Credit Fully Paid",
    body:  (d) => `${d.customerName || "Customer"} settled their ₦${fmt(d.total)} credit`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `credit_done_${d.creditId}`,
  },

  ajo_registration: {
    priority: "normal", category: "savings",
    title: () => "New Ajo Member",
    body:  (d) => `${d.staffName || "Staff"} registered ${d.clientName || "a new member"}`,
    deepLink:  { tab: "aso" },
    dedupeKey: (d) => `ajo_reg_${d.clientId}`,
  },

  invoice_created: {
    priority: "normal", category: "money",
    title: () => "Invoice Created",
    body:  (d) => `${d.staffName || "Staff"} created invoice${d.invoiceNumber ? ` #${d.invoiceNumber}` : ""} for ₦${fmt(d.amount)}`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `inv_create_${d.invoiceId}`,
  },

  invoice_sent: {
    priority: "normal", category: "money",
    title: () => "Invoice Sent",
    body:  (d) => `Invoice${d.invoiceNumber ? ` #${d.invoiceNumber}` : ""} (₦${fmt(d.amount)}) sent to ${d.customerName || "customer"}`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `inv_sent_${d.invoiceId}`,
  },

  invoice_paid: {
    priority: "high", category: "money",
    title: () => "Invoice Paid",
    body:  (d) => `₦${fmt(d.amount)} received${d.invoiceNumber ? ` — invoice #${d.invoiceNumber}` : ""}`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `inv_paid_${d.invoiceId}`,
  },

  manager_perm_change: {
    priority: "high", category: "permissions",
    title: () => "Staff Permissions Changed",
    body:  (d) => `A manager updated ${d.staffName || "a staff member"}'s permissions`,
    deepLink:  { tab: "staff" },
    dedupeKey: (d) => `mgr_perm_${d.staffId}`,
  },

  // ── Owner-received (legacy) ───────────────────────────────────────────────
  staff_collection: {
    priority: "high", category: "money",
    title: (d) => d.count > 1 ? `${d.count} Collections Pending` : "New Staff Collection",
    body:  (d) => d.count > 1
      ? `${d.count} staff collections awaiting your review`
      : `${d.staffName || "Staff"} recorded a ₦${fmt(d.amount)} sale — tap to review`,
    deepLink:  { tab: "aso", sub: "collections" },
    dedupeKey: (d) => `staff_coll_${d.ownerId}`,
  },

  withdrawal_request: {
    priority: "high", category: "money",
    title: () => "Withdrawal Request",
    body:  (d) => `${d.memberName || "A member"} requests ₦${fmt(d.amount)} — approve or reject`,
    deepLink:  { tab: "aso", sub: "withdrawals" },
    dedupeKey: (d) => `withdrawal_${d.requestId}`,
  },

  manual_deposit: {
    priority: "high", category: "money",
    title: () => "Deposit Claim",
    body:  (d) => `${d.memberName || "A member"} claims ₦${fmt(d.amount)} — verify and approve`,
    deepLink:  { tab: "aso", sub: "deposits" },
    dedupeKey: (d) => `deposit_${d.depositId}`,
  },

  capital_transition: {
    priority: "high", category: "money",
    title: (d) => `Capital Alert — ${d.newState === "red" ? "Loss" : d.newState === "yellow" ? "Near-Loss" : "Recovery"}`,
    body:  (d) => `Working capital moved to ${d.newState} state — tap to view Finance`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `capital_state_${d.ownerId}`,
  },

  low_stock: {
    priority: "normal", category: "stock",
    title: (d) => `Low Stock: ${d.productName}`,
    body:  (d) => `Only ${d.quantity} unit${d.quantity === 1 ? "" : "s"} left — consider restocking`,
    deepLink: (d) => ({ tab: "inventory", id: d.productId }),
    dedupeKey: (d) => `low_stock_${d.productId}`,
  },

  credit_overdue: {
    priority: "normal", category: "money",
    title: (d) => `Credit Overdue — ${d.customerName}`,
    body:  (d) => `₦${fmt(d.outstanding)} overdue since ${d.dueDate}`,
    deepLink: (d) => ({ tab: "finance", sub: "credit", id: d.creditId }),
    dedupeKey: (d) => `credit_overdue_${d.creditId}`,
  },

  held_24h: {
    priority: "high", category: "money",
    title: () => "Security Hold Active",
    body:  (d) => `₦${fmt(d.amount)} transaction is in 24h security review`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `held24h_${d.transactionId}`,
  },

  // ── Staff / manager-received ─────────────────────────────────────────────
  staff_invite: {
    priority: "normal", category: "permissions",
    title: () => "Staff Invitation",
    body:  (d) => `${d.businessName || "A business"} invited you as ${d.role || "staff"}`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  permission_change: {
    priority: "normal", category: "permissions",
    title: () => "Permissions Updated",
    body:  (d) => `${d.businessName || "Your employer"} updated your access permissions`,
    deepLink:  { tab: "me", sub: "security" },
    dedupeKey: (d) => `perms_${d.staffId}`,
  },

  collection_approved: {
    priority: "normal", category: "approvals",
    title: () => "Collection Approved",
    body:  (d) => `Your recorded ₦${fmt(d.amount)} collection was approved`,
    deepLink:  { tab: "records" },
    dedupeKey: null,
  },

  collection_rejected: {
    priority: "normal", category: "approvals",
    title: () => "Collection Rejected",
    body:  (d) => `Your ₦${fmt(d.amount)} collection was rejected${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "records" },
    dedupeKey: null,
  },

  commission_processed: {
    priority: "normal", category: "money",
    title: () => "Commission Processed",
    body:  (d) => `₦${fmt(d.amount)} commission credited for ${d.period || "this period"}`,
    deepLink:  { tab: "me", sub: "commissions" },
    dedupeKey: (d) => `commission_${d.staffId}_${d.period}`,
  },

  shift_changed: {
    priority: "normal", category: "permissions",
    title: () => "Shift Updated",
    body:  (d) => `Your shift has been changed to ${d.shift || "a new schedule"}`,
    deepLink:  { tab: "me" },
    dedupeKey: (d) => `shift_${d.staffId}`,
  },

  // ── Ajo client-received ──────────────────────────────────────────────────
  contribution_approved: {
    priority: "normal", category: "savings",
    title: () => "Contribution Approved",
    body:  (d) => `Your ₦${fmt(d.amount)} contribution has been approved`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  contribution_rejected: {
    priority: "normal", category: "savings",
    title: () => "Contribution Rejected",
    body:  (d) => `Your contribution was not approved — ${d.reason || "contact your group admin"}`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  deposit_confirmed: {
    priority: "high", category: "money",
    title: () => "Deposit Confirmed",
    body:  (d) => `Your deposit of ₦${fmt(d.amount)} was confirmed and credited`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  deposit_rejected: {
    priority: "high", category: "money",
    title: () => "Deposit Rejected",
    body:  (d) => `Your deposit claim was rejected${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  withdrawal_approved: {
    priority: "high", category: "money",
    title: () => "Withdrawal Approved",
    body:  (d) => `Your withdrawal of ₦${fmt(d.amount)} has been approved`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  withdrawal_rejected: {
    priority: "high", category: "money",
    title: () => "Withdrawal Rejected",
    body:  (d) => `Your withdrawal request was rejected${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  payout_received: {
    priority: "high", category: "savings",
    title: () => "Payout Received",
    body:  (d) => `₦${fmt(d.amount)} has been credited to your account`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  group_funds_released: {
    priority: "normal", category: "savings",
    title: () => "Savings Released",
    body:  (d) => `₦${fmt(d.amount)} from your savings group has been released`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  // ── Owner-received: staff & client actions ───────────────────────────────
  approval_request_pending: {
    priority: "high", category: "approvals",
    title: (d) => `Approval Request — ${d.requestType || "Action"}`,
    body:  (d) => `${d.staffName || "Staff"} requests approval for ₦${fmt(d.amount)} ${d.requestType || "action"}`,
    deepLink:  { tab: "settings" },
    dedupeKey: (d) => `appr_req_${d.staffId}_${d.requestType}`,
  },

  reactivation_request: {
    priority: "normal", category: "savings",
    title: () => "Reactivation Request",
    body:  (d) => `${d.memberName || "A client"} is requesting account reactivation`,
    deepLink:  { tab: "aso", sub: "clients" },
    dedupeKey: (d) => `reactiv_req_${d.clientId}`,
  },

  // ── Staff / manager-received ─────────────────────────────────────────────
  approval_actioned: {
    priority: "normal", category: "approvals",
    title: (d) => d.status === "approved" ? "Request Approved" : "Request Declined",
    body:  (d) => d.status === "approved"
      ? `Your ₦${fmt(d.amount)} ${d.requestType || "request"} was approved`
      : `Your ₦${fmt(d.amount)} ${d.requestType || "request"} was declined${d.note ? ` — ${d.note}` : ""}`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  disbursement_received: {
    priority: "high", category: "money",
    title: () => "Payment Received",
    body:  (d) => `₦${fmt(d.amount)} ${d.disbType || "payment"} has been credited to your account`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  email_changed: {
    priority: "normal", category: "permissions",
    title: () => "Staff Email Changed",
    body:  (d) => `${d.staffName || "A staff member"} changed their email to ${d.newEmail || "a new address"}`,
    deepLink:  { tab: "settings" },
    dedupeKey: (d) => `email_chg_${d.staffId}`,
  },

  // ── Ajo client-received: reversals & esusu ───────────────────────────────
  contribution_reversed: {
    priority: "high", category: "savings",
    title: () => "Contribution Reversed",
    body:  (d) => `₦${fmt(d.amount)} contribution was reversed${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  esusu_turn_skipped: {
    priority: "high", category: "savings",
    title: () => "Esusu Turn Skipped",
    body:  (d) => `Your esusu turn has been skipped${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  reactivation_approved: {
    priority: "normal", category: "savings",
    title: () => "Reactivation Approved",
    body:  (d) => `${d.businessName || "Your savings agent"} approved your reactivation — waiting for admin confirmation`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  reactivation_rejected: {
    priority: "normal", category: "savings",
    title: () => "Reactivation Declined",
    body:  (d) => `Your reactivation request was declined${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  // ── Coop member-received ─────────────────────────────────────────────────
  savings_recorded: {
    priority: "normal", category: "savings",
    title: () => "Savings Recorded",
    body:  (d) => `₦${fmt(d.amount)} savings deposited — balance: ₦${fmt(d.balance)}`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
  },

  savings_debited: {
    priority: "normal", category: "savings",
    title: () => "Savings Deducted",
    body:  (d) => `₦${fmt(d.amount)} deducted from your savings — balance: ₦${fmt(d.balance)}`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
  },
};

function fmt(n) {
  return n != null ? Number(n).toLocaleString() : "0";
}

// Event types that support rollup accumulation (pass rollupAmount in data.amount)
const ROLLUP_TYPES = new Set(["staff_cash_in", "staff_cash_out", "credit_repayment", "invoice_paid"]);

/**
 * Send a notification.
 *
 * @param {object} event
 * @param {string}  event.type          - event key from EVENTS map
 * @param {string}  event.userId        - auth user_id of the recipient
 * @param {string} [event.originUserId] - who triggered the event; same as userId → suppressed
 * @param {object} [event.data]         - template data (staffName, amount, etc.)
 * @param {string} [event.category]     - override category for preference check
 * @returns {Promise<void>}
 */
export async function notify({ type, userId, originUserId, data = {}, category }) {
  // Suppression: own-session never notifies
  if (userId && originUserId && userId === originUserId) return;

  const tpl = EVENTS[type];
  if (!tpl) { console.warn("[notifyEngine] Unknown type:", type); return; }

  const title    = tpl.title(data);
  const body     = tpl.body(data);
  const deepLink = typeof tpl.deepLink === "function" ? tpl.deepLink(data) : (tpl.deepLink ?? null);
  const dk       = tpl.dedupeKey ? (typeof tpl.dedupeKey === "function" ? tpl.dedupeKey(data) : tpl.dedupeKey) : null;

  const payload = {
    action:    "notify",
    userId,
    type,
    title,
    body,
    deepLink,
    priority:  tpl.priority,
    dedupeKey: dk,
    category:  category ?? tpl.category,
  };

  // Pass amount to notify-send for rollup accumulation on supported event types
  if (ROLLUP_TYPES.has(type) && data.amount != null) {
    payload.rollupAmount = parseFloat(data.amount) || 0;
  }

  try {
    await supabase.functions.invoke("notify-send", { body: payload });
  } catch (err) {
    console.warn("[notifyEngine] Failed to send:", err);
  }
}

// Re-export the template map so tests can validate templates without invoking the edge function
export { EVENTS as _NOTIFICATION_EVENTS };
