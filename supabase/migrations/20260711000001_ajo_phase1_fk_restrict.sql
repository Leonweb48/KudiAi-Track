-- Phase 1, Step 1: FK CASCADE → RESTRICT on both contribution tables.
-- Prevents hard-deleting a client with financial history at the DB level.

-- ── Orphan quarantine report (runs before constraint is added) ────────────────
-- Logs any ajo_contributions rows whose aso_client_id has no matching client,
-- and any mismatched-owner rows. These must be quarantined before adding
-- a proper FK (if any exist, the ALTER below will already reject them).
DO $$
DECLARE
  r   RECORD;
  cnt INT := 0;
BEGIN
  -- Orphaned contributions (no matching client)
  FOR r IN
    SELECT ac.id, ac.aso_client_id, ac.type, ac.amount, ac.status, ac.created_at
    FROM ajo_contributions ac
    LEFT JOIN aso_clients cl ON cl.id = ac.aso_client_id
    WHERE cl.id IS NULL
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'ORPHAN_CONTRIBUTION: id=% client_id=% type=% amount=% status=% created=%',
      r.id, r.aso_client_id, r.type, r.amount, r.status, r.created_at;
  END LOOP;

  IF cnt = 0 THEN
    RAISE NOTICE 'ORPHAN_CHECK_contributions: 0 orphaned rows — clean.';
  ELSE
    RAISE EXCEPTION 'ORPHAN_CHECK_contributions: % orphaned row(s) found. Quarantine these UUIDs before continuing.', cnt;
  END IF;
END;
$$;

DO $$
DECLARE
  r   RECORD;
  cnt INT := 0;
BEGIN
  FOR r IN
    SELECT wr.id, wr.aso_client_id, wr.amount, wr.status
    FROM ajo_withdrawal_requests wr
    LEFT JOIN aso_clients cl ON cl.id = wr.aso_client_id
    WHERE cl.id IS NULL
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'ORPHAN_WITHDRAWAL_REQ: id=% client_id=% amount=% status=%',
      r.id, r.aso_client_id, r.amount, r.status;
  END LOOP;

  IF cnt = 0 THEN
    RAISE NOTICE 'ORPHAN_CHECK_withdrawal_requests: 0 orphaned rows — clean.';
  ELSE
    RAISE EXCEPTION 'ORPHAN_CHECK_withdrawal_requests: % orphaned row(s) found. Quarantine these UUIDs before continuing.', cnt;
  END IF;
END;
$$;

-- ── Upgrade FK: CASCADE → RESTRICT ───────────────────────────────────────────
ALTER TABLE ajo_contributions
  DROP CONSTRAINT IF EXISTS ajo_contributions_aso_client_id_fkey,
  ADD  CONSTRAINT ajo_contributions_aso_client_id_fkey
    FOREIGN KEY (aso_client_id) REFERENCES aso_clients(id) ON DELETE RESTRICT;

ALTER TABLE ajo_withdrawal_requests
  DROP CONSTRAINT IF EXISTS ajo_withdrawal_requests_aso_client_id_fkey,
  ADD  CONSTRAINT ajo_withdrawal_requests_aso_client_id_fkey
    FOREIGN KEY (aso_client_id) REFERENCES aso_clients(id) ON DELETE RESTRICT;
