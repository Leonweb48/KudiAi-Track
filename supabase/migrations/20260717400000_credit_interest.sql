-- Optional flat interest on credit records.
-- All three columns are nullable; NULL means zero interest (existing behaviour unchanged).
--
-- interest_type:   'percent' → interest_value is a percentage of principal
--                 'fixed'   → interest_value is a fixed ₦ amount
--                 NULL      → no interest
-- interest_value:  the percent (e.g. 5.0) or fixed ₦ amount entered by the user
-- interest_amount: pre-computed at record creation, stored immutably
--                  = total_amount × interest_value / 100   (percent)
--                  = interest_value                        (fixed)
--                  Never recomputed after creation — no compounding, no time accrual.
--
-- Bills invariant (code-level, not DB-level):
--   The bills system uses transactions.bill_status + payment_type='bill_payment'.
--   Bills do NOT share the credits table — they are structurally separate.
--   No bill path can set or read interest_type / interest_value / interest_amount
--   by construction. This is enforced in useStore.addCredit and the profitEngine.
--
-- Staff boundary:
--   Staff can create credit records (existing INSERT policy preserved).
--   Staff see total-due in the repayment surface only — interest decomposition
--   (principal / interest / total split) is owner-only in the UI.
--   The columns themselves are readable by staff via the credits RLS policy;
--   decomposition is withheld at the component layer, not the DB layer.

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS interest_type   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interest_value  NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interest_amount NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.credits.interest_type   IS 'percent | fixed | NULL';
COMMENT ON COLUMN public.credits.interest_value  IS 'Percentage or fixed ₦ — as entered by user';
COMMENT ON COLUMN public.credits.interest_amount IS 'Pre-computed flat interest in ₦; immutable after creation';
