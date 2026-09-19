// Gate for diagnostic / operator-only endpoints under api/.
//
// These routes used to be open to the internet: /api/delivery-log returned
// recipient addresses and subjects, /api/email-send-test?to=<anyone> sent real
// mail. They now require the same x-trigger-secret header the other internal
// callers use (EMAIL_TRIGGER_SECRET, or the service-role key as the fallback
// that api/email-trigger already accepts).
import { timingSafeEqual } from "node:crypto";

export function requireTriggerSecret(req, res) {
  const provided = String(req.headers["x-trigger-secret"] || "");
  const valid = [process.env.EMAIL_TRIGGER_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean);
  const ok = provided.length > 0 && valid.some((v) => v.length === provided.length && timingSafeEqual(Buffer.from(v), Buffer.from(provided)));
  if (!ok) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
