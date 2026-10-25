-- Security audit 2026-10-25 follow-up: reward points. The feature is switched off (no setting, no balances, no log rows
-- in 60 days), but a user could set their own profiles.points_balance and insert reward_points_log rows — and points
-- discount bills in the app. Users can no longer change either; the server can. If points are ever switched on, earning
-- and spending must move to a server function first (as cashback did, cashback_record).
CREATE OR REPLACE FUNCTION public.guard_points_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER   -- must see who is writing
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.points_balance IS DISTINCT FROM OLD.points_balance THEN
    NEW.points_balance := OLD.points_balance;   -- silently kept: the rest of the profile update still goes through
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_points_balance ON public.profiles;
CREATE TRIGGER trg_guard_points_balance BEFORE UPDATE OF points_balance ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_points_balance();

DROP POLICY IF EXISTS "reward_points_log_insert_own" ON public.reward_points_log;
REVOKE INSERT, UPDATE, DELETE ON public.reward_points_log FROM anon, authenticated;
