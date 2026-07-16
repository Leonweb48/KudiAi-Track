-- bill_beneficiaries: server-persisted bill recipient store.
-- Mirrors the localStorage bill-bens shape, owner-scoped with RLS.
CREATE TABLE IF NOT EXISTS bill_beneficiaries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL,
  identifier  TEXT        NOT NULL,   -- dedup key: phone / meter_no / smartcard / company:customer_id / account_no
  nickname    TEXT,
  verify_name TEXT,
  network     TEXT,
  meter_type  TEXT,
  provider    TEXT,
  company     TEXT,
  phone       TEXT,
  meter_no    TEXT,
  smartcard   TEXT,
  customer_id TEXT,
  account_no  TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, category, identifier)
);

ALTER TABLE bill_beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bill_bens_owner_all" ON bill_beneficiaries
  FOR ALL
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS bill_bens_owner_saved
  ON bill_beneficiaries (owner_id, saved_at DESC);
