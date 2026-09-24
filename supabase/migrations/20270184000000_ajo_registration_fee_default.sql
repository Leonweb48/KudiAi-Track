-- Business-level default registration fee for Ajo/Savings clients.
--
-- Why: a self-registering client used to get registration_charge = 0 hard-coded, and the owner's approval form had
-- no fee field, so no self-registered client could ever be charged (and none was told about a fee). The fee is
-- taken once, from the client's FIRST completed deposit (ajo_record_contribution / manual-deposit confirm), using the
-- client's own aso_clients.registration_charge. This column lets a business publish its fee up front: the signup page
-- shows it, and self-register copies it onto the new client. The owner can still override it per client at approval.
--
-- Default 0 for every business → no behaviour change and nobody is charged until an owner sets a fee.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ajo_registration_fee numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_ajo_registration_fee_range') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ajo_registration_fee_range
      CHECK (ajo_registration_fee >= 0 AND ajo_registration_fee <= 1000000);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.ajo_registration_fee IS
  'Default one-off registration fee (naira) for new Ajo clients of this business. Shown on signup, copied to aso_clients.registration_charge by ajo-portal self-register; charged from the first deposit.';
