-- ═════════════════════════════════════════════════════════════════════════════
-- P2-A / P2-C — stored, server-generated transaction references + balance-after.
--
-- REFERENCES
--   Format  KDT-{YYYYMM}-{8 chars}   e.g. KDT-202609-X7K2M9PQ
--   • generated HERE, in the database, by a BEFORE INSERT trigger — never on a device
--   • stored in a receipt_ref column on every money table
--   • unique across ALL of them: every reference is first inserted into one
--     registry (receipt_references, primary key = the reference), so a collision
--     is impossible by construction (the generator retries on a clash)
--   • the registry is also the lookup index: reference -> (table, row id), which
--     is how support / the admin portal find any transaction from a receipt
--   • 8 chars from a 32-symbol alphabet with no 0/O/1/I (≈1.1e12 per month)
--   • month is the WAT calendar month of the row's created_at
--   Existing rows are backfilled (deterministic month from created_at) so every
--   receipt, old or new, shows a real stored reference.
--
-- BALANCE AFTER (stored at write time, like wallet_ledger.balance_after_kobo)
--   transactions.balance_after     cash-book running position for the business:
--                                  Σ cash-in − Σ cash-out, EXCLUDING credit sales
--                                  (payment_type = 'credit': no cash has moved)
--   debt_payments.balance_after    what the debtor still owes after this payment
--                                  (total + interest − payments so far)
--   ajo_contributions.balance_after the client's savings balance after the entry
--   (org_savings and wallet_ledger already carry a balance_after)
--
-- Every trigger below is wrapped so that ANY failure leaves the column NULL and
-- raises a warning — it can never block the money row from being written.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Registry (private: RLS on, no policies — service role only) ────────────
CREATE TABLE IF NOT EXISTS public.receipt_references (
  ref          text        PRIMARY KEY,
  source_table text        NOT NULL,
  source_id    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipt_references_source_idx ON public.receipt_references (source_table, source_id);
ALTER TABLE public.receipt_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_references FROM PUBLIC, anon, authenticated;

-- ── 2. Generator ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kdt_new_ref(p_table text, p_id text, p_at timestamptz DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 symbols, no 0 O 1 I
  v_prefix   text;
  v_hex      text;
  v_ref      text;
  i          integer;
  v_tries    integer := 0;
BEGIN
  v_prefix := 'KDT-' || to_char(COALESCE(p_at, now()) AT TIME ZONE 'Africa/Lagos', 'YYYYMM') || '-';
  LOOP
    v_tries := v_tries + 1;
    v_hex   := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- 64 random hex chars
    v_ref   := v_prefix;
    FOR i IN 1..8 LOOP
      v_ref := v_ref || substr(v_alphabet, (('x' || substr(v_hex, i * 2 - 1, 2))::bit(8)::integer % 32) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.receipt_references (ref, source_table, source_id) VALUES (v_ref, p_table, p_id);
      RETURN v_ref;
    EXCEPTION WHEN unique_violation THEN
      IF v_tries > 25 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.kdt_new_ref(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kdt_new_ref(text, text, timestamptz) TO service_role;

-- ── 3. One trigger function for every money table ────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_receipt_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.receipt_ref IS NULL THEN
    BEGIN
      NEW.receipt_ref := public.kdt_new_ref(TG_TABLE_NAME, NEW.id::text, NEW.created_at);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'assign_receipt_ref(%): %', TG_TABLE_NAME, SQLERRM;   -- never block the money row
    END;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.assign_receipt_ref() FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions', 'debt_payments', 'ajo_contributions', 'org_savings', 'org_loan_repayments', 'wallet_ledger']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS receipt_ref text', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (receipt_ref) WHERE receipt_ref IS NOT NULL', t || '_receipt_ref_key', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_assign_receipt_ref ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_assign_receipt_ref BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_ref()', t);
  END LOOP;
END
$do$;

-- ── 4. Balance-after columns + write-time triggers ───────────────────────────
ALTER TABLE public.transactions      ADD COLUMN IF NOT EXISTS balance_after numeric;
ALTER TABLE public.debt_payments     ADD COLUMN IF NOT EXISTS balance_after numeric;
ALTER TABLE public.ajo_contributions ADD COLUMN IF NOT EXISTS balance_after numeric;

-- 4a. Cash book
CREATE OR REPLACE FUNCTION public.set_transaction_balance_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before numeric;
BEGIN
  IF NEW.balance_after IS NULL THEN
    BEGIN
      SELECT COALESCE(SUM(CASE WHEN t.type = 'in' THEN t.amount ELSE -t.amount END), 0)
        INTO v_before
        FROM public.transactions t
       WHERE t.user_id = NEW.user_id AND COALESCE(t.payment_type, '') <> 'credit';
      NEW.balance_after := v_before + CASE
        WHEN COALESCE(NEW.payment_type, '') = 'credit' THEN 0
        WHEN NEW.type = 'in' THEN NEW.amount
        ELSE -NEW.amount END;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'set_transaction_balance_after: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_set_transaction_balance_after ON public.transactions;
CREATE TRIGGER trg_set_transaction_balance_after BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_transaction_balance_after();

-- 4b. Credit repayments — what the debtor still owes after this payment
CREATE OR REPLACE FUNCTION public.set_debt_payment_balance_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.balance_after IS NULL THEN
    BEGIN
      NEW.balance_after := GREATEST(
        (SELECT COALESCE(c.total_amount, 0) + COALESCE(c.interest_amount, 0) FROM public.credits c WHERE c.id = NEW.credit_id)
        - (SELECT COALESCE(SUM(p.amount), 0) FROM public.debt_payments p WHERE p.credit_id = NEW.credit_id)
        - NEW.amount, 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'set_debt_payment_balance_after: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_set_debt_payment_balance_after ON public.debt_payments;
CREATE TRIGGER trg_set_debt_payment_balance_after BEFORE INSERT ON public.debt_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_debt_payment_balance_after();

-- 4c. Ajo — the client's balance after the entry. The RPCs that write a contribution
--     and update aso_clients.current_balance may do so in either order, so cover both:
--     read the balance at insert, and re-stamp rows written in the same transaction
--     when the balance is updated.
CREATE OR REPLACE FUNCTION public.set_ajo_contribution_balance_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.balance_after IS NULL THEN
    BEGIN
      SELECT c.current_balance INTO NEW.balance_after FROM public.aso_clients c WHERE c.id = NEW.aso_client_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'set_ajo_contribution_balance_after: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_set_ajo_contribution_balance_after ON public.ajo_contributions;
CREATE TRIGGER trg_set_ajo_contribution_balance_after BEFORE INSERT ON public.ajo_contributions
  FOR EACH ROW EXECUTE FUNCTION public.set_ajo_contribution_balance_after();

CREATE OR REPLACE FUNCTION public.restamp_ajo_contribution_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.current_balance IS DISTINCT FROM OLD.current_balance THEN
    BEGIN
      UPDATE public.ajo_contributions
         SET balance_after = NEW.current_balance
       WHERE aso_client_id = NEW.id
         AND xmin::text::bigint = (txid_current() % 4294967296);      -- rows written in THIS transaction
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'restamp_ajo_contribution_balance: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_restamp_ajo_contribution_balance ON public.aso_clients;
CREATE TRIGGER trg_restamp_ajo_contribution_balance AFTER UPDATE OF current_balance ON public.aso_clients
  FOR EACH ROW EXECUTE FUNCTION public.restamp_ajo_contribution_balance();

-- ── 5. Backfill existing rows ─────────────────────────────────────────────────
-- Triggers only fire on INSERT, so these UPDATEs cannot re-trigger anything above.
UPDATE public.transactions        SET receipt_ref = public.kdt_new_ref('transactions',        id::text, created_at) WHERE receipt_ref IS NULL;
UPDATE public.debt_payments       SET receipt_ref = public.kdt_new_ref('debt_payments',       id::text, created_at) WHERE receipt_ref IS NULL;
UPDATE public.ajo_contributions   SET receipt_ref = public.kdt_new_ref('ajo_contributions',   id::text, created_at) WHERE receipt_ref IS NULL;
UPDATE public.org_savings         SET receipt_ref = public.kdt_new_ref('org_savings',         id::text, created_at) WHERE receipt_ref IS NULL;
UPDATE public.org_loan_repayments SET receipt_ref = public.kdt_new_ref('org_loan_repayments', id::text, created_at) WHERE receipt_ref IS NULL;
UPDATE public.wallet_ledger       SET receipt_ref = public.kdt_new_ref('wallet_ledger',       id::text, created_at) WHERE receipt_ref IS NULL;

-- Running cash-book balance for history (window over each business's rows in write order)
UPDATE public.transactions t
   SET balance_after = s.bal
  FROM (
    SELECT id,
           SUM(CASE WHEN COALESCE(payment_type, '') = 'credit' THEN 0
                    WHEN type = 'in' THEN amount ELSE -amount END)
             OVER (PARTITION BY user_id ORDER BY created_at, id) AS bal
      FROM public.transactions
  ) s
 WHERE t.id = s.id AND t.balance_after IS NULL;

-- Debtor balance for history
UPDATE public.debt_payments dp
   SET balance_after = s.bal
  FROM (
    SELECT p.id,
           GREATEST(COALESCE(c.total_amount, 0) + COALESCE(c.interest_amount, 0)
                    - SUM(p.amount) OVER (PARTITION BY p.credit_id ORDER BY p.created_at, p.id), 0) AS bal
      FROM public.debt_payments p
      JOIN public.credits c ON c.id = p.credit_id
  ) s
 WHERE dp.id = s.id AND dp.balance_after IS NULL;

-- ── 6. Public verification (used by the receipt's "Verify at kudiai.app/verify") ─
-- Returns only non-identifying facts: what kind of transaction, how much, when,
-- and which business recorded it. No parties, no balance, no contact details.
CREATE OR REPLACE FUNCTION public.verify_receipt(p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref  text := upper(trim(COALESCE(p_ref, '')));
  v_src  record;
  v_out  jsonb;
BEGIN
  IF v_ref !~ '^KDT-[0-9]{6}-[A-Z2-9]{8}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT source_table, source_id INTO v_src FROM public.receipt_references WHERE ref = v_ref;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  IF v_src.source_table = 'transactions' THEN
    SELECT jsonb_build_object('found', true, 'kind', CASE WHEN t.type = 'in' THEN 'Cash in' ELSE 'Cash out' END,
             'amount', t.amount, 'occurred_at', t.created_at, 'business', p.business_name)
      INTO v_out FROM public.transactions t LEFT JOIN public.profiles p ON p.id = t.user_id WHERE t.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'debt_payments' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Debt repayment', 'amount', d.amount, 'occurred_at', d.created_at, 'business', p.business_name)
      INTO v_out FROM public.debt_payments d LEFT JOIN public.profiles p ON p.id = d.owner_id WHERE d.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'ajo_contributions' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Savings entry', 'amount', a.amount, 'occurred_at', a.created_at, 'business', p.business_name)
      INTO v_out FROM public.ajo_contributions a LEFT JOIN public.profiles p ON p.id = a.owner_id WHERE a.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'org_savings' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Cooperative savings', 'amount', s.amount, 'occurred_at', s.created_at, 'business', o.name)
      INTO v_out FROM public.org_savings s LEFT JOIN public.organizations o ON o.id = s.org_id WHERE s.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'org_loan_repayments' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Loan repayment', 'amount', r.amount, 'occurred_at', r.created_at, 'business', o.name)
      INTO v_out FROM public.org_loan_repayments r LEFT JOIN public.organizations o ON o.id = r.org_id WHERE r.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'wallet_ledger' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Wallet ' || CASE WHEN w.direction = 'credit' THEN 'credit' ELSE 'debit' END,
             'amount', w.amount_kobo / 100.0, 'occurred_at', w.created_at, 'business', p.business_name)
      INTO v_out FROM public.wallet_ledger w LEFT JOIN public.profiles p ON p.id = w.user_id WHERE w.id::text = v_src.source_id;
  END IF;
  RETURN COALESCE(v_out, jsonb_build_object('found', false));
END;
$function$;
REVOKE ALL ON FUNCTION public.verify_receipt(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_receipt(text) TO anon, authenticated, service_role;

-- ── 7. Visibility ─────────────────────────────────────────────────────────────
DO $$
DECLARE n bigint; d bigint;
BEGIN
  SELECT count(*) INTO n FROM public.receipt_references;
  SELECT count(*) INTO d FROM (SELECT ref FROM public.receipt_references GROUP BY ref HAVING count(*) > 1) x;
  RAISE NOTICE 'receipt_references: % references registered, % duplicates (must be 0)', n, d;
  RAISE NOTICE 'rows still without a reference: transactions=%, debt_payments=%, ajo_contributions=%, org_savings=%, org_loan_repayments=%, wallet_ledger=%',
    (SELECT count(*) FROM public.transactions WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.debt_payments WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.ajo_contributions WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.org_savings WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.org_loan_repayments WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.wallet_ledger WHERE receipt_ref IS NULL);
  RAISE NOTICE 'sample: %', (SELECT string_agg(ref, ', ') FROM (SELECT ref FROM public.receipt_references ORDER BY created_at DESC LIMIT 3) s);
END
$$;
