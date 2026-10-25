-- READ-ONLY (2026-10-25, audit): the one Ajo client whose login account has a different email from the client record —
-- tampering or an ordinary email change? Facts as yes/no only (no emails, names or ids). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT (u.raw_user_meta_data->>'account_type') AS acct,
           (u.raw_user_meta_data->>'aso_client_id' = c.id::text) AS meta_points_here,
           (u.raw_user_meta_data->>'owner_id' = c.user_id::text) AS meta_owner_matches,
           (u.id = c.user_id) AS login_is_the_business_itself,
           EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.business_name IS NOT NULL) AS login_is_a_business_owner,
           split_part(lower(u.email), '@', 2) = split_part(lower(c.email), '@', 2) AS same_email_domain,
           to_char(c.created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS client_created,
           to_char(u.created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS login_created,
           (SELECT count(*) FROM public.aso_clients c2 WHERE c2.client_user_id = u.id) AS records_on_that_login
      FROM public.aso_clients c JOIN auth.users u ON u.id = c.client_user_id
     WHERE c.email IS NOT NULL AND lower(u.email) <> lower(c.email) LOOP
    RAISE NOTICE 'link | account_type=% meta_points_here=% meta_owner_matches=% login_is_business_itself=% login_is_owner=% same_domain=% client_created=% login_created=% records_on_login=%',
      r.acct, r.meta_points_here, r.meta_owner_matches, r.login_is_the_business_itself, r.login_is_a_business_owner, r.same_email_domain, r.client_created, r.login_created, r.records_on_that_login;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
