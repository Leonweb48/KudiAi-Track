import { supabase } from "./supabase";

/**
 * Log an action to both the local audit_logs table and the platform_activity_log.
 * Non-fatal — failures are swallowed silently.
 */
export async function logAudit({
  ownerId,
  staffId     = null,
  staffName   = "Owner",
  action,
  module      = "",
  details     = "",
  userType    = null,  // 'business' | 'staff' | 'ajo_client' | 'org_member' | 'marketer' | 'admin'
  category    = "general",
}) {
  try {
    // Local legacy audit log
    await supabase.from("audit_logs").insert({
      owner_id:   ownerId,
      staff_id:   staffId,
      staff_name: staffName,
      action,
      module,
      details,
    });
  } catch (_) {}

  try {
    // Platform-wide activity log (used by admin portal audit trail)
    await supabase.from("platform_activity_log").insert({
      user_id:     staffId || ownerId,
      user_type:   userType || (staffId ? "staff" : "business"),
      action,
      category,
      description: details || `${action}${module ? ` in ${module}` : ""}`,
      metadata:    { owner_id: ownerId, staff_name: staffName },
    });
  } catch (_) {}
}

/** Convenience: log a transaction event */
export function logTransaction({ ownerId, staffId, staffName, type, amount, item }) {
  return logAudit({
    ownerId, staffId, staffName,
    action:   type === "in" ? "TRANSACTION_CREDIT" : "TRANSACTION_DEBIT",
    module:   "transactions",
    details:  `${type === "in" ? "Cash In" : "Cash Out"}: ₦${amount} — ${item}`,
    category: "transaction",
  });
}

/** Convenience: log an ajo event */
export function logAjo({ ownerId, staffId, staffName, action, amount, clientName }) {
  return logAudit({
    ownerId, staffId, staffName,
    action,
    module:   "ajo",
    details:  `${action}: ₦${amount}${clientName ? ` for ${clientName}` : ""}`,
    category: "ajo",
  });
}

/** Convenience: log a login/auth event */
export function logAuth({ userId, userType, action, details = "" }) {
  return logAudit({
    ownerId:  userId,
    action,
    module:   "auth",
    details,
    userType,
    category: "auth",
  });
}
