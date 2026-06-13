-- Add OTP columns for member email verification (stored in DB, sent in welcome email)
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS otp_code TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;

-- Expand role CHECK constraint to include all common organisational roles.
-- The old constraint only allowed: admin, president, treasurer, secretary, officer, member.
-- New roles needed: chairman, vice_chairman, welfare_officer, auditor, patron.
ALTER TABLE public.org_members
  DROP CONSTRAINT IF EXISTS org_members_role_check;

ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
  CHECK (role IN (
    'admin', 'president', 'chairman', 'vice_chairman',
    'treasurer', 'secretary', 'officer',
    'welfare_officer', 'auditor', 'patron', 'member'
  ));
