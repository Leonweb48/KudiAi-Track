-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase E: large-transaction threshold + email toggle.
--
-- large_txn_threshold: read by useStore.js's large-transaction-alert check in
-- place of the fixed ₦50,000 default when set. Nullable — NULL means "use
-- the app default", not "zero".
--
-- email_enabled: master switch for the three CLIENT-TRIGGERED emails that
-- previously fired unconditionally with no preference check of any kind —
-- the daily summary (useStore.js), the low-stock alert (useInventory.js),
-- and the bill-payment success email (BillPayments.jsx). It deliberately
-- does NOT claim to cover every email the platform sends (transaction
-- receipts, invoices, OTP/auth mail etc. go through other paths).
-- Defaults true so nothing changes for anyone until they opt out.
--
-- A global default low-stock threshold was considered and deliberately
-- dropped: products.low_stock_threshold already carries its own DB-level
-- DEFAULT 5, so every product row already has a concrete value and a new
-- global preference would have no row to apply to without also changing the
-- product-creation form. Per-product thresholds (Inventory.jsx) remain the
-- way to configure stock alerts.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS large_txn_threshold numeric,
  ADD COLUMN IF NOT EXISTS email_enabled       boolean NOT NULL DEFAULT true;
