-- Loyalty Program switched on (2026-10-13, owner: "do all of it"). Its three tables already have per-owner RLS
-- (auth.uid() = user_id); signed-out visitors never need them, so their table privileges are removed too.
REVOKE ALL ON public.customer_loyalty, public.loyalty_transactions, public.loyalty_settings FROM anon;
DO $$ BEGIN
  RAISE NOTICE 'loyalty | anon can read customer_loyalty: %', has_table_privilege('anon', 'public.customer_loyalty', 'SELECT');
END $$;
