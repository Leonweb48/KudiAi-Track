-- Verification columns on profiles (previously bootstrapped inside the edge function).
-- Moving to a proper migration makes the schema reliable and removes the
-- direct postgres dependency from the verify-identity edge function.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status          TEXT        DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS nin_verified                 BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS bvn_verified                 BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_verified                BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_name                TEXT,
  ADD COLUMN IF NOT EXISTS verification_submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS tier2_trigger                TEXT,
  ADD COLUMN IF NOT EXISTS tier2_trigger_detail         TEXT;

CREATE TABLE IF NOT EXISTS public.verification_submissions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier                INT         NOT NULL DEFAULT 1,
  status              TEXT        NOT NULL DEFAULT 'pending',
  nin                 TEXT,
  bvn                 TEXT,
  submitted_name      TEXT,
  verified_name       TEXT,
  name_match_score    INT,
  nin_verified        BOOLEAN     DEFAULT false,
  bvn_verified        BOOLEAN     DEFAULT false,
  provider_response   JSONB,
  rejection_reason    TEXT,
  doc_url             TEXT,
  guarantor1_name     TEXT,
  guarantor1_phone    TEXT,
  guarantor1_email    TEXT,
  guarantor1_address  TEXT,
  guarantor1_nin      TEXT,
  guarantor2_name     TEXT,
  guarantor2_phone    TEXT,
  guarantor2_email    TEXT,
  guarantor2_address  TEXT,
  guarantor2_nin      TEXT,
  submitted_at        TIMESTAMPTZ DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,
  reviewer_id         UUID,
  review_notes        TEXT
);

ALTER TABLE public.verification_submissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_submissions' AND policyname = 'user_sees_own'
  ) THEN
    CREATE POLICY "user_sees_own" ON public.verification_submissions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
