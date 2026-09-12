-- Real BVN verification (Flutterwave v3 BVN Verification, a NIBSS/CBN consent-OTP
-- flow) — v4's /virtual-accounts only ever recorded a BVN, never verified it was
-- genuine. These columns track the verification lifecycle. bvn_hash is a SHA-256
-- of the verified BVN (never the BVN itself) so provision-account can confirm the
-- BVN it's about to submit is the same one that was actually verified.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bvn_verification_reference text,
  ADD COLUMN IF NOT EXISTS bvn_hash                    text,
  ADD COLUMN IF NOT EXISTS bvn_verified_at             timestamptz;

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS bvn_verified               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bvn_verification_reference text,
  ADD COLUMN IF NOT EXISTS bvn_hash                    text,
  ADD COLUMN IF NOT EXISTS bvn_verified_name           text,
  ADD COLUMN IF NOT EXISTS bvn_verified_at             timestamptz;
