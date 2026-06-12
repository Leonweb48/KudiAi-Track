-- marketer_otps: custom OTP table for marketer email verification
CREATE TABLE IF NOT EXISTS marketer_otps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID        NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  otp_code    TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketer_otps_marketer_id ON marketer_otps(marketer_id);

-- Track whether the marketer has completed OTP email verification
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Marketers who have already changed their password have been through the login flow
-- and can be considered verified
UPDATE brm_marketers SET email_verified = TRUE WHERE must_change_password = FALSE;
