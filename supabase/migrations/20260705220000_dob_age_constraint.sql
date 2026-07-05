-- Enforce minimum age of 18 years on date_of_birth fields.
-- NULL is allowed (field is optional).
-- Constraint is evaluated at INSERT/UPDATE time using CURRENT_DATE.

ALTER TABLE profiles
  ADD CONSTRAINT chk_profiles_dob_min_age
  CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'));

-- Apply to coop_members only if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coop_members') THEN
    ALTER TABLE coop_members
      ADD CONSTRAINT chk_coop_members_dob_min_age
      CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'));
  END IF;
END $$;
