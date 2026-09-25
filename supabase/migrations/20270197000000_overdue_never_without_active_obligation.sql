-- Tightens 20270195: "overdue" now REQUIRES something active — no exceptions.
--
-- 20270195 let a client who had never had any card or group stay overdue on the client-level plan when a contribution
-- amount was set. Owner's decision (2026-09-25): a client with no card or group must never count as overdue.
--
-- A client is eligible to be overdue only when they have:
--   • an ACTIVE savings card (ajo_cycles.status = 'active'), or
--   • an active membership in an ACTIVE group — esusu (group_mode 'rotating'): group is_active + a running round;
--     savings group: group is_active + round_status = 'active'
--     (a client with no membership rows but a legacy aso_clients.ajo_group_id is treated as a member of it).
-- Settled/completed cards, unstarted/closed groups and clients with no card or group at all are NOT eligible.
--
-- Same signature as before, so the app RPC (ajo_overdue_eligible_clients) and the client reminder email
-- (ajo_get_overdue_email_candidates) pick the new rule up without being redefined.

CREATE OR REPLACE FUNCTION public.ajo_client_overdue_eligible(p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legacy_group  uuid;
  v_active_card   boolean := false;
  v_active_group  boolean := false;
BEGIN
  SELECT c.ajo_group_id INTO v_legacy_group
    FROM public.aso_clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT COALESCE(bool_or(y.status = 'active'), false)
    INTO v_active_card
    FROM public.ajo_cycles y WHERE y.client_id = p_client_id;

  SELECT COALESCE(bool_or(
           x.member_active AND g.is_active AND (
             (g.group_mode = 'rotating' AND EXISTS (
                SELECT 1 FROM public.ajo_group_rounds rr WHERE rr.group_id = g.id AND rr.status = 'active'))
             OR (g.group_mode IS DISTINCT FROM 'rotating' AND g.round_status = 'active')
           )
         ), false)
    INTO v_active_group
    FROM (
      SELECT m.group_id, (m.status = 'active') AS member_active
        FROM public.aso_client_group_memberships m WHERE m.client_id = p_client_id
      UNION ALL
      SELECT v_legacy_group, true
       WHERE v_legacy_group IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.aso_client_group_memberships m2 WHERE m2.client_id = p_client_id)
    ) x
    JOIN public.ajo_groups g ON g.id = x.group_id;

  RETURN v_active_card OR v_active_group;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_client_overdue_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_overdue_eligible(uuid) TO service_role;

-- Visibility only (no writes): what the tightened rule leaves on live data.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND next_contribution_date < CURRENT_DATE)                                            AS date_only,
           count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND next_contribution_date < CURRENT_DATE AND public.ajo_client_overdue_eligible(id)) AS with_rule
      FROM public.aso_clients
  LOOP
    RAISE NOTICE 'overduefix2 | overdue by date only=% | overdue under the final rule=%', r.date_only, r.with_rule;
  END LOOP;
END $$;
