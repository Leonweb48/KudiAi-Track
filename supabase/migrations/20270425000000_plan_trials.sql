-- Plan trials (owner's request, 2026-10-25): the admin dashboard gives a business owner a free trial of any paid plan —
-- 5 days by default (1–30), granted, listed and ended early from the admin portal only.
--   - The owner is put on that plan straight away; their previous plan is remembered.
--   - A day before the end they're reminded; at the end they go straight back to the previous plan (no 3-day grace —
--     that is for paid plans), with a notice. The paid-plan sweep leaves trial rows alone.
--   - Paying for a plan during the trial (wallet, card, coupon) turns it into a normal paid plan — the trial is over.
--   - An owner on a running PAID plan can't be given a trial (it would overwrite what they paid for); one trial running
--     at a time per owner. Every trial is kept in plan_trials (who granted it, when, how it ended).
--   - Owners can never set the trial fields themselves (an owner editing "previous plan" to a paid one would keep it).
-- Server only: the admin portal calls these with the service key.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_trial            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_previous_plan text,
  ADD COLUMN IF NOT EXISTS trial_id            uuid;

CREATE TABLE IF NOT EXISTS public.plan_trials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        text        NOT NULL,
  days        integer     NOT NULL CHECK (days BETWEEN 1 AND 30),
  granted_by  text        NOT NULL,
  note        text        CHECK (note IS NULL OR length(note) <= 300),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  ended_at    timestamptz,
  end_reason  text        CHECK (end_reason IS NULL OR end_reason IN ('expired', 'ended_by_admin', 'converted_to_paid', 'ended_by_owner')),
  ended_by    text,
  reminded_1d boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS plan_trials_user_idx   ON public.plan_trials (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS plan_trials_active_idx ON public.plan_trials (ends_at) WHERE ended_at IS NULL;
ALTER TABLE public.plan_trials ENABLE ROW LEVEL SECURITY;   -- no policies: server only
REVOKE ALL ON TABLE public.plan_trials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_trials TO service_role;

-- ── the trial fields: owners can't touch them; a payment (or a downgrade) during a trial ends it ─────────────────────
CREATE OR REPLACE FUNCTION public.guard_plan_trial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER   -- must see who is writing
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('kudi.trial_write', true) = '1' THEN RETURN NEW; END IF;   -- the trial functions themselves
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('authenticated', 'anon') THEN
      NEW.is_trial := false; NEW.trial_previous_plan := NULL; NEW.trial_id := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.is_trial := OLD.is_trial; NEW.trial_previous_plan := OLD.trial_previous_plan; NEW.trial_id := OLD.trial_id;
  END IF;
  -- a trial's plan or end date changed by anything but the trial functions = a payment (or the owner going to Free)
  IF OLD.is_trial AND (NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.plan IS DISTINCT FROM OLD.plan) THEN
    UPDATE public.plan_trials
       SET ended_at = now(), end_reason = CASE WHEN public.is_free_plan(NEW.plan) THEN 'ended_by_owner' ELSE 'converted_to_paid' END
     WHERE id = OLD.trial_id AND ended_at IS NULL;
    NEW.is_trial := false; NEW.trial_previous_plan := NULL; NEW.trial_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_plan_trial_fields ON public.subscriptions;
CREATE TRIGGER trg_guard_plan_trial_fields BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_plan_trial_fields();

-- ── grant ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_grant_plan_trial(p_user_id uuid, p_plan text, p_days integer, p_admin text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_name text;
  v_sub       public.subscriptions%ROWTYPE;
  v_prev      text := 'kobo';
  v_trial     uuid;
  v_ends      timestamptz;
  v_before    int;
BEGIN
  IF p_user_id IS NULL OR coalesce(trim(p_admin), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Owner and admin are required'); END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN RETURN jsonb_build_object('ok', false, 'error', 'A trial is 1 to 30 days'); END IF;
  SELECT name INTO v_plan_name FROM public.subscription_plans WHERE slug = p_plan AND is_active;
  IF v_plan_name IS NULL OR public.is_free_plan(p_plan) THEN RETURN jsonb_build_object('ok', false, 'error', 'Choose an active paid plan'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RETURN jsonb_build_object('ok', false, 'error', 'Not a business owner account'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_trial:' || p_user_id));
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id
   ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND v_sub.status = 'active' THEN
    IF v_sub.is_trial THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This owner already has a trial running — end it first');
    END IF;
    IF NOT public.is_free_plan(v_sub.plan) AND (v_sub.expires_at IS NULL OR v_sub.expires_at > now()) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This owner is on a paid plan — a trial would overwrite what they paid for');
    END IF;
    IF public.is_free_plan(v_sub.plan) THEN v_prev := v_sub.plan; END IF;
  END IF;

  SELECT count(*) INTO v_before FROM public.plan_trials WHERE user_id = p_user_id;
  v_ends := now() + make_interval(days => p_days);
  INSERT INTO public.plan_trials (user_id, plan, days, granted_by, note, ends_at)
  VALUES (p_user_id, p_plan, p_days, left(p_admin, 120), nullif(left(trim(coalesce(p_note, '')), 300), ''), v_ends)
  RETURNING id INTO v_trial;

  PERFORM set_config('kudi.allow_plan_write', '1', true);
  PERFORM set_config('kudi.trial_write', '1', true);
  IF v_sub.id IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = p_plan, status = 'active', expires_at = v_ends, billing_cycle = 'monthly', paystack_reference = NULL,
      cancel_at_period_end = false, cancelled_at = NULL, grace_until = NULL,
      reminded_3d_for = NULL, reminded_1d_for = NULL, ended_notice_for = NULL,
      is_trial = true, trial_previous_plan = v_prev, trial_id = v_trial
    WHERE id = v_sub.id;
  ELSE
    INSERT INTO public.subscriptions (user_id, plan, status, expires_at, billing_cycle, is_trial, trial_previous_plan, trial_id)
    VALUES (p_user_id, p_plan, 'active', v_ends, 'monthly', true, v_prev, v_trial);
  END IF;
  PERFORM set_config('kudi.trial_write', '', true);

  PERFORM public.subscription_expiry_note(p_user_id, 'plan_trial_started', format('Your free %s trial has started', v_plan_name),
    format('Enjoy every %s feature free for %s day%s, until %s. Renew any time to keep them after the trial.',
           v_plan_name, p_days, CASE WHEN p_days = 1 THEN '' ELSE 's' END, to_char(v_ends AT TIME ZONE 'Africa/Lagos', 'FMDD Mon YYYY')),
    'plan_trial:' || v_trial);
  RETURN jsonb_build_object('ok', true, 'trial_id', v_trial, 'ends_at', v_ends, 'plan', p_plan, 'previous_trials', v_before);
END $$;

-- ── end (early, by the admin — or at the end date, by the sweep) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_trial_finish(p_user_id uuid, p_reason text, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub  public.subscriptions%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id AND is_trial AND status = 'active'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No trial running for this owner'); END IF;
  SELECT coalesce(name, initcap(v_sub.plan)) INTO v_name FROM public.subscription_plans WHERE slug = v_sub.plan;

  PERFORM set_config('kudi.allow_plan_write', '1', true);
  PERFORM set_config('kudi.trial_write', '1', true);
  UPDATE public.subscriptions SET
    plan = coalesce(v_sub.trial_previous_plan, 'kobo'), expires_at = NULL, grace_until = NULL,
    cancel_at_period_end = false, cancelled_at = NULL, is_trial = false, trial_previous_plan = NULL, trial_id = NULL
  WHERE id = v_sub.id;
  UPDATE public.plan_trials SET ended_at = now(), end_reason = p_reason, ended_by = p_by
   WHERE id = v_sub.trial_id AND ended_at IS NULL;
  PERFORM set_config('kudi.trial_write', '', true);

  PERFORM public.subscription_expiry_note(p_user_id, 'plan_trial_ended', format('Your %s trial has ended', coalesce(v_name, 'plan')),
    format('Your account is back on your previous plan. Your records are all still here — renew %s any time to get its features back.', coalesce(v_name, 'the plan')),
    'plan_trial_end:' || coalesce(v_sub.trial_id::text, v_sub.id::text));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_end_plan_trial(p_user_id uuid, p_admin text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.plan_trial_finish(p_user_id, 'ended_by_admin', left(p_admin, 120)); $$;

-- ── hourly: the day-before reminder, and the end ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_trial_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record; v_ended int := 0; v_reminded int := 0;
BEGIN
  FOR r IN
    SELECT s.user_id, s.expires_at, s.trial_id, coalesce(p.name, initcap(s.plan)) AS plan_name, t.reminded_1d
      FROM public.subscriptions s
      LEFT JOIN public.subscription_plans p ON p.slug = s.plan
      LEFT JOIN public.plan_trials t ON t.id = s.trial_id
     WHERE s.is_trial AND s.status = 'active' AND s.expires_at IS NOT NULL
  LOOP
    IF r.expires_at <= now() THEN
      PERFORM public.plan_trial_finish(r.user_id, 'expired', 'system');
      v_ended := v_ended + 1;
    ELSIF r.expires_at <= now() + interval '1 day' AND NOT coalesce(r.reminded_1d, false) THEN
      PERFORM public.subscription_expiry_note(r.user_id, 'plan_ending', format('Your %s trial ends tomorrow', r.plan_name),
        format('Your free %s trial ends on %s. Renew now to keep its features without a break — your records stay either way.',
               r.plan_name, to_char(r.expires_at AT TIME ZONE 'Africa/Lagos', 'FMDD Mon YYYY')),
        'plan_trial_1d:' || coalesce(r.trial_id::text, r.user_id::text));
      UPDATE public.plan_trials SET reminded_1d = true WHERE id = r.trial_id;
      v_reminded := v_reminded + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ended', v_ended, 'reminded', v_reminded);
END $$;

REVOKE ALL ON FUNCTION public.admin_grant_plan_trial(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_trial_finish(uuid, text, text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_end_plan_trial(uuid, text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_trial_sweep()                                      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_plan_trial(uuid, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_end_plan_trial(uuid, text)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_trial_sweep()                                      TO service_role;

-- ── the paid-plan sweep leaves trials alone (edited in place; stops if the text isn't found exactly once) ─────────────
DO $mig$
DECLARE v_def text; n int;
  o constant text := 'WHERE s.status = ''active'' AND s.expires_at IS NOT NULL AND NOT public.is_free_plan(s.plan)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'subscription_expiry_sweep';
  IF position('AND NOT coalesce(s.is_trial, false)' IN v_def) > 0 THEN RAISE NOTICE 'trials | expiry sweep already skips trials'; RETURN; END IF;
  n := (length(v_def) - length(replace(v_def, o, ''))) / length(o);
  IF n <> 1 THEN RAISE EXCEPTION 'subscription_expiry_sweep: filter found % times — refusing to guess', n; END IF;
  EXECUTE replace(v_def, o, o || ' AND NOT coalesce(s.is_trial, false)   -- trials end in plan_trial_sweep (no grace)');
  RAISE NOTICE 'trials | expiry sweep now skips trials';
END $mig$;

DO $$
BEGIN
  PERFORM cron.unschedule('plan-trial-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plan-trial-sweep');
  PERFORM cron.schedule('plan-trial-sweep', '17 * * * *', 'SELECT public.plan_trial_sweep();');
  RAISE NOTICE 'trials | plan-trial-sweep scheduled hourly at :17';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trials | sweep not scheduled: %', SQLERRM;
END $$;
