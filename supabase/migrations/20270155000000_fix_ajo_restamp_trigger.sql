-- Fix for 20270153: re-stamping an Ajo contribution's balance_after when the client's
-- balance moves in the same transaction.
--
-- The first version located "rows written in this transaction" by comparing the
-- row's xmin with txid_current(). That fails whenever the writing code sits in a
-- BEGIN … EXCEPTION block (most of these SQL functions do): the row then carries the
-- SUB-transaction id, never equal to the top-level id, so nothing was re-stamped —
-- caught by the rollback probe (expected 1500.00, still 1000.00).
--
-- ajo_contributions.created_at defaults to now(), which is the transaction START time
-- and therefore identical for every row written in the same transaction, sub-
-- transactions included, and different from any other transaction's rows.
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
         AND created_at = now();          -- written in THIS transaction
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'restamp_ajo_contribution_balance: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.restamp_ajo_contribution_balance() FROM PUBLIC, anon, authenticated;
