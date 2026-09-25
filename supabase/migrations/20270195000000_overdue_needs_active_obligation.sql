-- ═════════════════════════════════════════════════════════════════════════════
-- "Overdue" must mean overdue ON SOMETHING THAT IS ACTIVE.
--
-- Until now a client counted as overdue purely because aso_clients.next_contribution_date had passed, even when
-- every savings card they had was settled, their savings group hadn't started / was closed, or their esusu had no
-- running round — nothing was actually due. Owners saw inflated "overdue" counts, banners and reminder emails.
--
-- A client is eligible to be overdue when ANY of these holds:
--   • they have an ACTIVE savings card (ajo_cycles.status = 'active')
--   • they are an active member of an ACTIVE group:
--       - esusu (group_mode 'rotating')  → the group is active AND has a running round (ajo_group_rounds 'active')
--       - savings group (anything else)  → the group is active AND round_status = 'active'
--       (a client with no membership rows but a legacy aso_clients.ajo_group_id is treated as a member of it)
--   • they have NEVER had a card or a group (an owner-collected client on the client-level plan) AND a contribution
--     amount is set — there is a real plan to miss. Without an amount there is nothing to be overdue on.
-- A client whose cards/groups all exist but are all inactive is NOT eligible.
--
-- Callers still apply the date test (next_contribution_date has passed) and status = 'active' themselves.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajo_client_overdue_eligible(p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount        numeric;
  v_legacy_group  uuid;
  v_active_card   boolean := false;
  v_any_card      boolean := false;
  v_active_group  boolean := false;
  v_any_group     boolean := false;
BEGIN
  SELECT c.contribution_amount, c.ajo_group_id INTO v_amount, v_legacy_group
    FROM public.aso_clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT COALESCE(bool_or(y.status = 'active'), false), count(*) > 0
    INTO v_active_card, v_any_card
    FROM public.ajo_cycles y WHERE y.client_id = p_client_id;

  SELECT count(*) > 0,
         COALESCE(bool_or(
           x.member_active AND g.is_active AND (
             (g.group_mode = 'rotating' AND EXISTS (
                SELECT 1 FROM public.ajo_group_rounds rr WHERE rr.group_id = g.id AND rr.status = 'active'))
             OR (g.group_mode IS DISTINCT FROM 'rotating' AND g.round_status = 'active')
           )
         ), false)
    INTO v_any_group, v_active_group
    FROM (
      SELECT m.group_id, (m.status = 'active') AS member_active
        FROM public.aso_client_group_memberships m WHERE m.client_id = p_client_id
      UNION ALL
      SELECT v_legacy_group, true
       WHERE v_legacy_group IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.aso_client_group_memberships m2 WHERE m2.client_id = p_client_id)
    ) x
    JOIN public.ajo_groups g ON g.id = x.group_id;

  RETURN v_active_card
      OR v_active_group
      OR (NOT v_any_card AND NOT v_any_group AND COALESCE(v_amount, 0) > 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_client_overdue_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_overdue_eligible(uuid) TO service_role;

-- The app's entry point: of the client ids the app already has on screen, which are eligible to be overdue?
-- Limited to clients of the caller's own business (the owner, or the owner of the staff member calling).
CREATE OR REPLACE FUNCTION public.ajo_overdue_eligible_clients(p_client_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id
    FROM public.aso_clients c
   WHERE c.id = ANY(COALESCE(p_client_ids, ARRAY[]::uuid[]))
     AND ( c.user_id = auth.uid()
           OR c.user_id = (SELECT s.owner_id FROM public.staff s WHERE s.user_id = auth.uid() AND s.status = 'active' LIMIT 1) )
     AND public.ajo_client_overdue_eligible(c.id)
$function$;

REVOKE ALL ON FUNCTION public.ajo_overdue_eligible_clients(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_overdue_eligible_clients(uuid[]) TO authenticated;

-- The daily "your contribution is overdue" client email: same rule (and never for archived clients).
CREATE OR REPLACE FUNCTION public.ajo_get_overdue_email_candidates(p_limit integer DEFAULT 25)
 RETURNS TABLE (
   client_id              uuid,
   client_name            text,
   client_email           text,
   contribution_amount    numeric,
   contribution_frequency text,
   next_contribution_date date,
   current_balance        numeric,
   business_name          text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id,
         c.full_name::text,
         c.email::text,
         c.contribution_amount::numeric,
         c.contribution_frequency::text,
         c.next_contribution_date::date,
         c.current_balance::numeric,
         p.business_name::text
  FROM public.aso_clients c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.status = 'active'
    AND c.archived_at IS NULL
    AND COALESCE(c.email, '') <> ''
    AND COALESCE(c.contribution_amount, 0) > 0
    AND c.next_contribution_date IS NOT NULL
    AND c.next_contribution_date <  CURRENT_DATE
    AND c.next_contribution_date >= CURRENT_DATE - 30
    AND (c.last_overdue_email_on IS NULL OR c.last_overdue_email_on <= CURRENT_DATE - 7)
    AND public.ajo_client_overdue_eligible(c.id)
  ORDER BY c.next_contribution_date ASC
  LIMIT GREATEST(p_limit, 0)
$function$;

REVOKE ALL ON FUNCTION public.ajo_get_overdue_email_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_get_overdue_email_candidates(integer) TO service_role;
