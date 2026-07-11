-- Phase 1, Step 6: Fix ajo group limit trigger (H-4 from audit).
-- The trigger function trg_check_ajo_group_limit() and its trigger were created
-- against the old table name "aso_groups" which no longer exists.
-- The correct table is "ajo_groups".

-- Drop trigger from the old (wrong) table only if that table still exists.
-- PostgreSQL evaluates the table reference even with IF EXISTS, so we guard.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'aso_groups'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_ajo_group_limit ON aso_groups';
  END IF;
END;
$$;

-- Drop trigger from the correct table (always exists after ajo_groups migration)
DROP TRIGGER IF EXISTS trg_ajo_group_limit ON ajo_groups;

-- Recreate function with correct table reference
CREATE OR REPLACE FUNCTION trg_check_ajo_group_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_limit INT := 10;  -- default group limit per owner
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM ajo_groups
  WHERE owner_id = NEW.owner_id
    AND is_active = true;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Group limit reached (% groups maximum per owner)', v_limit;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach to the correct table
CREATE TRIGGER trg_ajo_group_limit
  BEFORE INSERT ON ajo_groups
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_ajo_group_limit();
