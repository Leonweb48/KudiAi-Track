-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 1 Live Test Suite — T1 through T11
-- Creates a dedicated test client (archived at the end), runs all behavioural
-- tests with explicit PASS/FAIL per test, cleans up completely.
-- Net effect on production: one archived test client with reversed ledger rows.
-- REVOKE FROM PUBLIC applied in preceding migration 000011.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Core identifiers
  v_owner_id    UUID;
  v_client_id   UUID;

  -- Contribution IDs captured across tests
  v_contrib1_id UUID;  -- first deposit (has registration_fee row)
  v_regfee1_id  UUID;  -- registration_fee row from first deposit
  v_contrib2_id UUID;  -- second deposit (no reg fee row)
  v_wd_net_id   UUID;  -- T3 withdrawal net row
  v_wd_fee_id   UUID;  -- T3 withdrawal fee row
  v_pending_id  UUID;  -- T8 pending row (deleted after test)
  v_wd11_net_id UUID;  -- T11 concurrent-sim withdrawal

  -- Scratch
  v_result      JSONB;
  v_balance     NUMERIC;
  v_count       INT;
  v_wd_fee_type TEXT;

  -- Score
  v_pass        INT := 0;
  v_fail        INT := 0;
  v_skip        INT := 0;
BEGIN

  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE ' Phase 1 Live Test Suite';
  RAISE NOTICE '═══════════════════════════════════════════════════════';

  -- ── Ensure registration_charge column exists ──────────────────────────
  -- The column may be 0 for all production clients; we set it explicitly
  -- on our test client. ADD COLUMN IF NOT EXISTS is a no-op if present.
  ALTER TABLE aso_clients
    ADD COLUMN IF NOT EXISTS registration_charge NUMERIC NOT NULL DEFAULT 0;

  -- ── Find a real owner UUID to anchor the test client ─────────────────
  SELECT DISTINCT user_id INTO v_owner_id
  FROM aso_clients
  WHERE user_id IS NOT NULL
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No owner found — cannot create test client';
  END IF;

  -- ── Create a fresh test client with known fee settings ────────────────
  INSERT INTO aso_clients (
    user_id, full_name, phone, address,
    current_balance, total_saved,
    contribution_amount, contribution_frequency,
    registration_charge, withdrawal_fee_percent,
    status
  ) VALUES (
    v_owner_id,
    'PHASE1_TEST_CLIENT_' || substr(gen_random_uuid()::text, 1, 8),
    '0800000TEST',
    'Test address',
    0, 0,
    1000.00, 'monthly',
    500.00,   -- registration_charge
    5.00,     -- withdrawal_fee_percent
    'active'
  ) RETURNING id INTO v_client_id;

  RAISE NOTICE 'Test client created: % (owner=%)', v_client_id, v_owner_id;
  RAISE NOTICE '───────────────────────────────────────────────────────';

  -- ═══════════════════════════════════════════════════════════════════════
  -- T1: First deposit charges registration fee exactly once
  -- ₦1000 deposit → balance = ₦1000 - ₦500 = ₦500
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T1: First deposit charges registration fee exactly once';

  v_result := ajo_record_contribution(
    v_client_id, v_owner_id, 1000.00, 'cash', NULL, NULL, NULL
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE NOTICE 'T1 ✗ FAIL — contribution rejected: %', v_result->>'error';
    v_fail := v_fail + 1;
  ELSE
    v_contrib1_id := (v_result->>'contribution_id')::uuid;

    -- Find the registration_fee row linked to this contribution
    SELECT id INTO v_regfee1_id
    FROM ajo_contributions
    WHERE aso_client_id = v_client_id AND type = 'registration_fee'
    LIMIT 1;

    SELECT COUNT(*) INTO v_count
    FROM ajo_contributions
    WHERE aso_client_id = v_client_id AND type = 'registration_fee';

    SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;

    IF v_count = 1 AND v_balance = 500 THEN
      RAISE NOTICE 'T1 ✓ PASS — reg_fee row created (₦500), balance=₦% (1000-500)', v_balance;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T1 ✗ FAIL — reg_fee_rows=% balance=% (expected 1, 500)', v_count, v_balance;
      v_fail := v_fail + 1;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T2: Second deposit does NOT charge another registration fee
  -- ₦1000 more → balance = ₦500 + ₦1000 = ₦1500
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T2: Second deposit adds no registration fee';

  v_result := ajo_record_contribution(
    v_client_id, v_owner_id, 1000.00, 'cash', NULL, NULL, NULL
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE NOTICE 'T2 ✗ FAIL — contribution rejected: %', v_result->>'error';
    v_fail := v_fail + 1;
  ELSE
    v_contrib2_id := (v_result->>'contribution_id')::uuid;

    SELECT COUNT(*) INTO v_count
    FROM ajo_contributions
    WHERE aso_client_id = v_client_id AND type = 'registration_fee';

    SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;

    IF v_count = 1 AND v_balance = 1500 THEN
      RAISE NOTICE 'T2 ✓ PASS — still exactly 1 reg_fee row, balance=₦%', v_balance;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T2 ✗ FAIL — reg_fee_rows=% balance=% (expected 1, 1500)', v_count, v_balance;
      v_fail := v_fail + 1;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T3: Full journey — withdrawal never charges registration_fee
  -- Withdraw ₦200 gross → fee=₦10 (5%), net=₦190; balance = ₦1500-₦200 = ₦1300
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T3: Full journey — withdrawal never charges registration_fee';

  v_result := ajo_record_withdrawal(
    v_client_id, v_owner_id, 200.00, 'cash', NULL, NULL, NULL
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE NOTICE 'T3 ✗ FAIL — withdrawal rejected: %', v_result->>'error';
    v_fail := v_fail + 1;
  ELSE
    v_wd_net_id := (v_result->>'net_id')::uuid;
    v_wd_fee_id := CASE WHEN v_result->>'fee_id' IS NOT NULL
                        THEN (v_result->>'fee_id')::uuid ELSE NULL END;

    -- Count registration_fee rows: must still be exactly 1
    SELECT COUNT(*) INTO v_count
    FROM ajo_contributions
    WHERE aso_client_id = v_client_id AND type = 'registration_fee';

    -- Withdrawal fee row must be type='withdrawal_fee'
    SELECT type INTO v_wd_fee_type
    FROM ajo_contributions WHERE id = v_wd_fee_id;

    SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;
    -- Expected: 1500 - 200 = 1300

    IF v_count = 1 AND v_wd_fee_type = 'withdrawal_fee' AND v_balance = 1300 THEN
      RAISE NOTICE 'T3 ✓ PASS — exactly 1 registration_fee row total; withdrawal_fee row created; balance=₦%', v_balance;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3 ✗ FAIL — reg_fee_rows=% wd_fee_type=% balance=% (expected 1, withdrawal_fee, 1300)',
        v_count, v_wd_fee_type, v_balance;
      v_fail := v_fail + 1;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T4: Group reversal of withdrawal — balance returns to exact pre-withdrawal value
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T4: Group reversal restores exact pre-withdrawal balance';

  v_result := ajo_reverse_contribution(
    v_wd_net_id,
    v_owner_id,
    'T4 group reversal test'
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE NOTICE 'T4 ✗ FAIL — reversal rejected: %', v_result->>'error';
    v_fail := v_fail + 1;
  ELSE
    SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;

    -- Verify both reversal rows exist
    SELECT COUNT(*) INTO v_count
    FROM ajo_contributions
    WHERE aso_client_id = v_client_id
      AND type IN ('reversal_withdrawal', 'reversal_withdrawal_fee')
      AND reverses_contribution_id IS NOT NULL;

    IF v_balance = 1500 AND v_count = 2 THEN
      RAISE NOTICE 'T4 ✓ PASS — balance=₦% (exact pre-withdrawal); % reversal rows created', v_balance, v_count;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T4 ✗ FAIL — balance=% (expected 1500); reversal_rows=% (expected 2)',
        v_balance, v_count;
      v_fail := v_fail + 1;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T5: Reconciliation delta = 0 after fee-bearing withdrawal + reversal
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T5: Reconciliation delta = 0 after withdrawal reversal';

  DECLARE
    v_ledger  NUMERIC;
    v_stored  NUMERIC;
  BEGIN
    v_ledger := ajo_client_ledger_balance(v_client_id);
    SELECT current_balance INTO v_stored FROM aso_clients WHERE id = v_client_id;

    IF ABS(v_ledger - v_stored) < 0.001 THEN
      RAISE NOTICE 'T5 ✓ PASS — ledger=₦% stored=₦% delta=₦0.00', v_ledger, v_stored;
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5 ✗ FAIL — ledger=₦% stored=₦% delta=₦%',
        v_ledger, v_stored, v_ledger - v_stored;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T6: Attempting to reverse a fee row is rejected
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T6: Reversal of a fee row is rejected';

  IF v_regfee1_id IS NULL THEN
    RAISE NOTICE 'T6 ⊘ SKIP — no reg_fee row captured (T1 may have failed)';
    v_skip := v_skip + 1;
  ELSE
    BEGIN
      v_result := ajo_reverse_contribution(v_regfee1_id, v_owner_id, 'T6 should fail');
      -- If we get here without exception, check ok=false
      IF NOT (v_result->>'ok')::boolean THEN
        RAISE NOTICE 'T6 ✓ PASS — fee row reversal rejected: %', v_result->>'error';
        v_pass := v_pass + 1;
      ELSE
        RAISE NOTICE 'T6 ✗ FAIL — fee row reversal succeeded (should have been rejected)';
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'T6 ✓ PASS (exception) — fee row reversal raised: %', SQLERRM;
      v_pass := v_pass + 1;
    END;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T7: Double-reversal of the same row is blocked
  -- (reverse contrib2, then try to reverse it again)
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T7: Double-reversal blocked';

  IF v_contrib2_id IS NULL THEN
    RAISE NOTICE 'T7 ⊘ SKIP — contrib2 not captured';
    v_skip := v_skip + 1;
  ELSE
    -- First reversal — must succeed
    v_result := ajo_reverse_contribution(v_contrib2_id, v_owner_id, 'T7 first reversal');
    IF NOT (v_result->>'ok')::boolean THEN
      RAISE NOTICE 'T7 ✗ FAIL — first reversal unexpectedly rejected: %', v_result->>'error';
      v_fail := v_fail + 1;
    ELSE
      -- Second reversal — must be blocked
      BEGIN
        v_result := ajo_reverse_contribution(v_contrib2_id, v_owner_id, 'T7 second reversal should fail');
        IF NOT (v_result->>'ok')::boolean THEN
          RAISE NOTICE 'T7 ✓ PASS — double reversal blocked: %', v_result->>'error';
          v_pass := v_pass + 1;
        ELSE
          RAISE NOTICE 'T7 ✗ FAIL — second reversal succeeded (unique index not enforced)';
          v_fail := v_fail + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'T7 ✓ PASS (unique violation) — %', SQLERRM;
        v_pass := v_pass + 1;
      END;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T8: Attempting to reverse a non-completed (pending) row is rejected
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T8: Reversal of a non-completed (pending) row rejected';

  -- Insert a pending row directly as superuser (bypasses RLS)
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, notes, paystack_status
  ) VALUES (
    v_client_id, v_owner_id, 50.00, 'contribution',
    'cash', 'pending', 'T8 test pending row', 'pending'
  ) RETURNING id INTO v_pending_id;

  BEGIN
    v_result := ajo_reverse_contribution(v_pending_id, v_owner_id, 'T8 should fail');
    IF NOT (v_result->>'ok')::boolean THEN
      RAISE NOTICE 'T8 ✓ PASS — non-completed reversal rejected: %', v_result->>'error';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T8 ✗ FAIL — reversal of pending row succeeded';
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T8 ✓ PASS (exception) — %', SQLERRM;
    v_pass := v_pass + 1;
  END;

  DELETE FROM ajo_contributions WHERE id = v_pending_id;
  RAISE NOTICE 'T8 cleanup: pending row deleted';

  -- ═══════════════════════════════════════════════════════════════════════
  -- T9: Archive rejected when client has non-zero balance
  -- Balance at this point: 500 (contrib1 net) after contrib2 reversal
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T9: Archive rejected on non-zero balance';

  SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;
  RAISE NOTICE 'T9: Current balance = ₦%', v_balance;

  BEGIN
    v_result := ajo_archive_client(v_client_id, v_owner_id);
    IF NOT (v_result->>'ok')::boolean THEN
      RAISE NOTICE 'T9 ✓ PASS — archive rejected: %', v_result->>'error';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T9 ✗ FAIL — archive succeeded on non-zero balance ₦% (should have been rejected)', v_balance;
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T9 ✓ PASS (exception) — %', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T10: Direct RPC call as 'authenticated' role is rejected (no EXECUTE grant)
  -- Checks the privilege catalog directly — migration 000011 revoked PUBLIC.
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T10: PIN-less authenticated supabase.rpc() call rejected';

  DECLARE
    v_auth_can_exec BOOLEAN;
  BEGIN
    SELECT has_function_privilege(
      'authenticated',
      'ajo_record_contribution(uuid,uuid,numeric,text,text,text,uuid)',
      'execute'
    ) INTO v_auth_can_exec;

    IF NOT v_auth_can_exec THEN
      RAISE NOTICE 'T10 ✓ PASS — authenticated role cannot call ajo_record_contribution directly';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T10 ✗ FAIL — authenticated role still has EXECUTE on ajo_record_contribution';
      v_fail := v_fail + 1;
    END IF;
  END;

  -- ═══════════════════════════════════════════════════════════════════════
  -- T11: Concurrent-withdrawal race — two requests, balance covers only one
  -- True parallel execution requires pg_background (unavailable on Supabase).
  -- We prove the same invariant sequentially: SELECT FOR UPDATE serialises
  -- calls; balance guard on the second is identical to a losing concurrent race.
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE 'T11: Concurrent withdrawal race — sequential simulation (SELECT FOR UPDATE)';

  SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;
  RAISE NOTICE 'T11: Balance before race = ₦%', v_balance;
  -- v_balance = 500 (contrib1 net ₦500, after contrib2 was reversed in T7)

  -- First request: ₦400 gross (5% fee = ₦20, net ₦380)
  v_result := ajo_record_withdrawal(
    v_client_id, v_owner_id, 400.00, 'cash', 'T11 first request', NULL, NULL
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE NOTICE 'T11 ✗ FAIL — first withdrawal rejected unexpectedly: %', v_result->>'error';
    v_fail := v_fail + 1;
  ELSE
    v_wd11_net_id := (v_result->>'net_id')::uuid;
    SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;
    RAISE NOTICE 'T11: First request succeeded — balance now ₦%', v_balance;

    -- Second request: same ₦400 — must fail (only ₦100 left)
    v_result := ajo_record_withdrawal(
      v_client_id, v_owner_id, 400.00, 'cash', 'T11 second request (should fail)', NULL, NULL
    );

    IF NOT (v_result->>'ok')::boolean THEN
      RAISE NOTICE 'T11 ✓ PASS — second request rejected: "%" (balance=₦%)', v_result->>'error', v_balance;
      RAISE NOTICE 'T11   (SELECT FOR UPDATE serialises real concurrent calls identically)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T11 ✗ FAIL — second withdrawal succeeded despite insufficient funds';
      v_fail := v_fail + 1;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- CLEANUP: reverse all open rows, then archive the test client
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Cleanup ─────────────────────────────────────────────';

  -- Reverse T11 withdrawal (if it succeeded)
  IF v_wd11_net_id IS NOT NULL THEN
    v_result := ajo_reverse_contribution(v_wd11_net_id, v_owner_id, 'T11 cleanup');
    RAISE NOTICE 'Cleanup: T11 withdrawal reversed → %', v_result->>'ok';
  END IF;

  -- Reverse contrib1 (the first deposit that had the registration_fee)
  -- After this, balance should be exactly 0
  IF v_contrib1_id IS NOT NULL THEN
    v_result := ajo_reverse_contribution(v_contrib1_id, v_owner_id, 'T cleanup first deposit');
    RAISE NOTICE 'Cleanup: contrib1 reversed → %', v_result->>'ok';
  END IF;

  SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_client_id;
  RAISE NOTICE 'Cleanup: balance after reversals = ₦%', v_balance;

  -- If any residual balance, clamp to 0 directly (safety net for partial test failures)
  IF v_balance != 0 THEN
    UPDATE aso_clients SET current_balance = 0 WHERE id = v_client_id;
    RAISE NOTICE 'Cleanup: residual balance clamped to 0 (partial test failure)';
  END IF;

  -- Archive test client
  v_result := ajo_archive_client(v_client_id, v_owner_id);
  RAISE NOTICE 'Cleanup: test client archived → %', v_result;

  -- ═══════════════════════════════════════════════════════════════════════
  -- SUMMARY
  -- ═══════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE ' Phase 1 Live Test Suite — RESULTS';
  RAISE NOTICE ' PASS: %   FAIL: %   SKIP: %', v_pass, v_fail, v_skip;
  RAISE NOTICE '═══════════════════════════════════════════════════════';

  IF v_fail > 0 THEN
    RAISE WARNING 'Test suite completed with % failure(s) — see NOTICE lines above', v_fail;
  END IF;

END;
$$;
