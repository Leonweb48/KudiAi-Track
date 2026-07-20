/**
 * notifyEngine — the single client-side entry point for all non-email notifications.
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

  contribution_approved: {
    priority: "normal", category: "savings",
    title: () => "Contribution Approved",
    body:  (d) => `Your ₦${fmt(d.amount)} contribution has been approved`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
  },

  contribution_rejected: {
    priority: "normal", category: "savings",
    title: () => "Contribution Rejected",
    body:  (d) => `Your contribution was not approved — ${d.reason || "contact your group admin"}`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
  },

  payout_received: {
    priority: "normal", category: "savings",
    title: () => "Payout Received",
    body:  (d) => `₦${fmt(d.amount)} has been credited to your account`,
    deepLink:  { tab: "contributions" },
    dedupeKey: null,
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

  staff_invite: {
    priority: "normal", category: "money",
    title: () => "Staff Invitation",
    body:  (d) => `${d.businessName || "A business"} invited you as ${d.role || "staff"}`,
    deepLink:  { tab: "home" },
    dedupeKey: null,
  },

  permission_change: {
    priority: "normal", category: "money",
    title: () => "Permissions Updated",
    body:  (d) => `${d.businessName || "Your employer"} updated your access permissions`,
    deepLink:  { tab: "home" },
    dedupeKey: (d) => `perms_${d.staffId}`,
  },

  held_24h: {
    priority: "high", category: "money",
    title: () => "Security Hold Active",
    body:  (d) => `₦${fmt(d.amount)} transaction is in 24h security review`,
    deepLink:  { tab: "finance" },
    dedupeKey: (d) => `held24h_${d.transactionId}`,
  },
};

function fmt(n) {
  return n != null ? Number(n).toLocaleString() : "0";
}

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

  try {
    await supabase.functions.invoke("notify-send", {
      body: {
        action:    "notify",
        userId,
        type,
        title,
        body,
        deepLink,
        priority:  tpl.priority,
        dedupeKey: dk,
        category:  category ?? tpl.category,
      },
    });
  } catch (err) {
    console.warn("[notifyEngine] Failed to send:", err);
  }
}

// Re-export the template map so tests can validate templates without invoking the edge function
export { EVENTS as _NOTIFICATION_EVENTS };
