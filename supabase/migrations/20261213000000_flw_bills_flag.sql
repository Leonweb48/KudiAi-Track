-- ═════════════════════════════════════════════════════════════════════════════
-- Flag for the Flutterwave replacement of Paystack's bill-payment card popup.
-- Off by default — Paystack keeps handling non-wallet bill payments until this
-- is flipped on and proven (same "flagged rollout per surface" pattern as the
-- wallet itself). See flutterwave/index.ts action "charge-bill" and
-- flutterwave-webhook/index.ts's pending_bills branch.
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_config (key, value)
VALUES ('flw_bills_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
