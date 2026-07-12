-- Fix 1: ajo_client_ledger_balance — add esusu_payout (credit) and commission (debit)
-- Root cause of E.1 reconciliation divergence: esusu_payout credits stored balance
-- but were not counted in the ledger, making ledger < stored.
CREATE OR REPLACE FUNCTION public.ajo_client_ledger_balance(p_client_id uuid)
  RETURNS numeric
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    SUM(CASE
      WHEN type IN (
        'contribution',
        'esusu_payout',
        'reversal_withdrawal',
        'reversal_withdrawal_fee',
        'reversal_registration_fee'
      ) AND status = 'completed' THEN amount
      ELSE 0
    END)
    -
    SUM(CASE
      WHEN type IN (
        'withdrawal',
        'withdrawal_fee',
        'registration_fee',
        'reversal_contribution',
        'commission'
      ) AND status = 'completed' THEN amount
      ELSE 0
    END),
  0)
  FROM ajo_contributions
  WHERE aso_client_id = p_client_id;
$$;

-- Fix 2: Lock down RPC grants — revoke public/anon/authenticated access
REVOKE ALL ON FUNCTION public.ajo_client_ledger_balance(uuid)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_ledger_balance(uuid)  TO service_role;

REVOKE ALL ON FUNCTION public.ajo_run_reconciliation()          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_run_reconciliation()          TO service_role;

-- Fix 3: Enable RLS on Phase 3 tables that were left open

-- ajo_group_rounds: no owner_id column, join through ajo_groups
ALTER TABLE ajo_group_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own group rounds" ON ajo_group_rounds
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ajo_groups
    WHERE ajo_groups.id = ajo_group_rounds.group_id
      AND ajo_groups.owner_id = auth.uid()
  ));

-- ajo_group_turns: owner sees all turns in their group; client sees their own turn
ALTER TABLE ajo_group_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own group turns" ON ajo_group_turns
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ajo_groups
    WHERE ajo_groups.id = ajo_group_turns.group_id
      AND ajo_groups.owner_id = auth.uid()
  ));
CREATE POLICY "client reads own turns" ON ajo_group_turns
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM aso_clients
    WHERE aso_clients.id = ajo_group_turns.client_id
      AND aso_clients.client_user_id = auth.uid()
  ));

-- ajo_esusu_debts: owner sees group debts; debtor sees their own
ALTER TABLE ajo_esusu_debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own group debts" ON ajo_esusu_debts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ajo_groups
    WHERE ajo_groups.id = ajo_esusu_debts.group_id
      AND ajo_groups.owner_id = auth.uid()
  ));
CREATE POLICY "client reads own debts" ON ajo_esusu_debts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM aso_clients
    WHERE aso_clients.id = ajo_esusu_debts.debtor_client_id
      AND aso_clients.client_user_id = auth.uid()
  ));

-- ajo_reorder_log: has owner_id column directly
ALTER TABLE ajo_reorder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own reorder log" ON ajo_reorder_log
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
