-- ═════════════════════════════════════════════════════════════════════════════
-- Turn off wallet test mode — the owner has real clients onboarded and wants
-- to be live. This single flag controls three things (all appropriate to
-- disable together now):
--   1. The BVN field on the owner/client/staff wallet-activation screens
--      switches from hidden+optional to visible+required (Wallet.jsx,
--      AjoMemberPortal.jsx's MemberWalletSheet, StaffWalletPanel.jsx all
--      read this same flag).
--   2. supabase/functions/flutterwave/index.ts's "provision-account" action
--      stops substituting FLW_TEST_BVN for a blank BVN — every wallet
--      activated from here on must supply its own real BVN.
--   3. The "test mode" banner and simulate-topup test button disappear from
--      the Wallet screen.
--
-- Does NOT retroactively change anything about wallets already activated
-- while this was on — those keep whichever identity Flutterwave already
-- assigned them. This only changes provisioning behaviour going forward.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_prev TEXT;
BEGIN
  SELECT value INTO v_prev FROM platform_config WHERE key = 'wallet_test_mode';

  UPDATE platform_config SET value = 'false' WHERE key = 'wallet_test_mode';

  RAISE NOTICE 'wallet_test_mode: % -> false', COALESCE(v_prev, '(no row found)');
END $$;
