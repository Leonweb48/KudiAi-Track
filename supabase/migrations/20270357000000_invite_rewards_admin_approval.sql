-- Invite & Earn: admin approval before any reward is paid (owner's rule 2026-10-18: "It should notify the admin of the
-- completion and the admin verify and approve").
--
-- Until now invite_process paid the inviter's reward and the friend's welcome bonus from the settlement wallet the
-- moment the friend qualified. Now:
--   1. When an invite qualifies, it is marked review_status = 'pending', every admin gets an admin notification (link
--      /referrals) and the inviter is told the reward is being checked. Nothing is paid.
--   2. invite_admin_review(invite, approve, admin, note) — admin portal only (service role):
--        approve → review_status 'approved' and the rewards are paid at once (or as soon as settlement is funded —
--                  invite_process keeps retrying approved, unpaid invites every 10 minutes);
--        reject  → the invite is 'rejected' (reason 'admin_rejected' + the admin's note), nothing more is paid, the
--                  inviter is told.
--   3. invite_process only pays invites whose review_status is 'approved' (edited in place, one condition).
--   4. Invites already qualified and still owed money go to 'pending' review now (one admin notification).

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS review_status text CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by   text,
  ADD COLUMN IF NOT EXISTS review_note   text;

-- ── 1. qualify → pending review + tell the admins and the inviter ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_review_on_qualify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inviter text; v_friend text;
BEGIN
  IF NEW.status = 'qualified' AND OLD.status IS DISTINCT FROM 'qualified' AND NEW.review_status IS NULL THEN
    NEW.review_status := 'pending';
    BEGIN
      v_inviter := invite_display_name(NEW.inviter_id);
      v_friend  := invite_display_name(NEW.friend_id);
      INSERT INTO admin_notifications (type, category, title, message, link, metadata)
      VALUES ('info', 'finance', 'Invite & Earn reward to approve',
        format('%s invited %s (%s), who opened a wallet and spent ₦%s. Check it on Referrals, then approve or reject. Nothing is paid until you approve (inviter ₦%s, friend bonus ₦%s).',
               COALESCE(NULLIF(v_inviter, ''), 'A user'), COALESCE(NULLIF(v_friend, ''), 'a new user'), NEW.friend_portal,
               to_char(NEW.spent_kobo / 100.0, 'FM999,999,990'), to_char(NEW.inviter_reward_kobo / 100.0, 'FM999,999,990'),
               to_char(NEW.friend_reward_kobo / 100.0, 'FM999,999,990')),
        '/referrals', jsonb_build_object('invite_id', NEW.id, 'inviter_id', NEW.inviter_id, 'friend_id', NEW.friend_id));
      PERFORM invite_notify(NEW.inviter_id, 'invite_under_review', 'milestone',
        invite_short_name(v_friend) || ' qualified 🎉',
        'We''re checking this invite. Your reward will be paid into your wallet once it is approved.',
        'invite_review_' || NEW.id, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'invite review notice skipped: %', SQLERRM;   -- a notification must never block the update
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invite_review_on_qualify ON public.invites;
CREATE TRIGGER trg_invite_review_on_qualify BEFORE UPDATE OF status ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.invite_review_on_qualify();

-- ── 3. invite_process pays only approved invites ───────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_old constant text := 'IF r.status = ''qualified'' THEN';
  v_new constant text := 'IF r.status = ''qualified'' AND r.review_status = ''approved'' THEN   -- admin-approved only (2026-10-18)';
  n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'invite_process';
  IF v_def IS NULL THEN RAISE EXCEPTION 'invite_process not found'; END IF;
  IF position('admin-approved only (2026-10-18)' IN v_def) > 0 THEN RAISE NOTICE 'invite-approval | already applied'; RETURN; END IF;
  n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF n <> 1 THEN RAISE EXCEPTION 'invite-approval: pay condition found % times — refusing to guess', n; END IF;
  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'invite-approval | invite_process now pays approved invites only';
END $mig$;

-- ── 2. the admin's decision ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_admin_review(p_invite_id uuid, p_approve boolean, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r invites; v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 300), '');
BEGIN
  SELECT * INTO r FROM invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Invite not found'); END IF;
  IF r.status <> 'qualified' OR r.review_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invite is not waiting for review');
  END IF;

  IF NOT p_approve THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Give a reason for rejecting'); END IF;
    UPDATE invites SET status = 'rejected', review_status = 'rejected', reject_reason = 'admin_rejected',
           reviewed_at = now(), reviewed_by = left(p_admin, 80), review_note = v_note, updated_at = now()
     WHERE id = r.id;
    PERFORM invite_notify(r.inviter_id, 'invite_rejected', 'milestone', 'Invite reward not approved',
      'After review, the reward for ' || invite_short_name(invite_display_name(r.friend_id)) ||
      ' wasn''t approved. Contact support from Help if you think this is a mistake.',
      'invite_rejected_' || r.id, false);
    RETURN jsonb_build_object('ok', true, 'approved', false);
  END IF;

  UPDATE invites SET review_status = 'approved', reviewed_at = now(), reviewed_by = left(p_admin, 80),
         review_note = v_note, updated_at = now()
   WHERE id = r.id;
  PERFORM invite_process(r.friend_id);           -- pays now if the settlement wallet can cover it, else the cron retries
  SELECT * INTO r FROM invites WHERE id = p_invite_id;
  RETURN jsonb_build_object('ok', true, 'approved', true, 'status', r.status,
    'inviter_paid', r.inviter_paid_at IS NOT NULL OR r.inviter_reward_kobo = 0,
    'friend_paid',  r.friend_paid_at IS NOT NULL OR r.friend_reward_kobo = 0);
END $$;

REVOKE ALL ON FUNCTION public.invite_admin_review(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_admin_review(uuid, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.invite_review_on_qualify() FROM PUBLIC, anon, authenticated;

-- invite_process was re-created in place: keep it server-only, as before
DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.invite_process(uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.invite_process(uuid) TO service_role';
END $grants$;

-- ── 4. invites already qualified and still owed → pending review ───────────────────────────────────────────────
DO $backlog$
DECLARE n int;
BEGIN
  UPDATE invites SET review_status = 'pending'
   WHERE status = 'qualified' AND review_status IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE invites SET review_status = 'approved', reviewed_by = 'auto (before admin approval)'
   WHERE status = 'rewarded' AND review_status IS NULL;
  IF n > 0 THEN
    INSERT INTO admin_notifications (type, category, title, message, link, metadata)
    VALUES ('info', 'finance', 'Invite & Earn rewards to approve',
            n || ' qualified invite(s) are waiting for your approval. Check them on Referrals, then approve or reject — nothing is paid until you approve.',
            '/referrals', jsonb_build_object('count', n));
  END IF;
  RAISE NOTICE 'invite-approval | qualified invites now pending review: %', n;
END $backlog$;
