-- Add a freeform Paystack payment-link URL to each Ajo client.
-- The business pastes the Paystack Pay link they created for this client
-- (e.g. https://paystack.com/pay/client-slug) and it is stored here.
-- No API call is made server-side; storage only.

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS paystack_link TEXT;
