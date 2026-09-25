-- READ-ONLY diagnostic (no writes): how many clients are counted "overdue" today, and how many of them have NO active card /
-- savings group / esusu round to be overdue on? Counts only (no names). Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    WITH c AS (
      SELECT a.id, a.user_id, a.status, a.next_contribution_date,
             (a.status = 'active' AND a.next_contribution_date IS NOT NULL AND a.next_contribution_date < CURRENT_DATE) AS overdue_now,
             EXISTS (SELECT 1 FROM public.ajo_cycles y WHERE y.client_id = a.id AND y.status = 'active')          AS active_card,
             EXISTS (SELECT 1 FROM public.ajo_cycles y WHERE y.client_id = a.id)                                  AS any_card,
             EXISTS (SELECT 1 FROM public.aso_client_group_memberships m JOIN public.ajo_groups g ON g.id = m.group_id
                      WHERE m.client_id = a.id AND m.status = 'active' AND g.is_active
                        AND ((g.group_mode = 'rotating' AND EXISTS (SELECT 1 FROM public.ajo_group_rounds rr WHERE rr.group_id = g.id AND rr.status = 'active'))
                          OR (g.group_mode <> 'rotating' AND g.round_status = 'active')))                         AS active_group,
             EXISTS (SELECT 1 FROM public.aso_client_group_memberships m WHERE m.client_id = a.id)                AS any_group
        FROM public.aso_clients a WHERE a.archived_at IS NULL
    )
    SELECT count(*)                                                                                   AS clients,
           count(*) FILTER (WHERE status = 'active')                                                  AS active_clients,
           count(*) FILTER (WHERE overdue_now)                                                        AS overdue_today,
           count(*) FILTER (WHERE overdue_now AND (active_card OR active_group))                      AS overdue_with_active_thing,
           count(*) FILTER (WHERE overdue_now AND NOT (active_card OR active_group) AND (any_card OR any_group)) AS overdue_only_inactive_things,
           count(*) FILTER (WHERE overdue_now AND NOT (any_card OR any_group))                        AS overdue_never_had_card_or_group,
           count(*) FILTER (WHERE status = 'active' AND NOT (any_card OR any_group))                  AS active_clients_with_no_card_or_group
      FROM c
  LOOP
    RAISE NOTICE 'overdue | clients=% active=% overdue_today=% | of those: has_active_card_or_group=% only_inactive_ones=% never_had_any=% | active clients with no card/group at all=%',
      r.clients, r.active_clients, r.overdue_today, r.overdue_with_active_thing, r.overdue_only_inactive_things, r.overdue_never_had_card_or_group, r.active_clients_with_no_card_or_group;
  END LOOP;

  -- the shapes of cards / groups that exist
  FOR r IN SELECT status, count(*) AS n FROM public.ajo_cycles GROUP BY 1 ORDER BY 1 LOOP RAISE NOTICE 'overdue | cards status=% n=%', r.status, r.n; END LOOP;
  FOR r IN SELECT group_mode, round_status, is_active, count(*) AS n FROM public.ajo_groups GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 LOOP
    RAISE NOTICE 'overdue | groups mode=% round_status=% is_active=% n=%', r.group_mode, r.round_status, r.is_active, r.n; END LOOP;
  FOR r IN SELECT status, count(*) AS n FROM public.ajo_group_rounds GROUP BY 1 ORDER BY 1 LOOP RAISE NOTICE 'overdue | esusu rounds status=% n=%', r.status, r.n; END LOOP;
  FOR r IN SELECT status, count(*) AS n FROM public.aso_client_group_memberships GROUP BY 1 ORDER BY 1 LOOP RAISE NOTICE 'overdue | memberships status=% n=%', r.status, r.n; END LOOP;
  FOR r IN SELECT status, count(*) AS n FROM public.aso_clients GROUP BY 1 ORDER BY 1 LOOP RAISE NOTICE 'overdue | client status=% n=%', r.status, r.n; END LOOP;
END $$;
