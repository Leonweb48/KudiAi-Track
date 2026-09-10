-- ═════════════════════════════════════════════════════════════════════════════
-- Receipt fields for wallet transfers.
--
-- The transfer.disburse webhook now stamps the recipient bank's display name and
-- the NIP session id onto the withdrawal, so the in-app receipt can show the same
-- "Recipient Details / Session ID / Transaction No." block a bank alert shows.
-- Both are nullable and filled asynchronously by the webhook — no code path
-- depends on them being present.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS bank_name  TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS session_id TEXT;
