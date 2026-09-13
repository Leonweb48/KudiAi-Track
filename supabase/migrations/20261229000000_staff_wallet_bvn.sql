-- Staff/managers get their own individual KudiAI Wallet (own BVN verification,
-- own virtual account, own balance) so they can pay for customers' bills without
-- Paystack — they log in with their own Supabase Auth account (separate from the
-- owner's), so a wallet debit can only ever be attributed correctly if it's their
-- own wallet, not the owner's. Same columns as aso_clients (20261225000000), same
-- meaning: bvn_hash is a SHA-256 of the verified BVN, never the BVN itself.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS bvn_verified               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bvn_verification_reference text,
  ADD COLUMN IF NOT EXISTS bvn_hash                    text,
  ADD COLUMN IF NOT EXISTS bvn_verified_name           text,
  ADD COLUMN IF NOT EXISTS bvn_verified_at             timestamptz;
