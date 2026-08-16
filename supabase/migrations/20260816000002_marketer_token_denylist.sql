-- H-03: Marketer token denylist
-- Mirrors admin_token_denylist pattern.
-- Individual tokens are revoked on logout (jti-based).
-- All tokens can be revoked at once via tokens_valid_after on brm_marketers (revoke-all-sessions).

CREATE TABLE IF NOT EXISTS marketer_token_denylist (
  jti         TEXT        PRIMARY KEY,
  marketer_id UUID        NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for TTL-based cleanup queries
CREATE INDEX IF NOT EXISTS marketer_token_denylist_expires_at_idx
  ON marketer_token_denylist (expires_at);

-- Account-level revocation: any token issued before this timestamp is rejected
ALTER TABLE brm_marketers
  ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;

-- Only service_role may access the denylist
ALTER TABLE marketer_token_denylist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketer_token_denylist FROM public;
REVOKE ALL ON marketer_token_denylist FROM anon;
REVOKE ALL ON marketer_token_denylist FROM authenticated;
GRANT  ALL ON marketer_token_denylist TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260816000002',
  'marketer_token_denylist',
  ARRAY[
    'CREATE TABLE IF NOT EXISTS marketer_token_denylist (jti TEXT PRIMARY KEY, marketer_id UUID NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    'ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ'
  ]
)
ON CONFLICT (version) DO NOTHING;
