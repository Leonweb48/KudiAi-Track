-- Owner's rule (2026-10-11): a client does not start "counting" (due, expected, missed, overdue, reminders) until they
-- open a savings card, join a running esusu round or an active savings group — and counting starts THEN, not at
-- registration. 20270197 already made "overdue" need an active obligation; this adds WHEN counting starts, so a client
-- whose next_contribution_date went stale while they had no card is not overdue the moment they open one, and makes
-- the owner's morning "Collect from N clients" bell reminder follow the same rule (it counted everyone by date).
-- Also clears reminders that counted clients the rule now excludes.

-- When counting started for this client: the start of their earliest CURRENTLY ACTIVE obligation (Lagos date).
-- NULL = nothing active = never due, never overdue. Same "active" definition as ajo_client_overdue_eligible (20270197).
CREATE OR REPLACE FUNCTION public.ajo_client_counting_since(p_client_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legacy_group uuid;
  v_card   date;
  v_group  date;
BEGIN
  SELECT c.ajo_group_id INTO v_legacy_group FROM public.aso_clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT min(y.start_date) INTO v_card
    FROM public.ajo_cycles y WHERE y.client_id = p_client_id AND y.status = 'active';

  SELECT min(GREATEST(
           CASE WHEN g.group_mode = 'rotating'
                THEN (SELECT min(rr.started_at) FROM public.ajo_group_rounds rr WHERE rr.group_id = g.id AND rr.status = 'active')
                ELSE g.started_at END,
           x.joined_at) AT TIME ZONE 'Africa/Lagos')::date
    INTO v_group
    FROM (
      SELECT m.group_id, m.joined_at FROM public.aso_client_group_memberships m
       WHERE m.client_id = p_client_id AND m.status = 'active'
      UNION ALL
      SELECT v_legacy_group, NULL::timestamptz
       WHERE v_legacy_group IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.aso_client_group_memberships m2 WHERE m2.client_id = p_client_id)
    ) x
    JOIN public.ajo_groups g ON g.id = x.group_id
   WHERE g.is_active
     AND ( (g.group_mode = 'rotating' AND EXISTS (
              SELECT 1 FROM public.ajo_group_rounds rr WHERE rr.group_id = g.id AND rr.status = 'active'))
        OR (g.group_mode IS DISTINCT FROM 'rotating' AND g.round_status = 'active') );

  IF v_card IS NULL AND v_group IS NULL THEN RETURN NULL; END IF;
  -- A group/round with no recorded start still counts as active: count from today rather than not at all
  RETURN LEAST(COALESCE(v_card, 'infinity'::date), COALESCE(v_group, (now() AT TIME ZONE 'Africa/Lagos')::date));
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_client_counting_since(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_counting_since(uuid) TO service_role;

-- The date a client is actually next due: never before counting started. NULL = not counting.
CREATE OR REPLACE FUNCTION public.ajo_client_effective_due(p_client_id uuid, p_next date)
 RETURNS date
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN s.since IS NULL THEN NULL ELSE GREATEST(COALESCE(p_next, s.since), s.since) END
    FROM (SELECT public.ajo_client_counting_since(p_client_id) AS since) s
$function$;

REVOKE ALL ON FUNCTION public.ajo_client_effective_due(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_effective_due(uuid, date) TO service_role;

-- The app's entry point (owner/staff screens): counting start per client, limited to the caller's own business —
-- same scope as ajo_overdue_eligible_clients. Clients that are not counting are simply absent.
CREATE OR REPLACE FUNCTION public.ajo_clients_counting_since(p_client_ids uuid[])
 RETURNS TABLE (client_id uuid, counting_since date)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, public.ajo_client_counting_since(c.id)
    FROM public.aso_clients c
   WHERE c.id = ANY(COALESCE(p_client_ids, ARRAY[]::uuid[]))
     AND ( c.user_id = auth.uid()
           OR c.user_id = (SELECT s.owner_id FROM public.staff s WHERE s.user_id = auth.uid() AND s.status = 'active' LIMIT 1) )
     AND public.ajo_client_counting_since(c.id) IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.ajo_clients_counting_since(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_clients_counting_since(uuid[]) TO authenticated;

-- Client "your contribution is overdue" email: overdue only from the EFFECTIVE due date.
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
         e.due,
         c.current_balance::numeric,
         p.business_name::text
  FROM public.aso_clients c
  CROSS JOIN LATERAL (SELECT public.ajo_client_effective_due(c.id, c.next_contribution_date) AS due) e
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.status = 'active'
    AND c.archived_at IS NULL
    AND COALESCE(c.email, '') <> ''
    AND COALESCE(c.contribution_amount, 0) > 0
    AND c.next_contribution_date IS NOT NULL
    AND c.next_contribution_date < CURRENT_DATE           -- cheap pre-filter before the per-client check
    AND e.due IS NOT NULL
    AND e.due <  CURRENT_DATE
    AND e.due >= CURRENT_DATE - 30
    AND (c.last_overdue_email_on IS NULL OR c.last_overdue_email_on <= CURRENT_DATE - 7)
  ORDER BY e.due ASC
  LIMIT GREATEST(p_limit, 0)
$function$;

REVOKE ALL ON FUNCTION public.ajo_get_overdue_email_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_get_overdue_email_candidates(integer) TO service_role;

-- Owner's morning bell reminder: only clients who are counting (and not archived), by their effective due date.
CREATE OR REPLACE FUNCTION public.ajo_check_collection_reminder()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      c.user_id,
      COUNT(*)                                    AS n_due,
      COALESCE(SUM(c.contribution_amount), 0)     AS total_expected
    FROM public.aso_clients c
    WHERE c.status = 'active'
      AND c.archived_at IS NULL
      AND c.next_contribution_date IS NOT NULL
      AND c.next_contribution_date <= CURRENT_DATE
      AND public.ajo_client_effective_due(c.id, c.next_contribution_date) <= CURRENT_DATE
      AND public.notif_pref_allows(c.user_id, 'savings')
    GROUP BY c.user_id
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'ajo_collection_reminder', 'savings',
      'Collect from ' || v_row.n_due || ' client' || CASE WHEN v_row.n_due = 1 THEN '' ELSE 's' END || ' today',
      '₦' || to_char(v_row.total_expected, 'FM999,999,990.00') || ' expected in contributions.',
      jsonb_build_object('tab', 'aso', 'sub', 'clients'), 'high',
      format('ajo_collection_reminder_%s_%s', v_row.user_id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_check_collection_reminder() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_check_collection_reminder() TO service_role;

-- Clear pending reminders built on the old rule. Earlier days' unread "Collect from N clients" reminders are stale;
-- today's is corrected to the new count, or cleared when no client is counting. (Soft dismiss: rows are kept.)
DO $$
DECLARE r record; v_n int; v_total numeric; v_stale int := 0; v_fixed int := 0; v_cleared int := 0;
BEGIN
  UPDATE public.notifications SET dismissed_at = now(), read_at = COALESCE(read_at, now())
   WHERE type = 'ajo_collection_reminder' AND dismissed_at IS NULL AND read_at IS NULL
     AND (created_at AT TIME ZONE 'Africa/Lagos')::date < (now() AT TIME ZONE 'Africa/Lagos')::date;
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  FOR r IN
    SELECT id, user_id FROM public.notifications
     WHERE type = 'ajo_collection_reminder' AND dismissed_at IS NULL AND read_at IS NULL
  LOOP
    SELECT count(*), COALESCE(sum(c.contribution_amount), 0) INTO v_n, v_total
      FROM public.aso_clients c
     WHERE c.user_id = r.user_id AND c.status = 'active' AND c.archived_at IS NULL
       AND c.next_contribution_date IS NOT NULL AND c.next_contribution_date <= CURRENT_DATE
       AND public.ajo_client_effective_due(c.id, c.next_contribution_date) <= CURRENT_DATE;
    IF v_n = 0 THEN
      UPDATE public.notifications SET dismissed_at = now(), read_at = now() WHERE id = r.id;
      v_cleared := v_cleared + 1;
    ELSE
      UPDATE public.notifications
         SET title = 'Collect from ' || v_n || ' client' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' today',
             body  = '₦' || to_char(v_total, 'FM999,999,990.00') || ' expected in contributions.'
       WHERE id = r.id;
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'counting | stale reminders cleared=% | today''s corrected=% | today''s cleared (nobody counting)=%', v_stale, v_fixed, v_cleared;
END $$;

-- Visibility only: what the rule leaves on live data (counts only — CI logs are public).
DO $$
DECLARE r record;
BEGIN
  SELECT count(*) FILTER (WHERE next_contribution_date < CURRENT_DATE)                                                  AS by_date,
         count(*) FILTER (WHERE next_contribution_date < CURRENT_DATE AND public.ajo_client_counting_since(id) IS NULL) AS no_obligation,
         count(*) FILTER (WHERE public.ajo_client_effective_due(id, next_contribution_date) < CURRENT_DATE)             AS overdue_now
    INTO r
    FROM public.aso_clients WHERE status = 'active' AND archived_at IS NULL;
  RAISE NOTICE 'counting | overdue by date alone=% | of those with no active card/group=% | overdue under the new rule=%',
    r.by_date, r.no_obligation, r.overdue_now;
END $$;
