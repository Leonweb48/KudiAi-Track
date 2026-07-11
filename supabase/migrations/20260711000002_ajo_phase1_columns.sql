-- Phase 1, Step 2: Additive columns — archive support, reversal chain, fee linkage.
-- No existing data is changed; no downtime required.

-- aso_clients: soft-archive columns
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by  UUID;  -- references auth.users; soft ref only

-- ajo_contributions: reversal chain — tracks which row this row reverses
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS reverses_contribution_id UUID
    REFERENCES ajo_contributions(id) ON DELETE RESTRICT;

-- ajo_contributions: fee linkage — fee rows point to their parent transaction row.
-- Replaces notes-based proximity grouping. History modal groups by this column.
-- Group reversal in ajo_reverse_contribution uses this to find fee rows.
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS fee_for_contribution_id UUID
    REFERENCES ajo_contributions(id) ON DELETE RESTRICT;

-- One reversal row per original row — prevents double-reversal at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS ajo_contributions_reversal_unique
  ON ajo_contributions (reverses_contribution_id)
  WHERE reverses_contribution_id IS NOT NULL;

-- Index for history modal grouping and reversal fee lookup.
CREATE INDEX IF NOT EXISTS ajo_contributions_fee_for_idx
  ON ajo_contributions (fee_for_contribution_id)
  WHERE fee_for_contribution_id IS NOT NULL;
