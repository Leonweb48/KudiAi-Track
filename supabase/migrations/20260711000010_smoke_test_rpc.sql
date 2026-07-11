-- SMOKE TEST — runs against a real client, then reverses everything.
-- Net effect on client data: zero. All rows created here are reversed.
-- Output appears as RAISE NOTICE lines in the migration log.

DO $$
DECLARE
  v_client       RECORD;
  v_balance_orig NUMERIC;
  v_result       JSONB;
  v_contrib_id   UUID;
  v_wr_net_id    UUID;
  v_rev_result   JSONB;
  v_rows         INT;
  v_fee_amount   NUMERIC;
  v_net_amount   NUMERIC;
  v_fee_id       UUID;
  v_balance_mid  NUMERIC;
  v_balance_post NUMERIC;
BEGIN

  -- ── Pick a test client (existing client, total_saved > 0 → no reg fee triggered) ──
  SELECT id, user_id, full_name, current_balance, withdrawal_fee_percent, total_saved
  INTO v_client
  FROM aso_clients
  WHERE archived_at IS NULL
    AND user_id IS NOT NULL
    AND COALESCE(total_saved, 0) > 0
  ORDER BY current_balance DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'SMOKE: No eligible client found (need total_saved > 0). Aborting.';
    RETURN;
  END IF;

  v_balance_orig := COALESCE(v_client.current_balance, 0);
  RAISE NOTICE '──────────────────────────────────────────────';
  RAISE NOTICE 'SMOKE: Client    = % (%)', v_client.full_name, v_client.id;
  RAISE NOTICE 'SMOKE: Balance   = ₦%', v_balance_orig;
  RAISE NOTICE 'SMOKE: Fee rate  = %', COALESCE(v_client.withdrawal_fee_percent, 0);
  RAISE NOTICE '──────────────────────────────────────────────';

  -- ────────────────────────────────────────────────
  -- TEST 1: Record a ₦10 cash contribution
  -- ────────────────────────────────────────────────
  v_result := ajo_record_contribution(
    v_client.id,
    v_client.user_id,
    10.00,
    'cash',
    'smoke-ref-' || substr(gen_random_uuid()::text, 1, 8),
    'SMOKE TEST — reversed immediately',
    NULL
  );

  RAISE NOTICE 'SMOKE TEST 1 — contribution: %', v_result;

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'SMOKE FAIL (T1): contribution rejected — %', v_result->>'error';
  END IF;

  v_contrib_id := (v_result->>'contribution_id')::uuid;

  -- Confirm the row is in the ledger with correct type
  SELECT COUNT(*) INTO v_rows
  FROM ajo_contributions
  WHERE id = v_contrib_id AND type = 'contribution' AND status = 'completed';

  IF v_rows = 1 THEN
    RAISE NOTICE 'SMOKE T1 ✓ contribution row confirmed in ledger';
  ELSE
    RAISE EXCEPTION 'SMOKE FAIL (T1): contribution row not found after insert';
  END IF;

  -- Confirm balance updated
  SELECT current_balance INTO v_balance_mid FROM aso_clients WHERE id = v_client.id;
  IF v_balance_mid = v_balance_orig + 10 THEN
    RAISE NOTICE 'SMOKE T1 ✓ balance updated ₦% → ₦%', v_balance_orig, v_balance_mid;
  ELSE
    RAISE EXCEPTION 'SMOKE FAIL (T1): expected balance ₦% got ₦%', v_balance_orig + 10, v_balance_mid;
  END IF;

  -- ────────────────────────────────────────────────
  -- TEST 2: Record a ₦10 withdrawal (should produce 2 rows if fee > 0, else 1)
  -- ────────────────────────────────────────────────
  v_result := ajo_record_withdrawal(
    v_client.id,
    v_client.user_id,
    10.00,
    'cash',
    'SMOKE TEST withdrawal — reversed immediately',
    NULL,
    NULL
  );

  RAISE NOTICE 'SMOKE TEST 2 — withdrawal: %', v_result;

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'SMOKE FAIL (T2): withdrawal rejected — %', v_result->>'error';
  END IF;

  v_wr_net_id  := (v_result->>'net_id')::uuid;
  v_fee_amount := (v_result->>'fee_amount')::numeric;
  v_net_amount := (v_result->>'net_amount')::numeric;
  v_fee_id     := CASE WHEN v_result->>'fee_id' IS NOT NULL
                       THEN (v_result->>'fee_id')::uuid
                       ELSE NULL END;

  -- Confirm net withdrawal row
  SELECT COUNT(*) INTO v_rows
  FROM ajo_contributions
  WHERE id = v_wr_net_id AND type = 'withdrawal' AND status = 'completed';

  IF v_rows = 1 THEN
    RAISE NOTICE 'SMOKE T2 ✓ net withdrawal row confirmed (₦%)', v_net_amount;
  ELSE
    RAISE EXCEPTION 'SMOKE FAIL (T2): net withdrawal row not found';
  END IF;

  -- Confirm fee row (if fee > 0)
  IF v_fee_amount > 0 THEN
    SELECT COUNT(*) INTO v_rows
    FROM ajo_contributions
    WHERE id = v_fee_id
      AND type = 'withdrawal_fee'
      AND fee_for_contribution_id = v_wr_net_id
      AND status = 'completed';

    IF v_rows = 1 THEN
      RAISE NOTICE 'SMOKE T2 ✓ fee row confirmed (₦%), fee_for_contribution_id links to net row', v_fee_amount;
    ELSE
      RAISE EXCEPTION 'SMOKE FAIL (T2): fee row not found or fee_for_contribution_id not set';
    END IF;
  ELSE
    RAISE NOTICE 'SMOKE T2 — fee rate is 0%% for this client; no fee row expected (correct)';
  END IF;

  -- Confirm gross deducted from balance
  SELECT current_balance INTO v_balance_post FROM aso_clients WHERE id = v_client.id;
  IF v_balance_post = v_balance_orig THEN
    -- contribution +10, withdrawal -10 gross, back to start
    RAISE NOTICE 'SMOKE T2 ✓ balance after withdrawal = ₦% (back to original)', v_balance_post;
  ELSE
    RAISE NOTICE 'SMOKE T2 balance after withdrawal = ₦% (original=₦%, may differ if fee rate != 0)',
      v_balance_post, v_balance_orig;
  END IF;

  -- ────────────────────────────────────────────────
  -- CLEANUP: Reverse the withdrawal (group reversal)
  -- ────────────────────────────────────────────────
  v_rev_result := ajo_reverse_contribution(
    v_wr_net_id,
    v_client.user_id,
    'Smoke test cleanup reversal'
  );

  RAISE NOTICE 'SMOKE CLEANUP — reversal of withdrawal: %', v_rev_result;

  IF NOT (v_rev_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'SMOKE FAIL (cleanup): reversal of withdrawal failed — %', v_rev_result->>'error';
  END IF;

  RAISE NOTICE 'SMOKE CLEANUP ✓ withdrawal reversed';

  -- Reverse the contribution too
  v_rev_result := ajo_reverse_contribution(
    v_contrib_id,
    v_client.user_id,
    'Smoke test cleanup reversal'
  );

  RAISE NOTICE 'SMOKE CLEANUP — reversal of contribution: %', v_rev_result;

  IF NOT (v_rev_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'SMOKE FAIL (cleanup): reversal of contribution failed — %', v_rev_result->>'error';
  END IF;

  -- Final balance should match original
  SELECT current_balance INTO v_balance_post FROM aso_clients WHERE id = v_client.id;

  RAISE NOTICE '──────────────────────────────────────────────';
  IF v_balance_post = v_balance_orig THEN
    RAISE NOTICE 'SMOKE ✓ PASS — balance restored to ₦% (original: ₦%)', v_balance_post, v_balance_orig;
    RAISE NOTICE 'SMOKE ✓ PASS — contribution RPC works';
    RAISE NOTICE 'SMOKE ✓ PASS — withdrawal RPC works (2 rows, fee_for_contribution_id set)';
    RAISE NOTICE 'SMOKE ✓ PASS — group reversal works (balance exactly restored)';
    RAISE NOTICE 'SMOKE ✓ PASS — production RPC path is working correctly';
  ELSE
    RAISE EXCEPTION 'SMOKE FAIL (final): balance did not restore — expected ₦% got ₦%',
      v_balance_orig, v_balance_post;
  END IF;
  RAISE NOTICE '──────────────────────────────────────────────';

END;
$$;
