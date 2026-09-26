-- In-app account deletion (Google Play requires it) — the database side.
--
-- POLICY (decided with the owner): "block until zero". A deletion is REFUSED while the person still has money or something pending
-- (wallet balance, a transfer / bill in flight, savings, an active card / group / loan, Ajo clients, staff, a cooperative).
-- Once clear, their personal details are ERASED or anonymised, their login is disabled (email freed, sessions gone), and only
-- de-identified financial records are kept — the wallet ledger, transfers, transaction amounts and KYC evidence — because
-- financial regulation requires them (this is disclosed in the privacy policy and the Play Data-safety form).
--
-- The auth user is NOT deleted: 43 tables reference it ON DELETE CASCADE (wallets, transactions, credits …), so deleting it would wipe
-- exactly the records that must be kept. It is banned and tombstoned instead.
--
--   account_deletion_check(uid) → { kinds, blockers[], can_delete }        (the app shows the blockers)
--   account_erase(uid)          → { ok, kinds, files[] }                    (refuses if any blocker remains; ALL-or-nothing)
--
-- Both are service-role only (called from the account-delete edge function, which authenticates the caller and checks their PIN).
-- At the bottom, a SELF-TEST builds a fake user against THIS database's real tables, exercises both functions, and rolls back — so a wrong
-- column or a NOT NULL surprise fails the deploy here instead of failing for a real customer later.

-- ── 0. small additions ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  phone       text,
  full_name   text,
  note        text,
  source      text NOT NULL DEFAULT 'web',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'verifying', 'done', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz,
  handled_by  text
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;      -- no policies: only the service role / postgres can touch it
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_hash  text NOT NULL,                 -- sha256 of the user id: proves a deletion happened without keeping who
  kinds      text[] NOT NULL DEFAULT '{}',
  erased_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_log FROM PUBLIC, anon, authenticated;

-- ── 1. what stops a deletion, and what kind of account this is ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_deletion_check(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  kinds      text[] := '{}';
  blockers   jsonb  := '[]'::jsonb;
  v_client_ids uuid[];
  v_member_ids uuid[];
  n          bigint;
  amt        numeric;
  money      text;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('already_deleted', true, 'kinds', '[]'::jsonb, 'blockers', '[]'::jsonb, 'can_delete', true);
  END IF;

  -- what this person is ------------------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.aso_clients WHERE client_user_id = p_user_id) THEN kinds := array_append(kinds, 'ajo_client'); END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = p_user_id)        THEN kinds := array_append(kinds, 'coop_member'); END IF;
  IF EXISTS (SELECT 1 FROM public.staff WHERE user_id = p_user_id)              THEN kinds := array_append(kinds, 'staff'); END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.customers WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.credits WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.aso_clients WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.staff WHERE owner_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.organizations WHERE owner_id = p_user_id)  THEN kinds := array_append(kinds, 'owner'); END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_client_ids FROM public.aso_clients WHERE client_user_id = p_user_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_member_ids FROM public.org_members WHERE user_id = p_user_id;

  -- 1. the wallet ------------------------------------------------------------------------------------------
  SELECT COALESCE(sum(balance_kobo), 0) INTO amt FROM public.wallets WHERE user_id = p_user_id;
  IF amt > 0 THEN
    money := to_char(amt / 100.0, 'FM999,999,999,990.00');
    blockers := blockers || jsonb_build_object('code', 'wallet_balance', 'title', 'Your wallet still has ₦' || money,
      'hint', 'Transfer it to your bank account first, then come back.');
  END IF;
  SELECT count(*) INTO n FROM public.wallet_withdrawals WHERE user_id = p_user_id AND status IN ('pending', 'processing');
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'wallet_transfer_pending', 'title', 'A transfer is still being processed',
      'hint', 'Wait until it completes or is returned to your wallet.'); END IF;
  SELECT count(*) INTO n FROM public.pending_bills WHERE user_id = p_user_id AND status IN ('pending', 'processing');
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'bill_pending', 'title', 'A bill payment is still being processed',
      'hint', 'Wait until it is delivered or refunded.'); END IF;

  -- 2. a business owner ------------------------------------------------------------------------------------
  SELECT count(*) INTO n FROM public.staff WHERE owner_id = p_user_id AND COALESCE(status, '') NOT IN ('removed', 'deleted', 'archived');
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'staff_active', 'title', 'You still have ' || n || ' staff account' || CASE WHEN n = 1 THEN '' ELSE 's' END,
      'hint', 'Remove your staff and managers first — they would lose access.'); END IF;
  SELECT count(*) INTO n FROM public.aso_clients WHERE user_id = p_user_id AND archived_at IS NULL;
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'ajo_clients_open', 'title', 'You still have ' || n || ' active Ajo / savings client' || CASE WHEN n = 1 THEN '' ELSE 's' END,
      'hint', 'Settle and archive them first, so nobody is left with savings held by a closed account.'); END IF;
  SELECT COALESCE(sum(current_balance), 0) INTO amt FROM public.aso_clients WHERE user_id = p_user_id;
  IF amt > 0 THEN
    money := to_char(amt, 'FM999,999,999,990.00');
    blockers := blockers || jsonb_build_object('code', 'ajo_clients_balance', 'title', 'Your Ajo clients still hold ₦' || money || ' in savings',
      'hint', 'Pay it out to them first.');
  END IF;
  SELECT count(*) INTO n FROM public.organizations WHERE owner_id = p_user_id AND archived_at IS NULL AND status <> 'archived';
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'coop_owned', 'title', 'You still run a cooperative / group account',
      'hint', 'Archive it first.'); END IF;

  -- 3. an Ajo / savings client -----------------------------------------------------------------------------
  IF cardinality(v_client_ids) > 0 THEN
    SELECT COALESCE(sum(current_balance), 0) INTO amt FROM public.aso_clients WHERE id = ANY (v_client_ids);
    IF amt > 0 THEN
      money := to_char(amt, 'FM999,999,999,990.00');
      blockers := blockers || jsonb_build_object('code', 'ajo_savings', 'title', 'You still have ₦' || money || ' in savings',
        'hint', 'Withdraw your savings first.');
    END IF;
    SELECT count(*) INTO n FROM public.ajo_withdrawal_requests WHERE aso_client_id = ANY (v_client_ids) AND status = 'pending';
    IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'ajo_withdrawal_pending', 'title', 'A withdrawal request is waiting for approval',
        'hint', 'Wait for it to be approved or rejected.'); END IF;
    SELECT count(*) INTO n FROM public.ajo_cycles WHERE client_id = ANY (v_client_ids) AND status = 'active';
    IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'ajo_cycle_active', 'title', 'You still have an active savings card',
        'hint', 'Finish it, or ask your agent to close it.'); END IF;
    SELECT count(*) INTO n FROM public.aso_client_group_memberships WHERE client_id = ANY (v_client_ids) AND status = 'active';
    IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'ajo_group_active', 'title', 'You are still in an Esusu / savings group',
        'hint', 'Leave the group first, once your turn is settled.'); END IF;
  END IF;
  SELECT count(*) INTO n FROM public.peer_esusu_members m JOIN public.peer_esusu_groups g ON g.id = m.group_id
   WHERE m.user_id = p_user_id AND m.status = 'active' AND g.status IN ('forming', 'active');
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'esusu_member', 'title', 'You are in a circle that has not finished',
      'hint', 'Leave it or wait until it completes.'); END IF;
  SELECT count(*) INTO n FROM public.peer_esusu_groups WHERE creator_user_id = p_user_id AND status IN ('forming', 'active');
  IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'esusu_creator', 'title', 'A circle you started has not finished',
      'hint', 'Close it or wait until it completes.'); END IF;

  -- 4. a cooperative member --------------------------------------------------------------------------------
  IF cardinality(v_member_ids) > 0 THEN
    SELECT COALESCE(sum(savings_balance), 0) INTO amt FROM public.org_members WHERE id = ANY (v_member_ids);
    IF amt > 0 THEN
      money := to_char(amt, 'FM999,999,999,990.00');
      blockers := blockers || jsonb_build_object('code', 'coop_savings', 'title', 'You still have ₦' || money || ' in your cooperative savings',
        'hint', 'Withdraw it first.');
    END IF;
    SELECT count(*) INTO n FROM public.org_loans WHERE member_id = ANY (v_member_ids) AND status IN ('approved', 'disbursed', 'defaulted') AND COALESCE(outstanding_balance, 0) > 0;
    IF n > 0 THEN blockers := blockers || jsonb_build_object('code', 'coop_loan', 'title', 'You still owe on a cooperative loan',
        'hint', 'Repay it first.'); END IF;
  END IF;

  RETURN jsonb_build_object('already_deleted', false, 'kinds', to_jsonb(kinds), 'blockers', blockers, 'can_delete', jsonb_array_length(blockers) = 0);
END;
$$;

-- ── 2. the erasure ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_erase(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_check      jsonb;
  v_kinds      text[];
  v_urls       text[] := '{}';
  v_client_ids uuid[];
  v_member_ids uuid[];
  v_email      text;
  v_tomb       text;
  v_now        timestamptz := now();
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user required'; END IF;

  -- Serialise with any deposit: wallet_credit / wallet_debit lock this row too. Check AFTER the lock so a deposit that landed first is seen.
  PERFORM 1 FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  v_check := public.account_deletion_check(p_user_id);
  IF (v_check ->> 'already_deleted')::boolean THEN
    RETURN jsonb_build_object('ok', true, 'already_deleted', true, 'kinds', '[]'::jsonb, 'files', '[]'::jsonb);
  END IF;
  IF jsonb_array_length(v_check -> 'blockers') > 0 THEN
    RAISE EXCEPTION 'account_erase: blockers remain' USING ERRCODE = 'P0001', DETAIL = (v_check -> 'blockers')::text;
  END IF;
  SELECT COALESCE(array_agg(k), '{}') INTO v_kinds FROM jsonb_array_elements_text(v_check -> 'kinds') AS k;

  SELECT COALESCE(array_agg(id), '{}') INTO v_client_ids FROM public.aso_clients WHERE client_user_id = p_user_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_member_ids FROM public.org_members WHERE user_id = p_user_id;
  SELECT email INTO v_email FROM public.profiles WHERE id = p_user_id;
  v_tomb := 'deleted+' || p_user_id::text || '@deleted.invalid';

  -- files to remove from storage (collected BEFORE the URLs are erased); the edge function deletes them
  SELECT v_urls || array_remove(ARRAY[profile_image_url, store_image_url, reg_doc_url], NULL) INTO v_urls FROM public.profiles WHERE id = p_user_id;
  SELECT v_urls || COALESCE(array_agg(u), '{}') INTO v_urls FROM (
      SELECT profile_image_url AS u FROM public.aso_clients WHERE id = ANY (v_client_ids)
      UNION ALL SELECT profile_image_url FROM public.org_members WHERE id = ANY (v_member_ids)
      UNION ALL SELECT avatar_url FROM public.org_members WHERE id = ANY (v_member_ids)
      UNION ALL SELECT profile_image_url FROM public.staff WHERE user_id = p_user_id
      UNION ALL SELECT proof_url FROM public.ajo_contributions WHERE aso_client_id = ANY (v_client_ids)
    ) f WHERE u IS NOT NULL;

  -- ── the wallet: closed, its label erased; the ledger and transfers stay (de-identified by the profile being erased) ──
  UPDATE public.wallet_scheduled_transfers SET status = 'cancelled' WHERE owner_id = p_user_id AND status IN ('active', 'running', 'paused');
  BEGIN
    DELETE FROM public.wallet_scheduled_transfers WHERE owner_id = p_user_id;
  EXCEPTION WHEN foreign_key_violation THEN          -- something still points at a schedule: keep it (cancelled) but scrub who it paid
    UPDATE public.wallet_scheduled_transfers SET account_name = 'Deleted', account_number = '0000000000' WHERE owner_id = p_user_id;
  END;
  UPDATE public.wallet_payment_requests SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END, customer_name = '', note = '' WHERE user_id = p_user_id;
  UPDATE public.wallets SET status = 'closed', flw_account_name = 'Closed account' WHERE user_id = p_user_id;

  -- ── the person's own record(s) ──
  UPDATE public.profiles SET
      full_name = 'Deleted user', business_name = 'Deleted business', phone = NULL, email = NULL, address = NULL, state = NULL, lga = NULL, ward = NULL,
      profile_image_url = NULL, store_image_url = NULL, gender = NULL, date_of_birth = NULL, nin = NULL, business_address = NULL, business_phone = NULL,
      business_email = NULL, business_registration_number = NULL, reg_doc_url = NULL, bank_name = NULL, bank_account_number = NULL, bank_account_name = NULL,
      settlement_bank_code = NULL, settlement_account_number = NULL, settlement_account_name = NULL, settlement_bank_name = NULL,
      app_pin_hash = NULL, txn_pin_hash = NULL, pin_reset_token = NULL, pin_reset_token_expires_at = NULL,
      verified_name = NULL, bvn_hash = NULL, bvn_verification_reference = NULL, verification_rejected_reason = NULL,
      deleted_at = v_now
    WHERE id = p_user_id;

  UPDATE public.staff SET
      full_name = 'Deleted staff', email = v_tomb, phone = NULL, profile_image_url = NULL, otp_code = NULL, otp_expires_at = NULL, address = NULL,
      nok_name = NULL, nok_phone = NULL, nok_relationship = NULL, email_change_pending = NULL, email_change_otp = NULL, email_change_otp_expires_at = NULL,
      bvn_hash = NULL, bvn_verification_reference = NULL, bvn_verified_name = NULL, status = 'removed', user_id = NULL
    WHERE user_id = p_user_id;

  UPDATE public.aso_clients SET
      full_name = 'Deleted client', phone = NULL, address = NULL, state = NULL, lga = NULL, ward = NULL, notes = NULL, email = NULL, profile_image_url = NULL, nin = NULL,
      next_of_kin = NULL, next_of_kin_phone = NULL, next_of_kin_email = NULL, next_of_kin_address = NULL, next_of_kin_name = NULL,
      portal_pin = NULL, portal_pin_hash = NULL, otp_code = NULL, otp_expires_at = NULL, pending_otp = NULL, pending_otp_expires_at = NULL,
      account_number = NULL, account_name = NULL, bank_name = NULL, bank_code = NULL,
      withdrawal_account_number = NULL, withdrawal_bank_name = NULL, withdrawal_bank_code = NULL, withdrawal_account_name = NULL,
      bvn_hash = NULL, bvn_verification_reference = NULL, bvn_verified_name = NULL,
      portal_active = false, archived_at = COALESCE(archived_at, v_now), client_user_id = NULL
    WHERE id = ANY (v_client_ids);
  UPDATE public.ajo_contributions SET payer_name = NULL, notes = NULL, claim_notes = NULL, proof_url = NULL WHERE aso_client_id = ANY (v_client_ids);

  UPDATE public.org_members SET
      full_name = 'Deleted member', email = NULL, phone = NULL, profile_image_url = NULL, avatar_url = NULL, address = NULL, occupation = NULL, date_of_birth = NULL, gender = NULL,
      next_of_kin = NULL, next_of_kin_phone = NULL, portal_pin = NULL, portal_pin_hash = NULL, portal_token = NULL, otp_code = NULL, otp_expires_at = NULL,
      member_session_token = NULL, member_session_expires_at = NULL, pin_reset_otp_hash = NULL, pin_reset_otp_exp = NULL,
      withdrawal_bank_code = NULL, withdrawal_bank_name = NULL, withdrawal_account_number = NULL, withdrawal_account_name = NULL,
      portal_active = false, status = 'removed', removed_at = COALESCE(removed_at, v_now), user_id = NULL
    WHERE id = ANY (v_member_ids);

  -- ── a business owner's books: the people in them are erased, the money stays ──
  UPDATE public.customers        SET name = 'Deleted customer', phone = NULL, email = NULL, address = NULL WHERE user_id = p_user_id;
  UPDATE public.credits          SET customer_name = 'Deleted customer', phone = NULL, address = NULL, notes = NULL, email = NULL, profile_image_url = NULL, nin = NULL,
                                     next_of_kin = NULL, next_of_kin_phone = NULL, next_of_kin_email = NULL, next_of_kin_address = NULL WHERE user_id = p_user_id;
  UPDATE public.customer_loyalty SET customer_name = 'Deleted customer', phone = NULL, email = NULL, notes = NULL WHERE user_id = p_user_id;
  UPDATE public.invoices         SET customer_name = 'Deleted customer', customer_phone = NULL, customer_email = NULL, notes = NULL WHERE user_id = p_user_id;
  UPDATE public.transactions     SET customer_name = NULL, note = NULL WHERE user_id = p_user_id;
  UPDATE public.branches         SET name = 'Deleted branch', address = NULL, phone = NULL WHERE owner_id = p_user_id;
  UPDATE public.audit_logs       SET staff_name = '' WHERE owner_id = p_user_id;
  UPDATE public.loan_applications SET full_name = 'Deleted', business_name = NULL, phone = NULL WHERE user_id = p_user_id;
  UPDATE public.support_tickets  SET user_email = 'deleted@deleted.invalid', user_name = 'Deleted user' WHERE user_id = p_user_id;
  UPDATE public.subscriptions    SET cancel_at_period_end = true, cancelled_at = COALESCE(cancelled_at, v_now) WHERE user_id = p_user_id;

  -- ── personal content with no reason to keep ──
  DELETE FROM public.invoice_settings         WHERE user_id = p_user_id;
  DELETE FROM public.bill_beneficiaries       WHERE owner_id = p_user_id;
  DELETE FROM public.notifications            WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.push_tokens              WHERE user_id = p_user_id;
  DELETE FROM public.profile_audit_log        WHERE user_id = p_user_id;
  DELETE FROM public.faq_feedback             WHERE user_id = p_user_id;
  DELETE FROM public.platform_sessions        WHERE user_id = p_user_id;
  DELETE FROM public.email_relay_usage        WHERE user_id = p_user_id;
  DELETE FROM public.email_send_claims        WHERE user_id = p_user_id;
  DELETE FROM public.welcome_email_queue      WHERE user_id = p_user_id;
  DELETE FROM public.email_automation_queue   WHERE user_id = p_user_id;
  UPDATE public.user_consents SET ip_address = NULL WHERE user_id = p_user_id;           -- the record that they consented stays; where from does not

  -- ── the login: no more sign-in, the email is freed, sessions are gone (auth.users is kept — see the header) ──
  DELETE FROM auth.identities      WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens  WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions        WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = p_user_id;
  UPDATE auth.users SET email = v_tomb, phone = NULL, raw_user_meta_data = '{"deleted": true}'::jsonb,
                        banned_until = v_now + interval '100 years', deleted_at = v_now, updated_at = v_now
    WHERE id = p_user_id;

  INSERT INTO public.account_deletion_log (user_hash, kinds) VALUES (encode(sha256(convert_to(p_user_id::text, 'UTF8')), 'hex'), v_kinds);

  RETURN jsonb_build_object('ok', true, 'already_deleted', false, 'kinds', to_jsonb(v_kinds), 'files', to_jsonb(v_urls));
END;
$$;

-- service role only (the edge function authenticates the caller and checks their PIN before calling these)
REVOKE ALL ON FUNCTION public.account_deletion_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_erase(uuid)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_check(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_erase(uuid)          TO service_role;

-- ── 3. SELF-TEST against this database's real schema (rolled back; a failure aborts the migration) ────────────
-- Fills every NOT NULL column that has no default with a dummy of the right type, so a fixture never fails on a column it does not care about.
CREATE OR REPLACE FUNCTION pg_temp.ad_insert(p_table text, p_vals jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; cols text[] := '{}'; vals text[] := '{}'; v text;
BEGIN
  FOR r IN SELECT column_name, data_type, is_nullable, column_default, is_generated, is_identity FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = p_table ORDER BY ordinal_position
  LOOP
    IF p_vals ? r.column_name THEN
      cols := cols || quote_ident(r.column_name);
      vals := vals || (CASE WHEN jsonb_typeof(p_vals -> r.column_name) = 'null' THEN 'NULL' ELSE quote_literal(p_vals ->> r.column_name) END);
    ELSIF r.is_nullable = 'NO' AND r.column_default IS NULL AND r.is_generated = 'NEVER' AND r.is_identity = 'NO' THEN
      v := CASE
             WHEN r.data_type IN ('text', 'character varying', 'character') THEN quote_literal('x')
             WHEN r.data_type = 'uuid' THEN quote_literal(gen_random_uuid()::text)
             WHEN r.data_type IN ('integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real') THEN '0'
             WHEN r.data_type = 'boolean' THEN 'false'
             WHEN r.data_type LIKE 'timestamp%' THEN 'now()'
             WHEN r.data_type = 'date' THEN 'current_date'
             WHEN r.data_type IN ('jsonb', 'json') THEN quote_literal('{}')
             WHEN r.data_type = 'ARRAY' THEN quote_literal('{}')
             ELSE 'NULL' END;
      cols := cols || quote_ident(r.column_name); vals := vals || v;
    END IF;
  END LOOP;
  EXECUTE format('INSERT INTO public.%I (%s) VALUES (%s)', p_table, array_to_string(cols, ', '), array_to_string(vals, ', '));
END $$;

DO $$
DECLARE
  u_owner  uuid := gen_random_uuid();
  u_client uuid := gen_random_uuid();
  ca_id    uuid := gen_random_uuid();
  res      jsonb;
  chk      jsonb;
  v_name   text;
  v_banned timestamptz;
  v_email  text;
BEGIN
  BEGIN
    -- two fake logins, their profiles, the owner's client record (linked to the second login), a wallet with money, a customer and a credit
    INSERT INTO auth.users (id, aud, role, email) VALUES (u_owner, 'authenticated', 'authenticated', 'selftest-owner@example.invalid'),
                                                          (u_client, 'authenticated', 'authenticated', 'selftest-client@example.invalid');
    PERFORM pg_temp.ad_insert('profiles', jsonb_build_object('id', u_owner, 'full_name', 'Real Owner', 'business_name', 'Real Biz', 'phone', '0800', 'email', 'selftest-owner@example.invalid', 'nin', '123'));
    PERFORM pg_temp.ad_insert('profiles', jsonb_build_object('id', u_client, 'full_name', 'Real Client', 'phone', '0801', 'email', 'selftest-client@example.invalid'));
    PERFORM pg_temp.ad_insert('aso_clients', jsonb_build_object('id', ca_id, 'user_id', u_owner, 'client_user_id', u_client, 'full_name', 'Real Client', 'phone', '0801', 'current_balance', 0));
    PERFORM pg_temp.ad_insert('wallets', jsonb_build_object('user_id', u_client, 'balance_kobo', 5000));
    PERFORM pg_temp.ad_insert('customers', jsonb_build_object('user_id', u_owner, 'name', 'Real Customer', 'phone', '0802'));
    PERFORM pg_temp.ad_insert('credits', jsonb_build_object('user_id', u_owner, 'customer_name', 'Real Debtor', 'phone', '0803'));
    PERFORM pg_temp.ad_insert('push_tokens', jsonb_build_object('user_id', u_client, 'token', 'tok-selftest', 'platform', 'android'));

    -- money in the wallet → refused, with a reason the app can show
    chk := public.account_deletion_check(u_client);
    IF (chk ->> 'can_delete')::boolean OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(chk -> 'blockers') b WHERE b ->> 'code' = 'wallet_balance') THEN
      RAISE EXCEPTION 'selftest: a wallet balance must block deletion (%)', chk;
    END IF;
    BEGIN
      PERFORM public.account_erase(u_client);
      RAISE EXCEPTION 'selftest: account_erase ran despite a wallet balance';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE 'account_erase: blockers remain%' THEN RAISE; END IF;
    END;
    -- the owner still has an active client → refused
    chk := public.account_deletion_check(u_owner);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(chk -> 'blockers') b WHERE b ->> 'code' = 'ajo_clients_open') THEN
      RAISE EXCEPTION 'selftest: an active Ajo client must block the owner (%)', chk;
    END IF;

    -- zero the wallet → the client can be erased
    UPDATE public.wallets SET balance_kobo = 0 WHERE user_id = u_client;
    res := public.account_erase(u_client);
    IF NOT (res ->> 'ok')::boolean THEN RAISE EXCEPTION 'selftest: erase failed (%)', res; END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = u_client;
    IF v_name IS DISTINCT FROM 'Deleted user' THEN RAISE EXCEPTION 'selftest: profile not erased (%)', v_name; END IF;
    SELECT full_name INTO v_name FROM public.aso_clients WHERE id = ca_id;
    IF v_name IS DISTINCT FROM 'Deleted client' THEN RAISE EXCEPTION 'selftest: client record not anonymised (%)', v_name; END IF;
    IF EXISTS (SELECT 1 FROM public.push_tokens WHERE user_id = u_client) THEN RAISE EXCEPTION 'selftest: push token not removed'; END IF;
    SELECT email, banned_until INTO v_email, v_banned FROM auth.users WHERE id = u_client;
    IF v_email IS NULL OR v_email NOT LIKE 'deleted+%@deleted.invalid' OR v_banned IS NULL OR v_banned <= now() + interval '50 years' THEN RAISE EXCEPTION 'selftest: login not disabled (% / %)', v_email, v_banned; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = u_client AND status = 'closed') THEN RAISE EXCEPTION 'selftest: wallet not closed'; END IF;
    IF NOT (public.account_deletion_check(u_client) ->> 'already_deleted')::boolean THEN RAISE EXCEPTION 'selftest: a second check must say already_deleted'; END IF;

    -- the owner: archive the client, then erase; their customer and debtor are erased, nothing errors
    UPDATE public.aso_clients SET archived_at = now() WHERE id = ca_id;
    res := public.account_erase(u_owner);
    IF NOT (res ->> 'ok')::boolean THEN RAISE EXCEPTION 'selftest: owner erase failed (%)', res; END IF;
    SELECT name INTO v_name FROM public.customers WHERE user_id = u_owner;
    IF v_name IS DISTINCT FROM 'Deleted customer' THEN RAISE EXCEPTION 'selftest: customer not anonymised (%)', v_name; END IF;
    SELECT customer_name INTO v_name FROM public.credits WHERE user_id = u_owner;
    IF v_name IS DISTINCT FROM 'Deleted customer' THEN RAISE EXCEPTION 'selftest: credit not anonymised (%)', v_name; END IF;
    IF (SELECT count(*) FROM public.account_deletion_log) < 2 THEN RAISE EXCEPTION 'selftest: deletions were not logged'; END IF;

    RAISE EXCEPTION 'ACCOUNT_DELETION_SELFTEST_OK';          -- roll everything back
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ACCOUNT_DELETION_SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'account deletion self-test passed against the real schema (rolled back)';
END $$;
