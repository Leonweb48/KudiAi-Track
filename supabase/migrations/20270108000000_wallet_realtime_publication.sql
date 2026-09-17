-- ═════════════════════════════════════════════════════════════════════════════
-- Wallet balance never updates live, and a transfer stays "Processing" in the
-- history list until the user manually reloads — even though the underlying
-- data is correct and the client already has fully-wired-up realtime
-- subscription code for exactly this (src/hooks/useWallet.js:87-123).
--
-- Root cause: wallets, wallet_ledger, wallet_withdrawals, and
-- wallet_payment_requests were never added to the supabase_realtime
-- publication. Every other realtime-consuming table in this app opts in
-- explicitly this same way (transactions/credits/ajo_withdrawal_requests in
-- 20260714000004_realtime_core_tables.sql, notifications in
-- 20260905000001_notifications_engine.sql, ajo_cycles in
-- 20261015000004_ajo_portal_realtime_cycles.sql) — the wallet feature was
-- simply never added to that list when it was built. Postgres never emits a
-- WAL change event for these tables to the Realtime server, so the client's
-- channel connects successfully but silently never receives anything —
-- structurally inert, not a bug in the subscription filters themselves.
--
-- This one addition makes every already-correct handler in useWallet.js
-- start firing as originally designed:
--   - wallets UPDATE (balance_kobo change) + wallet_ledger INSERT — fixes a
--     deposit not appearing until manual refresh.
--   - wallet_ledger / wallet_withdrawals UPDATE (status pending->completed,
--     set later by wallet_mark_withdrawal when Flutterwave's own
--     transfer.disburse webhook confirms settlement) — fixes a transfer
--     showing "sent" immediately (Flutterwave *accepting* the disbursement
--     request) while its history row stays stuck on "Processing" until a
--     manual reload. The brief real-world gap between "accepted" and
--     "settled" is inherent to an async payout rail and stays — but it now
--     self-corrects live instead of requiring the user to do anything.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_withdrawals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_payment_requests;
