-- ═════════════════════════════════════════════════════════════════════════════
-- Data repair: esusu payouts mistagged during the original rotation system's
-- first ~week (esusu launched 2026-08-22; contribution_context was added
-- 2026-08-23 as NOT NULL DEFAULT 'personal_savings'; ajo_execute_payout's
-- INSERT wasn't updated to pass 'esusu_rotation' explicitly until
-- 20260901000005_ajo_esusu_solvency.sql).
--
-- Symptom: a client whose esusu pot really was paid out (current_balance was
-- correctly credited in the same original transaction — that part of the bug
-- window's code was fine) sees a positive "ready to withdraw" total, but a
-- withdrawal from that specific circle is rejected as "0 available." The
-- client-side ceiling (getGroupStats' isEsusu branch, AjoMemberPortal.jsx)
-- filters strictly on contribution_context = 'esusu_rotation' AND a matching
-- group_id — a payout row still carrying the column's default
-- ('personal_savings') and a NULL group_id (group_id didn't exist as a
-- column until 20261002000000, and its one-time backfill in
-- 20261017000002_fix_esusu_multi_group_isolation.sql explicitly excluded
-- rows that weren't already tagged 'esusu_rotation') fails both checks and
-- is silently treated as if it never happened.
--
-- Fix: ajo_group_turns.payout_contribution_id -> ajo_contributions.id is a
-- unique-when-set FK that every version of ajo_execute_payout populated
-- correctly, bug window included (only the contribution row's own
-- contribution_context/group_id were ever wrong). The turn's own group_id
-- was never touched by this bug, so it's an unambiguous, no-guessing source
-- of truth to repair the contribution row from — no need to parse `notes` or
-- match round numbers, which (per investigation) would have been ambiguous
-- for a client in more than one rotating group.
--
-- Scoped purely by the mistagged-row signature itself (type + context +
-- null group_id), not a date range — that signature cannot be produced by
-- any correct code path past this fix, and pins the fix to exactly the rows
-- the bug produced regardless of the exact hour the window opened/closed.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_orphans INT;
  v_fixed   INT;
BEGIN
  -- A mistagged payout with no matching turn FK would mean this repair can't
  -- reach it — surface that loudly rather than silently leaving it broken.
  SELECT count(*) INTO v_orphans
  FROM ajo_contributions ac
  WHERE ac.type = 'esusu_payout'
    AND ac.contribution_context = 'personal_savings'
    AND ac.group_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM ajo_group_turns t WHERE t.payout_contribution_id = ac.id
    );
  IF v_orphans > 0 THEN
    RAISE WARNING 'esusu payout data repair: % mistagged row(s) have NO matching ajo_group_turns FK — left untouched, needs manual follow-up', v_orphans;
  END IF;

  UPDATE ajo_contributions ac
  SET group_id = t.group_id,
      contribution_context = 'esusu_rotation'
  FROM ajo_group_turns t
  WHERE t.payout_contribution_id = ac.id
    AND ac.type = 'esusu_payout'
    AND ac.contribution_context = 'personal_savings'
    AND ac.group_id IS NULL;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'esusu payout data repair: retagged % row(s) to contribution_context=esusu_rotation with the correct group_id', v_fixed;
END $$;
