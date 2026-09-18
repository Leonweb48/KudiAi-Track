-- ═════════════════════════════════════════════════════════════════════════════
-- Read-only diagnostic — prints (via RAISE NOTICE, visible in the migration's
-- GitHub Actions log) the current state of any outstanding wallet payout for
-- clients named "Solomon John" or "Happiness Sylvester", plus their owning
-- business's live wallet balance, so the real blocker can be seen instead of
-- guessed at. No rows are modified.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      c.full_name,
      p.id            AS payout_id,
      p.status,
      p.failure_reason,
      p.amount_kobo,
      p.scheduled_date,
      p.created_at,
      p.owner_id,
      w.balance_kobo  AS owner_balance_kobo,
      w.status        AS owner_wallet_status
    FROM public.ajo_wallet_payouts p
    JOIN public.aso_clients c ON c.id = p.client_id
    LEFT JOIN public.wallets w ON w.user_id = p.owner_id
    WHERE c.full_name ILIKE '%Solomon%John%'
       OR c.full_name ILIKE '%Happiness%Sylvester%'
       OR c.full_name ILIKE '%Happiness%Slyvester%'
    ORDER BY p.created_at DESC
  LOOP
    RAISE NOTICE 'client=% payout_id=% status=% failure_reason=% amount_kobo=% scheduled_date=% created_at=% owner_id=% owner_balance_kobo=% owner_wallet_status=%',
      v_row.full_name, v_row.payout_id, v_row.status, v_row.failure_reason,
      v_row.amount_kobo, v_row.scheduled_date, v_row.created_at, v_row.owner_id,
      v_row.owner_balance_kobo, v_row.owner_wallet_status;
  END LOOP;

  IF NOT FOUND THEN
    RAISE NOTICE 'No ajo_wallet_payouts rows found for those client names.';
  END IF;
END $$;
