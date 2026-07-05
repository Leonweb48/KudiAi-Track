-- Enforce minimum age of 18 years on date_of_birth fields.
-- NULL is allowed (field is optional).
-- Constraint is evaluated at INSERT/UPDATE time using CURRENT_DATE,
-- so it correctly gates future edits too.

ALTER TABLE profiles
  ADD CONSTRAINT chk_profiles_dob_min_age
  CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'));

-- Apply the same constraint to cooperative member records
ALTER TABLE coop_members
  ADD CONSTRAINT chk_coop_members_dob_min_age
  CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'));
