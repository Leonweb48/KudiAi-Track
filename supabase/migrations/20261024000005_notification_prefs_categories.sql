-- Add per-portal notification preference categories.
--
-- pref_permissions: permission/role changes, invitations, shift updates
-- pref_approvals:   collection/contribution approval outcomes (staff-facing)
--
-- Both default to true (existing rows inherit the default automatically).

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS pref_permissions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_approvals   boolean NOT NULL DEFAULT true;

-- Update the RLS policy to allow reading/writing new columns (policy covers all columns by SELECT *)
-- No policy change needed — existing policies use SELECT * / FOR ALL which include new columns.
