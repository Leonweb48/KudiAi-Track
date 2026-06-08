import { supabase } from "./supabase";

export async function logAudit({ ownerId, staffId = null, staffName = "Owner", action, module = "", details = "" }) {
  try {
    await supabase.from("audit_logs").insert({
      owner_id:   ownerId,
      staff_id:   staffId,
      staff_name: staffName,
      action,
      module,
      details,
    });
  } catch (_) {
    // audit failures are non-fatal
  }
}
