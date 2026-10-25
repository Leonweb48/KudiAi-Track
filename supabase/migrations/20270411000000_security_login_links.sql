-- Security audit 2026-10-25, batch 2: who a client / staff record's login is.
-- aso_clients.client_user_id and staff.user_id were writable by the business from its own session. Pointing one at
-- another person's account and pressing "create login" (manage-ajo-client-account / manage-staff-account) reset THAT
-- person's password; a staff member could also point a client's record at their own account and receive the client's
-- savings payouts. Now:
--   - the server (service role) sets and changes these links (login creation, self-registration, account deletion);
--   - a logged-in user may link a record to THEMSELVES, once (empty → their own id), when its email is their login
--     email — the first-login link the app does for staff and clients;
--   - nothing else.
-- The edge functions also refuse to reset a login that isn't the one made for that record (deployed with this).

CREATE OR REPLACE FUNCTION public.guard_login_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER   -- must see WHO is writing (as a definer function it would always see its owner)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old  uuid;
  v_new  uuid;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;   -- the server and migrations decide freely
  IF TG_TABLE_NAME = 'aso_clients' THEN
    v_new := NEW.client_user_id;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.client_user_id END;
  ELSE
    v_new := NEW.user_id;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.user_id END;
  END IF;
  IF v_new IS NOT DISTINCT FROM v_old THEN RETURN NEW; END IF;
  IF v_old IS NULL AND v_new IS NOT NULL AND v_new = auth.uid()
     AND lower(coalesce(NEW.email, '')) <> '' AND lower(NEW.email) = lower(coalesce(auth.email(), '')) THEN
    RETURN NEW;   -- linking your own account to your own record on first login
  END IF;
  RAISE EXCEPTION 'A login can only be linked by KudiAI' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_guard_client_login_link ON public.aso_clients;
CREATE TRIGGER trg_guard_client_login_link BEFORE INSERT OR UPDATE OF client_user_id ON public.aso_clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_link();
DROP TRIGGER IF EXISTS trg_guard_staff_login_link ON public.staff;
CREATE TRIGGER trg_guard_staff_login_link BEFORE INSERT OR UPDATE OF user_id ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_link();

-- Past links that don't match: counted only (no rows changed) — a link whose account's email isn't the record's email.
DO $$
DECLARE n_c int; n_s int;
BEGIN
  SELECT count(*) INTO n_c FROM public.aso_clients c JOIN auth.users u ON u.id = c.client_user_id
   WHERE c.email IS NOT NULL AND lower(u.email) <> lower(c.email);
  SELECT count(*) INTO n_s FROM public.staff s JOIN auth.users u ON u.id = s.user_id
   WHERE s.email IS NOT NULL AND lower(u.email) <> lower(s.email);
  RAISE NOTICE 'login links | client links to an account with another email: % | staff: %', n_c, n_s;
END $$;
