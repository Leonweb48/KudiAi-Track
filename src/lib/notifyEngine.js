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
    body:  (d) => `${d.staffName || "Staff"} recorded a ₦${fmt(d.amount)} sale${d.item ? ` — ${d.item}` : ""}`,
    deepLink:  (d) => ({ tab: "transactions", id: d.txId }),
    dedupeKey: (d) => `cash_in_${d.ownerId}`,
  },

  staff_cash_out: {
    priority: "high", category: "money",
    title: () => "Expense Recorded",
    body:  (d) => `${d.staffName || "Staff"} recorded ₦${fmt(d.amount)} expense${d.item ? ` — ${d.item}` : ""}`,
    deepLink:  (d) => ({ tab: "transactions", id: d.txId }),
    dedupeKey: (d) => `cash_out_${d.ownerId}`,
  },

  credit_created: {
    priority: "high", category: "money",
    title: () => "Credit Extended",
    body:  (d) => `${d.staffName || "Staff"} extended ₦${fmt(d.amount)} credit to ${d.customerName || "a customer"}${d.dueDate ? ` · due ${d.dueDate}` : ""}`,
    deepLink:  (d) => ({ tab: "finance", id: d.creditId }),
    dedupeKey: (d) => `credit_new_${d.creditId}`,
  },

  credit_extended: {
    priority: "high", category: "money",
    title: () => "Credit Extended",
    body:  (d) => `${d.staffName || "Staff"} added ₦${fmt(d.amount)} to ${d.customerName || "a customer"}'s credit — outstanding now ₦${fmt(d.outstanding)}`,
    deepLink:  (d) => ({ tab: "finance", id: d.creditId }),
    dedupeKey: null,
  },

  credit_repayment: {
    priority: "high", category: "money",
    title: () => "Credit Repayment",
    body:  (d) => `${d.customerName || "Customer"} paid ₦${fmt(d.amount)} — ₦${fmt(d.outstanding)} outstanding`,
    deepLink:  (d) => ({ tab: "finance", id: d.creditId }),
    dedupeKey: (d) => `credit_repay_${d.creditId}`,
  },

  credit_completed: {
    priority: "high", category: "money",
    title: () => "Credit Fully Paid",
    body:  (d) => `${d.customerName || "Customer"} settled their ₦${fmt(d.total)} credit in full`,
    deepLink:  (d) => ({ tab: "finance", id: d.creditId }),
    dedupeKey: (d) => `credit_done_${d.creditId}`,
  },

  ajo_registration: {
    priority: "high", category: "savings",
    title: () => "New Ajo Member",
    body:  (d) => `${d.staffName || "Staff"} registered ${d.clientName || "a new member"} as an Ajo savings member`,
    deepLink:  (d) => ({ tab: "aso", sub: "clients", id: d.clientId }),
    dedupeKey: (d) => `ajo_reg_${d.clientId}`,
  },

  invoice_created: {
    priority: "high", category: "money",
    title: () => "Invoice Created",
    body:  (d) => `${d.staffName || "Staff"} created invoice${d.invoiceNumber ? ` #${d.invoiceNumber}` : ""} for ${d.customerName || "a customer"} — ₦${fmt(d.amount)}`,
    deepLink:  (d) => ({ tab: "finance", id: d.invoiceId }),
    dedupeKey: (d) => `inv_create_${d.invoiceId}`,
  },

  invoice_sent: {
    priority: "high", category: "money",
    title: () => "Invoice Sent",
    body:  (d) => `${d.staffName || "Staff"} sent invoice${d.invoiceNumber ? ` #${d.invoiceNumber}` : ""} (₦${fmt(d.amount)}) to ${d.customerName || "a customer"}`,
    deepLink:  (d) => ({ tab: "finance", id: d.invoiceId }),
    dedupeKey: (d) => `inv_sent_${d.invoiceId}`,
  },

  invoice_paid: {
    priority: "high", category: "money",
    title: () => "Invoice Paid",
    body:  (d) => `₦${fmt(d.amount)} received${d.invoiceNumber ? ` for invoice #${d.invoiceNumber}` : ""}${d.customerName ? ` — ${d.customerName}` : ""}`,
    deepLink:  (d) => ({ tab: "finance", id: d.invoiceId }),
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
    priority: "high", category: "stock",
    title: (d) => `Low Stock: ${d.productName}`,
    body:  (d) => `Only ${d.quantity} unit${d.quantity === 1 ? "" : "s"} left — consider restocking`,
    deepLink: (d) => ({ tab: "inventory", id: d.productId }),
    dedupeKey: (d) => `low_stock_${d.productId}`,
  },

  credit_overdue: {
    priority: "high", category: "money",
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
    priority: "high", category: "permissions",
    title: () => "Staff Invitation",
    body:  (d) => `${d.businessName || "A business"} invited you as ${d.role || "staff"}`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  permission_change: {
    priority: "high", category: "permissions",
    title: () => "Permissions Updated",
    body:  (d) => `${d.businessName || "Your employer"} updated your access permissions`,
    deepLink:  { tab: "me", sub: "security" },
    dedupeKey: (d) => `perms_${d.staffId}`,
  },

  collection_approved: {
    priority: "high", category: "approvals",
    title: () => "Collection Approved",
    body:  (d) => `Your recorded ₦${fmt(d.amount)} collection was approved`,
    deepLink:  { tab: "records" },
    dedupeKey: null,
  },

  collection_rejected: {
    priority: "high", category: "approvals",
    title: () => "Collection Rejected",
    body:  (d) => `Your ₦${fmt(d.amount)} collection was rejected${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "records" },
    dedupeKey: null,
  },

  commission_processed: {
    priority: "high", category: "money",
    title: () => "Commission Processed",
    body:  (d) => `₦${fmt(d.amount)} commission credited for ${d.period || "this period"}`,
    deepLink:  { tab: "me", sub: "commissions" },
    dedupeKey: (d) => `commission_${d.staffId}_${d.period}`,
  },

  shift_changed: {
    priority: "high", category: "permissions",
    title: () => "Shift Updated",
    body:  (d) => `Your shift has been changed to ${d.shift || "a new schedule"}`,
    deepLink:  { tab: "me" },
    dedupeKey: (d) => `shift_${d.staffId}`,
  },

  // ── Ajo client-received ──────────────────────────────────────────────────
  contribution_approved: {
    priority: "high", category: "savings",
    title: () => "Contribution Approved",
    body:  (d) => `Your ₦${fmt(d.amount)} contribution has been approved`,
    deepLink:  { tab: "history" },
    dedupeKey: null,
  },

  contribution_rejected: {
    priority: "high", category: "savings",
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
    priority: "high", category: "savings",
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
    priority: "high", category: "savings",
    title: () => "Reactivation Request",
    body:  (d) => `${d.memberName || "A client"} is requesting account reactivation`,
    deepLink:  { tab: "aso", sub: "clients" },
    dedupeKey: (d) => `reactiv_req_${d.clientId}`,
  },

  // ── Staff / manager-received ─────────────────────────────────────────────
  approval_actioned: {
    priority: "high", category: "approvals",
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
    priority: "high", category: "permissions",
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
    priority: "high", category: "savings",
    title: () => "Reactivation Approved",
    body:  (d) => `${d.businessName || "Your savings agent"} approved your reactivation — waiting for admin confirmation`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  reactivation_rejected: {
    priority: "high", category: "savings",
    title: () => "Reactivation Declined",
    body:  (d) => `Your reactivation request was declined${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  { tab: "me" },
    dedupeKey: null,
  },

  // ── Branch manager-received ──────────────────────────────────────────────
  branch_restock: {
    priority: "high", category: "stock",
    title: (d) => `Restock: ${d.productName || "Stock"}`,
    body:  (d) => d.staffName
      ? `${d.staffName} added ${d.quantity} unit${d.quantity === 1 ? "" : "s"} of ${d.productName || "stock"} to stock`
      : `${d.quantity} unit${d.quantity === 1 ? "" : "s"} of ${d.productName || "stock"} restocked`,
    deepLink:  (d) => ({ tab: "stock", id: d.productId }),
    dedupeKey: (d) => `restock_${d.productId}_${d.branchId}`,
  },

  // ── Staff-received: assigned client actions ──────────────────────────────
  assigned_client_withdrawal: {
    priority: "high", category: "money",
    title: () => "Client Withdrawal Request",
    body:  (d) => `${d.clientName || "A client"} you registered requested ₦${fmt(d.amount)} withdrawal`,
    deepLink:  { tab: "records" },
    dedupeKey: (d) => `cli_wd_${d.clientId}`,
  },

  assigned_client_deposit: {
    priority: "high", category: "money",
    title: () => "Client Deposit Claim",
    body:  (d) => `${d.clientName || "A client"} you registered submitted a ₦${fmt(d.amount)} deposit claim`,
    deepLink:  { tab: "records" },
    dedupeKey: (d) => `cli_dep_${d.clientId}`,
  },

  client_assigned: {
    priority: "high", category: "permissions",
    title: () => "Client Assigned",
    body:  (d) => `${d.clientName || "A client"} has been assigned to you`,
    deepLink:  (d) => ({ tab: "records", id: d.clientId }),
    dedupeKey: (d) => `client_assigned_${d.clientId}`,
  },

  assigned_client_contribution_approved: {
    priority: "high", category: "approvals",
    title: () => "Client Contribution Approved",
    body:  (d) => `${d.clientName || "Your client"}'s ₦${fmt(d.amount)} contribution was approved`,
    deepLink:  (d) => ({ tab: "records", id: d.clientId }),
    dedupeKey: null,
  },

  assigned_client_contribution_rejected: {
    priority: "high", category: "approvals",
    title: () => "Client Contribution Rejected",
    body:  (d) => `${d.clientName || "Your client"}'s contribution was rejected${d.reason ? ` — ${d.reason}` : ""}`,
    deepLink:  (d) => ({ tab: "records", id: d.clientId }),
    dedupeKey: null,
  },

  // ── Coop member-received ─────────────────────────────────────────────────
  savings_recorded: {
    priority: "high", category: "savings",
    title: () => "Savings Recorded",
    body:  (d) => `₦${fmt(d.amount)} savings deposited — balance: ₦${fmt(d.balance)}`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
  },

  savings_debited: {
    priority: "high", category: "savings",
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
const ROLLUP_TYPES = new Set([
  "staff_cash_in", "staff_cash_out",
  "credit_repayment", "invoice_paid",
  "staff_collection",
]);

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

// Manager portal tab names differ from owner URL-based routing
const MANAGER_DEEP_LINKS = {
  staff_cash_in:              { tab: "home" },
  staff_cash_out:             { tab: "home" },
  credit_created:             (d) => ({ tab: "records", id: d.creditId }),
  credit_extended:            (d) => ({ tab: "records", id: d.creditId }),
  credit_repayment:           (d) => ({ tab: "records", id: d.creditId }),
  credit_completed:           (d) => ({ tab: "records", id: d.creditId }),
  ajo_registration:           (d) => ({ tab: "records", id: d.clientId }),
  invoice_created:            { tab: "home" },
  invoice_sent:               { tab: "home" },
  invoice_paid:               { tab: "home" },
  withdrawal_request:         { tab: "home" },
  manual_deposit:             { tab: "home" },
  staff_collection:           { tab: "home" },
  branch_restock:             (d) => ({ tab: "stock", id: d.productId }),
  assigned_client_withdrawal: { tab: "records" },
  assigned_client_deposit:    { tab: "records" },
};

/**
 * Notify the branch manager of an event scoped to their branch.
 * Looks up the manager by (ownerId, branchId, role='manager'), then fires notify-send.
 * Skips silently if: no branchId, no manager account, manager IS the actor.
 *
 * @param {string}  ownerId        - business owner's auth user_id
 * @param {string}  branchId       - branch_id of the acting staff member
 * @param {object}  opts
 * @param {string}  opts.type      - event key from EVENTS map
 * @param {string}  [opts.originUserId] - acting user's auth user_id (suppressed if same as manager)
 * @param {object}  [opts.data]    - template data
 */
export async function notifyBranchManager(ownerId, branchId, { type, originUserId, data = {} }) {
  if (!ownerId || !branchId) return;

  const { data: mgr } = await supabase
    .from("staff")
    .select("id, user_id")
    .eq("owner_id", ownerId)
    .eq("branch_id", branchId)
    .eq("role", "manager")
    .eq("status", "active")
    .not("user_id", "is", null)
    .maybeSingle();

  if (!mgr?.user_id) return;
  if (originUserId && (mgr.user_id === originUserId || mgr.id === originUserId)) return;

  const tpl = EVENTS[type];
  if (!tpl) { console.warn("[notifyEngine] notifyBranchManager: unknown type:", type); return; }

  const title    = tpl.title(data);
  const body     = tpl.body(data);
  const mgrDl    = MANAGER_DEEP_LINKS[type];
  const deepLink = mgrDl
    ? (typeof mgrDl === "function" ? mgrDl(data) : mgrDl)
    : (typeof tpl.deepLink === "function" ? tpl.deepLink(data) : (tpl.deepLink ?? null));
  const baseDk   = tpl.dedupeKey ? (typeof tpl.dedupeKey === "function" ? tpl.dedupeKey(data) : tpl.dedupeKey) : null;
  const dk       = baseDk ? `br_${branchId}_${baseDk}` : null;

  const payload = {
    action:    "notify",
    userId:    mgr.user_id,
    type,
    title,
    body,
    deepLink,
    priority:  "high",
    dedupeKey: dk,
    category:  tpl.category,
  };

  if (ROLLUP_TYPES.has(type) && data.amount != null) {
    payload.rollupAmount = parseFloat(data.amount) || 0;
  }

  try {
    await supabase.functions.invoke("notify-send", { body: payload });
  } catch (err) {
    console.warn("[notifyEngine] notifyBranchManager failed:", err);
  }
}

/**
 * Notify all regular (non-manager) branch staff of an event at their branch.
 * Skips the origin user. Used for events staff need to act on (e.g. new stock arrived).
 * @param {string}  ownerId
 * @param {string}  branchId
 * @param {object}  opts - { type, originUserId, data }
 */
export async function notifyBranchStaff(ownerId, branchId, { type, originUserId, data = {} }) {
  if (!ownerId || !branchId) return;

  const tpl = EVENTS[type];
  if (!tpl) { console.warn("[notifyEngine] notifyBranchStaff: unknown type:", type); return; }

  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, user_id")
    .eq("owner_id", ownerId)
    .eq("branch_id", branchId)
    .eq("status", "active")
    .neq("role", "manager")
    .not("user_id", "is", null);

  if (!staffRows?.length) return;

  const title    = tpl.title(data);
  const body     = tpl.body(data);
  const deepLink = typeof tpl.deepLink === "function" ? tpl.deepLink(data) : (tpl.deepLink ?? null);

  await Promise.allSettled(
    staffRows
      .filter(s => !originUserId || (s.user_id !== originUserId && s.id !== originUserId))
      .map(s => {
        const baseDk = tpl.dedupeKey ? (typeof tpl.dedupeKey === "function" ? tpl.dedupeKey(data) : tpl.dedupeKey) : null;
        const dk     = baseDk ? `staff_${s.user_id}_${baseDk}` : null;
        return supabase.functions.invoke("notify-send", {
          body: { action: "notify", userId: s.user_id, type, title, body, deepLink, priority: "high", dedupeKey: dk, category: tpl.category },
        });
      })
  );
}

// Re-export the template map so tests can validate templates without invoking the edge function
export { EVENTS as _NOTIFICATION_EVENTS };
