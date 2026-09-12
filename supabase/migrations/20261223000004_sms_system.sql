-- SMS system foundation (Sendchamp). A new sms-send edge function is the only
-- writer — every send attempt (sent, failed, rate-limited, suppressed by
-- preference, invalid phone) is logged here for delivery debugging and spend
-- auditing, the same role wallet_webhook_log/paystack_webhook_log play for
-- their domains. Service-role only; no direct client access.

CREATE TABLE IF NOT EXISTS sms_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              text NOT NULL,
  message            text NOT NULL,
  category           text NOT NULL DEFAULT 'money',
  related_type       text,
  related_id         text,
  status             text NOT NULL,
  provider_reference text,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_log_phone_created_idx ON sms_log (phone, created_at DESC);

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon — RLS enabled with zero policies denies
-- both by default; service_role bypasses RLS entirely (Supabase default).

-- Shared SMS on/off toggle, mirroring the existing push_enabled column —
-- category gating (money/savings/stock/permissions/approvals) is reused as-is
-- from notification_preferences rather than duplicated per channel.
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT true;
