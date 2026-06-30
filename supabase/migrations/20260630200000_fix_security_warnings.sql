-- ════════════════════════════════════════════════════════════════════════════
--  Fix all Supabase security linter WARN items
--  1. function_search_path_mutable  — lock search_path on all 47 functions
--  2. anon_security_definer_function_executable — revoke anon/public execute
--  3. rls_policy_always_true        — narrow overly-permissive policies
--  4. public_bucket_allows_listing  — remove broad listing on public buckets
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Lock search_path on every flagged function ─────────────────────────
-- Prevents search-path injection attacks where a malicious schema object
-- shadows a pg built-in. SET search_path = public, pg_temp is the recommended
-- minimum: public for our schema, pg_temp last (temp table access if needed).

ALTER FUNCTION public.audit_on_ban()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_on_join_request()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_on_msg_delete()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_on_mute()                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_create_commission()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_index_group_media()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.award_reputation(uuid, uuid, integer, text, uuid)       SET search_path = public, pg_temp;
ALTER FUNCTION public.can_access_org_chat(uuid)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.check_auto_badges(uuid, uuid)                           SET search_path = public, pg_temp;
ALTER FUNCTION public.check_coupon(text)                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.check_slow_mode(uuid, uuid)                             SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_disappearing_messages()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_mutes()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_ticket_number()                                SET search_path = public, pg_temp;
ALTER FUNCTION public.get_group_analytics(uuid, integer)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.get_my_membership()                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.get_my_org()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.get_owner_plan()                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.get_plan_limit(text, text)                              SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_plan_usage(uuid)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.hash_admin_password(text)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_invite_use(text)                              SET search_path = public, pg_temp;
ALTER FUNCTION public.is_org_admin(uuid)                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.is_org_mod_or_above(uuid)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.log_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.rep_on_message()                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.rep_on_poll_vote()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.rep_on_voice_join()                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.search_group_media(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.search_group_messages(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_admin_password(uuid, text)                          SET search_path = public, pg_temp;
ALTER FUNCTION public.set_message_expiry()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_badge_count()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_org_member_count()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_check_ajo_group_limit()                             SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_check_org_limit()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_check_org_member_limit()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_queue_ajo_welcome()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_queue_business_welcome()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_queue_org_member_welcome()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_queue_staff_welcome()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.update_event_rsvp_count()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.update_poll_vote_counts()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.update_session_rsvp_count()                             SET search_path = public, pg_temp;
ALTER FUNCTION public.update_voice_room_counts()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_coupon(text, text, text, numeric)              SET search_path = public, pg_temp;
ALTER FUNCTION public.redeem_coupon(text, text, text, numeric, numeric, numeric, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.verify_admin_password(text, text)                       SET search_path = public, pg_temp;
ALTER FUNCTION public.welcome_new_member()                                    SET search_path = public, pg_temp;


-- ── 2a. Revoke anon EXECUTE — pure trigger functions ──────────────────────
-- These are only ever called by the trigger mechanism (postgres superuser).
-- No direct RPC call should be possible.

REVOKE EXECUTE ON FUNCTION public.audit_on_ban()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_on_join_request()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_on_msg_delete()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_on_mute()              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_create_commission()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_index_group_media()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_disappearing_messages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_mutes()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_ticket_number()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rep_on_message()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rep_on_poll_vote()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rep_on_voice_join()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_message_expiry()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_badge_count()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_org_member_count()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_ajo_group_limit()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_org_limit()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_check_org_member_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_queue_ajo_welcome()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_queue_business_welcome() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_queue_org_member_welcome() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_queue_staff_welcome()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_event_rsvp_count()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_poll_vote_counts()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_session_rsvp_count()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_voice_room_counts()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.welcome_new_member()         FROM PUBLIC;


-- ── 2b. Revoke anon EXECUTE — user functions that require authentication ──
-- Keep callable by authenticated role; anon users have no valid uid anyway.

REVOKE EXECUTE ON FUNCTION public.award_reputation(uuid, uuid, integer, text, uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_org_chat(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_auto_badges(uuid, uuid)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_coupon(text)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_slow_mode(uuid, uuid)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_group_analytics(uuid, integer)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_membership()                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_org()                                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_owner_plan()                                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(text, text)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_plan_usage(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_invite_use(text)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_mod_or_above(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_group_media(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_group_messages(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text, text, numeric)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text, text, text, numeric, numeric, numeric, text) FROM anon;


-- ── 2c. Revoke admin-only functions from all non-service roles ────────────
-- Admin password functions must only be callable by server-side (service_role).

REVOKE EXECUTE ON FUNCTION public.hash_admin_password(text)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_admin_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.hash_admin_password(text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.set_admin_password(uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(text, text) TO service_role;


-- ── 3. Fix overly-permissive RLS policies ─────────────────────────────────

-- admin_transaction_notes: service_role bypasses RLS; drop the always-true policy.
-- Authenticated admin users access via service_role API only.
DROP POLICY IF EXISTS "service_role_all" ON public.admin_transaction_notes;

-- cashback_transactions: scope to the owner's own email rather than all rows.
DROP POLICY IF EXISTS "cashback_all" ON public.cashback_transactions;
CREATE POLICY "cashback_own" ON public.cashback_transactions
  FOR ALL USING (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

-- coop_notifications: drop the always-true service_role policy (service bypasses RLS).
DROP POLICY IF EXISTS "coop_notif_service_all" ON public.coop_notifications;

-- Fix WITH CHECK (true) on member UPDATE — mirror the USING predicate.
DROP POLICY IF EXISTS "coop_notif_member_update" ON public.coop_notifications;
CREATE POLICY "coop_notif_member_update" ON public.coop_notifications
  FOR UPDATE
  USING (
    recipient_type = 'member'
    AND recipient_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    recipient_type = 'member'
    AND recipient_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
  );

-- Fix WITH CHECK (true) on org UPDATE — mirror the USING predicate.
DROP POLICY IF EXISTS "coop_notif_org_update" ON public.coop_notifications;
CREATE POLICY "coop_notif_org_update" ON public.coop_notifications
  FOR UPDATE
  USING (
    recipient_type = 'org'
    AND org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  )
  WITH CHECK (
    recipient_type = 'org'
    AND org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  );

-- welcome_email_queue: server-only queue; drop always-true policy.
DROP POLICY IF EXISTS "service_role_only" ON public.welcome_email_queue;

-- org_meeting_rsvp: replace open-to-all with scoped policies.
DROP POLICY IF EXISTS "rsvp_open" ON public.org_meeting_rsvp;

CREATE POLICY "rsvp_select" ON public.org_meeting_rsvp
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
      UNION
      SELECT id FROM public.organizations
        WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  );

CREATE POLICY "rsvp_own_write" ON public.org_meeting_rsvp
  FOR ALL
  USING (member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid()))
  WITH CHECK (member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid()));

-- org_withdrawal_items: scope to member's own items + org owner full access.
DROP POLICY IF EXISTS "wi_open" ON public.org_withdrawal_items;

CREATE POLICY "wi_items_member" ON public.org_withdrawal_items
  FOR SELECT USING (
    member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "wi_items_org" ON public.org_withdrawal_items
  FOR ALL USING (
    withdrawal_id IN (
      SELECT ow.id FROM public.org_withdrawals ow
      JOIN public.organizations o ON o.id = ow.org_id
      WHERE o.owner_id = auth.uid() OR o.portal_user_id = auth.uid()
    )
  ) WITH CHECK (
    withdrawal_id IN (
      SELECT ow.id FROM public.org_withdrawals ow
      JOIN public.organizations o ON o.id = ow.org_id
      WHERE o.owner_id = auth.uid() OR o.portal_user_id = auth.uid()
    )
  );


-- ── 4. Remove broad listing SELECT policies from public storage buckets ────
-- Public buckets serve files via direct URL without any storage policy.
-- Broad SELECT policies unnecessarily expose the full file listing via the
-- PostgREST /storage/v1/object API. Users can still access any avatar or
-- chat media via its known public URL — that path bypasses these policies.

DROP POLICY IF EXISTS "Public avatars read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_select"      ON storage.objects;
DROP POLICY IF EXISTS "chat_media_select"   ON storage.objects;

-- Authenticated users may list only within their own folder (for upload checks).
CREATE POLICY "avatars_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
