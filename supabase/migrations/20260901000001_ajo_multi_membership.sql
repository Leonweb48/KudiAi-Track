-- Ajo Multi-Membership
-- Allows a client to have multiple active saving cycles simultaneously and
-- to belong to more than one savings group / esusu.

-- ── 1. Multiple active cycles ─────────────────────────────────────────────
-- The partial UNIQUE index previously enforced "one active cycle per client".
-- Drop it so the same client can run a house-savings cycle and a car-savings
-- cycle in parallel. The label column on ajo_cycles distinguishes them.
DROP INDEX IF EXISTS ajo_cycles_one_active;


-- ── 2. Junction table: one row per (client, group) pair ──────────────────
CREATE TABLE IF NOT EXISTS aso_client_group_memberships (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES aso_clients(id)  ON DELETE CASCADE,
  group_id    UUID        NOT NULL REFERENCES ajo_groups(id)   ON DELETE RESTRICT,
  owner_id    UUID        NOT NULL,           -- denormalised for RLS + fast owner queries
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'left')),
  left_at     TIMESTAMPTZ,
  UNIQUE (client_id, group_id)
);

ALTER TABLE aso_client_group_memberships ENABLE ROW LEVEL SECURITY;

-- Owner can fully manage memberships for their own clients
CREATE POLICY "acgm_owner"
  ON aso_client_group_memberships FOR ALL
  TO authenticated
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Client can read their own memberships
CREATE POLICY "acgm_client_select"
  ON aso_client_group_memberships FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM aso_clients WHERE client_user_id = auth.uid()
    )
  );

-- Staff read: mirrors the staff read policy on aso_clients
CREATE POLICY "acgm_staff_select"
  ON aso_client_group_memberships FOR SELECT
  TO authenticated
  USING (
    owner_id IN (
      SELECT owner_id FROM staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );


-- ── 3. Migrate existing single-group data into junction table ─────────────
INSERT INTO aso_client_group_memberships (client_id, group_id, owner_id, joined_at)
SELECT
  c.id,
  c.ajo_group_id,
  c.user_id,
  COALESCE(c.created_at, NOW())
FROM aso_clients c
WHERE c.ajo_group_id IS NOT NULL
ON CONFLICT (client_id, group_id) DO NOTHING;
