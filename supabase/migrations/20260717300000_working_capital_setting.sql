-- Working Capital setting — two nullable columns on profiles.
-- NULL working_capital_amount means the feature is unset and every Part A surface
-- (status line, daily-summary line, info-sheet paragraph) is hidden entirely.
-- Every figure is derived on-read from transaction history; nothing is cached here.
--
-- No stored counters: capitalPosition = declared_capital + compute(from..now).netProfit
-- is re-derived client-side on every Finance dashboard render.
-- working_capital_as_of controls the start of the cumulative profit window;
-- NULL means all recorded history is included.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS working_capital_amount BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS working_capital_as_of  DATE   DEFAULT NULL;

COMMENT ON COLUMN public.profiles.working_capital_amount IS
  'Owner-declared working capital in kobo (₦1 = 100 kobo). NULL = feature not set / hidden.';
COMMENT ON COLUMN public.profiles.working_capital_as_of IS
  'Optional "as of" date: cumulative profit measured from this date. NULL = all-time.';
