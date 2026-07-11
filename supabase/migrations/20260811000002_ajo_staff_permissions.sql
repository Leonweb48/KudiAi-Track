-- Add granular Ajo sub-permissions to staff_permissions.
-- These three columns are only meaningful when module = 'aso'.
--
-- Column semantics (all default false = safest):
--   can_view               → ajo_view         (existing column, unchanged)
--   can_create             → ajo_record_contributions (existing column, re-purposed label only)
--   ajo_confirm_deposits   → confirm / reject manual bank-transfer claims
--   ajo_record_withdrawals → record withdrawals and reverse contributions
--   ajo_manage_clients     → create, edit, and archive Ajo clients
--
-- Migration is safe to replay: ADD COLUMN IF NOT EXISTS with NOT NULL + DEFAULT.
-- Existing aso rows automatically get false on all three new columns, which
-- matches the spec ("default for existing staff: view + record contributions only").

ALTER TABLE public.staff_permissions
  ADD COLUMN IF NOT EXISTS ajo_confirm_deposits   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajo_record_withdrawals BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajo_manage_clients     BOOLEAN NOT NULL DEFAULT false;
