-- ═════════════════════════════════════════════════════════════════════════════
-- Client statements (2026-10-03): savings + wallet statements for Ajo/savings clients, in the app and every month.
--
-- One source of truth for the numbers — the app's Statements screen, the PDF and the monthly email all read these:
--   client_savings_statement(client, from, to)  the client's savings entries in the period with a running balance
--   client_wallet_statement(user, from, to)     the client's wallet entries (stored balance after each)
--   client_statement_data(client, month)        both, for one WAT calendar month
--
-- Savings running balance: older savings rows have no stored balance (balance_after only exists since 2026-09), so the
-- balance is rebuilt from the client's completed entries — each entry type moves aso_clients.current_balance one way
-- (ajo_entry_sign, mirroring the RPCs that write them) — and anchored to the real current_balance: any difference
-- (money that predates the records) is carried as a balance brought forward before the first entry, so every closing
-- balance matches what the client actually has.
--
-- Monthly: pg_cron (days 1–3, every 10 min, 07:00–21:50 WAT) → client_statements_trigger() → pg_net → edge function
-- `client-statements` (cron-secret auth): for each client due, builds the previous month's statement, sends an in-app
-- notification + push and an email with the PDF attached, and records it in client_statements so nobody gets it twice.
-- Switches (platform_config): client_statements_enabled, client_statements_first_month (first month to send).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Which way an entry moves the client's savings balance ───────────────────
CREATE OR REPLACE FUNCTION public.ajo_entry_sign(p_type text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_type IN ('contribution', 'esusu_payout', 'payout') THEN 1
    WHEN p_type IN ('withdrawal', 'withdrawal_fee', 'registration_fee', 'commission', 'esusu_pot_sweep', 'disbursement') THEN -1
    WHEN left(p_type, 9) = 'reversal_' THEN
      CASE WHEN substr(p_type, 10) IN ('contribution', 'esusu_payout', 'payout') THEN -1
           WHEN substr(p_type, 10) IN ('withdrawal', 'withdrawal_fee', 'registration_fee', 'commission', 'esusu_pot_sweep', 'disbursement') THEN 1
           ELSE 0 END
    ELSE 0   -- group_release and other bookkeeping rows move no money
  END
$function$;

-- Same words as the app's history (src/utils/helpers.js LEDGER_LABELS), plus where the money sat.
CREATE OR REPLACE FUNCTION public.ajo_entry_label(p_type text, p_context text, p_group text, p_cycle uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT (CASE p_type
            WHEN 'contribution'     THEN 'Contribution'
            WHEN 'withdrawal'       THEN 'Withdrawal'
            WHEN 'withdrawal_fee'   THEN 'Withdrawal Fee'
            WHEN 'registration_fee' THEN 'Registration Fee'
            WHEN 'commission'       THEN CASE WHEN p_cycle IS NOT NULL THEN 'Cycle Commission Fee — Day 1' ELSE 'Collector Commission' END
            WHEN 'esusu_payout'     THEN 'Esusu Payout'
            WHEN 'payout'           THEN 'Payout'
            WHEN 'esusu_pot_sweep'  THEN 'Esusu Pot Sweep'
            WHEN 'disbursement'     THEN 'Group Payout'
            ELSE CASE WHEN left(p_type, 9) = 'reversal_'
                      THEN 'Reversal · ' || initcap(replace(substr(p_type, 10), '_', ' '))
                      ELSE initcap(replace(COALESCE(p_type, 'entry'), '_', ' ')) END
          END)
       || CASE p_context
            WHEN 'esusu_rotation' THEN ' · Esusu' || COALESCE(': ' || NULLIF(btrim(p_group), ''), '')
            WHEN 'group_savings'  THEN ' · Group savings' || COALESCE(': ' || NULLIF(btrim(p_group), ''), '')
            ELSE '' END
$function$;

-- ── 2. Savings statement ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_savings_statement(p_client_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c        record;
  v_biz      jsonb;
  v_total    numeric;
  v_before   numeric;
  v_forward  numeric;
  v_entries  jsonb;
  v_in       numeric;
  v_out      numeric;
BEGIN
  SELECT c.id, c.full_name, c.membership_number, c.phone, c.current_balance, c.user_id, c.client_user_id
    INTO v_c FROM public.aso_clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT to_jsonb(p) INTO v_biz FROM public.profiles p WHERE p.id = v_c.user_id;

  WITH e AS (
    SELECT a.id, a.created_at, a.amount::numeric AS amount, public.ajo_entry_sign(a.type) AS sgn
      FROM public.ajo_contributions a
     WHERE a.aso_client_id = p_client_id AND a.status = 'completed' AND public.ajo_entry_sign(a.type) <> 0
  )
  SELECT COALESCE(SUM(sgn * amount), 0),
         COALESCE(SUM(sgn * amount) FILTER (WHERE created_at < p_from), 0)
    INTO v_total, v_before
    FROM e;

  v_forward := COALESCE(v_c.current_balance, 0) - v_total;

  WITH e AS (
    SELECT a.id, a.created_at, a.type, a.amount::numeric AS amount, a.receipt_ref, a.contribution_context, a.cycle_id,
           g.name AS group_name, public.ajo_entry_sign(a.type) AS sgn
      FROM public.ajo_contributions a
      LEFT JOIN public.ajo_groups g ON g.id = a.group_id
     WHERE a.aso_client_id = p_client_id AND a.status = 'completed' AND public.ajo_entry_sign(a.type) <> 0
  ), r AS (
    SELECT e.*, SUM(e.sgn * e.amount) OVER (ORDER BY e.created_at, e.id) AS run FROM e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at',      r.created_at,
           'type',    r.type,
           'label',   public.ajo_entry_label(r.type, r.contribution_context, r.group_name, r.cycle_id),
           'ref',     COALESCE(r.receipt_ref, ''),
           'credit',  r.sgn > 0,
           'amount',  r.amount,
           'balance', round(v_forward + r.run, 2)
         ) ORDER BY r.created_at, r.id), '[]'::jsonb),
         COALESCE(SUM(r.amount) FILTER (WHERE r.sgn > 0), 0),
         COALESCE(SUM(r.amount) FILTER (WHERE r.sgn < 0), 0)
    INTO v_entries, v_in, v_out
    FROM r
   WHERE r.created_at >= p_from AND r.created_at < p_to;

  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', v_c.id, 'name', v_c.full_name, 'membership_number', v_c.membership_number,
                                 'phone', v_c.phone, 'current_balance', COALESCE(v_c.current_balance, 0)),
    'business', jsonb_build_object(
       'name',    COALESCE(v_biz->>'business_name', ''),
       'phone',   COALESCE(NULLIF(v_biz->>'business_phone', ''), v_biz->>'phone', ''),
       'address', COALESCE(NULLIF(v_biz->>'business_address', ''), v_biz->>'address', '')),
    'from', p_from, 'to', p_to,
    'opening', round(v_forward + v_before, 2),
    'total_in', round(v_in, 2),
    'total_out', round(v_out, 2),
    'closing', round(v_forward + v_before + v_in - v_out, 2),
    'brought_forward', round(v_forward, 2),
    'entries', v_entries
  );
END;
$function$;

-- ── 3. Wallet statement (balances are stored on every wallet entry) ────────────
CREATE OR REPLACE FUNCTION public.client_wallet_statement(p_user_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_w        record;
  v_open     bigint;
  v_entries  jsonb;
  v_in       bigint;
  v_out      bigint;
  v_close    bigint;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT w.flw_account_number, w.flw_account_bank, w.flw_account_name, w.balance_kobo, w.created_at
    INTO v_w FROM public.wallets w WHERE w.user_id = p_user_id ORDER BY w.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT l.balance_after_kobo INTO v_open
    FROM public.wallet_ledger l
   WHERE l.user_id = p_user_id AND l.created_at < p_from AND l.balance_after_kobo IS NOT NULL
   ORDER BY l.created_at DESC, l.id DESC LIMIT 1;
  v_open := COALESCE(v_open, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at',                 l.created_at,
           'source',             l.source,
           'narration',          COALESCE(l.narration, ''),
           'status',             COALESCE(l.status, ''),
           'ref',                COALESCE(l.receipt_ref, ''),
           'credit',             l.direction = 'credit',
           'amount_kobo',        l.amount_kobo,
           'balance_after_kobo', l.balance_after_kobo
         ) ORDER BY l.created_at, l.id), '[]'::jsonb),
         COALESCE(SUM(l.amount_kobo) FILTER (WHERE l.direction = 'credit'), 0),
         COALESCE(SUM(l.amount_kobo) FILTER (WHERE l.direction = 'debit'), 0)
    INTO v_entries, v_in, v_out
    FROM public.wallet_ledger l
   WHERE l.user_id = p_user_id AND l.created_at >= p_from AND l.created_at < p_to;

  SELECT l.balance_after_kobo INTO v_close
    FROM public.wallet_ledger l
   WHERE l.user_id = p_user_id AND l.created_at < p_to AND l.balance_after_kobo IS NOT NULL
   ORDER BY l.created_at DESC, l.id DESC LIMIT 1;

  RETURN jsonb_build_object(
    'account', jsonb_build_object('number', COALESCE(v_w.flw_account_number, ''), 'bank', COALESCE(v_w.flw_account_bank, ''),
                                  'name', COALESCE(v_w.flw_account_name, '')),
    'from', p_from, 'to', p_to,
    'opening_kobo', v_open,
    'in_kobo', v_in,
    'out_kobo', v_out,
    'closing_kobo', COALESCE(v_close, v_open),
    'entries', v_entries
  );
END;
$function$;

-- ── 4. One month, both statements (WAT calendar month; Nigeria is UTC+1 all year) ──
CREATE OR REPLACE FUNCTION public.client_statement_data(p_client_id uuid, p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m    date := date_trunc('month', p_month)::date;
  v_t0   timestamptz := (v_m::text || ' 00:00:00+01')::timestamptz;
  v_t1   timestamptz := ((v_m + interval '1 month')::date::text || ' 00:00:00+01')::timestamptz;
  v_user uuid;
BEGIN
  SELECT client_user_id INTO v_user FROM public.aso_clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'month',   to_char(v_m, 'YYYY-MM'),
    'savings', public.client_savings_statement(p_client_id, v_t0, v_t1),
    'wallet',  public.client_wallet_statement(v_user, v_t0, v_t1)
  );
END;
$function$;

-- ── 5. Who got which month's statement ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_statements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  aso_client_id  uuid        NOT NULL REFERENCES public.aso_clients(id) ON DELETE CASCADE,
  client_user_id uuid,
  owner_id       uuid,
  month          date        NOT NULL CHECK (month = date_trunc('month', month)::date),
  status         text        NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  attempts       integer     NOT NULL DEFAULT 1,
  savings        jsonb,      -- headline figures only: opening, in, out, closing, count
  wallet         jsonb,
  notified_at    timestamptz,
  emailed_at     timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aso_client_id, month)
);
ALTER TABLE public.client_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_statements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_statements TO authenticated;
GRANT ALL ON public.client_statements TO service_role;
DROP POLICY IF EXISTS client_statements_read_own ON public.client_statements;
CREATE POLICY client_statements_read_own ON public.client_statements
  FOR SELECT TO authenticated USING (client_user_id = auth.uid() OR owner_id = auth.uid());

INSERT INTO public.platform_config (key, value, description) VALUES
  ('client_statements_enabled', 'true', 'Send Ajo/savings clients their monthly savings + wallet statement (in-app, push and email) on the 1st'),
  ('client_statements_first_month', '2026-10', 'First month (YYYY-MM) a monthly client statement is sent for')
ON CONFLICT (key) DO NOTHING;

-- Clients due a statement for p_month: a login or an email, active (or still holding savings), existed during the month,
-- and either moved money that month or hold a savings/wallet balance. Never twice: sent ones are skipped, failed ones
-- retried up to 3 times.
CREATE OR REPLACE FUNCTION public.client_statement_candidates(p_month date, p_limit integer DEFAULT 5)
 RETURNS TABLE (client_id uuid, client_user_id uuid, client_name text, client_email text, business_name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE((SELECT value FROM public.platform_config WHERE key = 'client_statements_enabled'), 'true') = 'true' AS on_,
           COALESCE((SELECT value FROM public.platform_config WHERE key = 'client_statements_first_month'), '2026-10') AS first_m
  ), b AS (
    SELECT date_trunc('month', p_month)::date AS m,
           (date_trunc('month', p_month)::date::text || ' 00:00:00+01')::timestamptz AS t0,
           ((date_trunc('month', p_month)::date + interval '1 month')::date::text || ' 00:00:00+01')::timestamptz AS t1
  )
  SELECT c.id, c.client_user_id, c.full_name::text, NULLIF(btrim(COALESCE(c.email, '')), '')::text, p.business_name::text
    FROM public.aso_clients c
    CROSS JOIN cfg
    CROSS JOIN b
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE cfg.on_
     AND to_char(b.m, 'YYYY-MM') >= cfg.first_m
     AND (c.client_user_id IS NOT NULL OR btrim(COALESCE(c.email, '')) <> '')
     AND (c.status = 'active' OR COALESCE(c.current_balance, 0) > 0)
     AND COALESCE(c.created_at, b.t0) < b.t1
     AND (
          EXISTS (SELECT 1 FROM public.ajo_contributions a
                   WHERE a.aso_client_id = c.id AND a.status = 'completed' AND a.created_at >= b.t0 AND a.created_at < b.t1)
       OR COALESCE(c.current_balance, 0) > 0
       OR (c.client_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.wallet_ledger l
                   WHERE l.user_id = c.client_user_id AND l.created_at >= b.t0 AND l.created_at < b.t1))
       OR (c.client_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.wallets w
                   WHERE w.user_id = c.client_user_id AND w.balance_kobo > 0))
     )
     AND NOT EXISTS (
          SELECT 1 FROM public.client_statements s
           WHERE s.aso_client_id = c.id AND s.month = b.m
             AND (s.status = 'sent' OR s.attempts >= 3
                  OR (s.status = 'sending' AND s.updated_at > now() - interval '30 minutes'))
     )
   ORDER BY c.id
   LIMIT GREATEST(p_limit, 0)
$function$;

-- Claim one client's month before sending (two overlapping runs can never both send it). Returns nothing when it is
-- already sent, being sent, or out of retries; otherwise what is already done, so a retry never notifies twice.
CREATE OR REPLACE FUNCTION public.client_statement_claim(p_client_id uuid, p_month date)
 RETURNS TABLE (statement_id uuid, notified boolean, emailed boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.client_statements AS s (aso_client_id, client_user_id, owner_id, month, status, attempts, updated_at)
  SELECT c.id, c.client_user_id, c.user_id, date_trunc('month', p_month)::date, 'sending', 1, now()
    FROM public.aso_clients c WHERE c.id = p_client_id
  ON CONFLICT (aso_client_id, month) DO UPDATE
     SET status = 'sending', attempts = s.attempts + 1, updated_at = now()
   WHERE s.attempts < 3
     AND (s.status = 'failed' OR (s.status = 'sending' AND s.updated_at < now() - interval '30 minutes'))
  RETURNING s.id, s.notified_at IS NOT NULL, s.emailed_at IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.client_statement_finish(
  p_id uuid, p_status text, p_savings jsonb, p_wallet jsonb, p_notified boolean, p_emailed boolean, p_note text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.client_statements
     SET status      = CASE WHEN p_status IN ('sent', 'failed') THEN p_status ELSE status END,
         savings     = COALESCE(p_savings, savings),
         wallet      = COALESCE(p_wallet, wallet),
         notified_at = CASE WHEN p_notified THEN COALESCE(notified_at, now()) ELSE notified_at END,
         emailed_at  = CASE WHEN p_emailed  THEN COALESCE(emailed_at,  now()) ELSE emailed_at  END,
         note        = left(p_note, 300),
         updated_at  = now()
   WHERE id = p_id
$function$;

-- pg_cron entry point: hands the job to the edge function over pg_net.
CREATE OR REPLACE FUNCTION public.client_statements_trigger()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF COALESCE((SELECT value FROM public.platform_config WHERE key = 'client_statements_enabled'), 'true') <> 'true' THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'client_statements_trigger: no cron_secret in vault — skipped';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/client-statements',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0',
      'x-cron-secret', v_secret
    ),
    body    := jsonb_build_object('limit', 5)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_entry_sign(text)                                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ajo_entry_label(text, text, text, uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_savings_statement(uuid, timestamptz, timestamptz)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_wallet_statement(uuid, timestamptz, timestamptz)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_statement_data(uuid, date)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_statement_candidates(date, integer)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_statement_claim(uuid, date)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_statement_finish(uuid, text, jsonb, jsonb, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_statements_trigger()                                        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajo_entry_sign(text)                                                TO service_role;
GRANT EXECUTE ON FUNCTION public.ajo_entry_label(text, text, text, uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.client_savings_statement(uuid, timestamptz, timestamptz)            TO service_role;
GRANT EXECUTE ON FUNCTION public.client_wallet_statement(uuid, timestamptz, timestamptz)             TO service_role;
GRANT EXECUTE ON FUNCTION public.client_statement_data(uuid, date)                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.client_statement_candidates(date, integer)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.client_statement_claim(uuid, date)                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.client_statement_finish(uuid, text, jsonb, jsonb, boolean, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_statements_trigger()                                        TO service_role;

-- Days 1–3 of each month, every 10 minutes 06:00–20:50 UTC (07:00–21:50 WAT): 5 clients a run, so a big month drains
-- without bursting the email route (30 requests/minute) or the function's CPU budget.
DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'client-monthly-statements';
  PERFORM cron.schedule('client-monthly-statements', '*/10 6-20 1-3 * *', 'SELECT public.client_statements_trigger()');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'client-monthly-statements: cron not scheduled: %', SQLERRM;
END
$cron$;

-- Visibility (counts only): does the rebuilt savings balance agree with each client's real balance, and who is due?
DO $$
DECLARE
  c record; v numeric; n integer := 0; ok integer := 0; mx numeric := 0;
BEGIN
  FOR c IN SELECT id FROM public.aso_clients LOOP
    v := COALESCE(((public.client_savings_statement(c.id, now(), now()))->>'brought_forward')::numeric, 0);
    n := n + 1;
    IF v = 0 THEN ok := ok + 1; END IF;
    mx := GREATEST(mx, abs(v));
  END LOOP;
  RAISE NOTICE 'client statements: % clients, % rebuild exactly to their balance, largest brought-forward %', n, ok, mx;
  RAISE NOTICE 'client statements: due for 2026-09 = % (first month is 2026-10), for 2026-10 so far = %',
    (SELECT count(*) FROM public.client_statement_candidates('2026-09-01', 100000)),
    (SELECT count(*) FROM public.client_statement_candidates('2026-10-01', 100000));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client statements readout failed: %', SQLERRM;
END
$$;
