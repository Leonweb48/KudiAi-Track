-- Rule 14 (2026-10-21): when an airtime order was last sent to ClubKonnect. After a timeout, an order may move to the
-- backup provider only when this is at least 75 seconds old AND ClubKonnect's lookup says it holds no order
-- (supabase/functions/clubkonnect: ckNoOrderAfterTimeout). Written by the function with the service role only.
ALTER TABLE public.bill_provider_attempts ADD COLUMN IF NOT EXISTS ck_last_sent_at timestamptz;
