-- ═════════════════════════════════════════════════════════════════════════════
-- Business-owner subscriptions: bank-transfer payment + admin approval
--
-- Paid plan changes no longer take effect on payment. The owner pays by Paystack
-- bank transfer; a `subscription_upgrade` row lands in admin_approval_requests;
-- an admin verifies the payment and approves; only then is the subscription
-- upgraded. Free plans (price 0 / kobo / starter) still activate instantly.
--
-- Defence in depth: a trigger blocks any end-user session from moving its own
-- subscription onto a paid plan directly — the approval RPC is the only path.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Widen the approval-request type constraint ────────────────────────────
ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;
ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
  CHECK (request_type IN (
    'group_edit','group_delete','credit_delete','client_archive','org_archive',
    'client_reactivation','org_member_reactivation','org_reactivation',
    'subscription_upgrade'
  ));

-- ── 2. Helper: is this plan slug a free plan? ────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_free_plan(p_slug TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_slug IS NULL
      OR lower(p_slug) IN ('kobo','starter','free')
      OR lower(p_slug) LIKE '%starter%'
      OR EXISTS (
           SELECT 1 FROM public.subscription_plans
           WHERE slug = p_slug AND COALESCE(price_monthly, 0) = 0
         );
$$;
GRANT EXECUTE ON FUNCTION public.is_free_plan(TEXT) TO authenticated, anon, service_role;

-- ── 3. Trigger: end users may not self-upgrade to a paid plan ────────────────
CREATE OR REPLACE FUNCTION public.guard_subscription_plan_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  -- Only guard genuine end-user (authenticated) sessions. service_role, the
  -- SECURITY DEFINER approval RPCs (which set kudi.allow_plan_write), migrations
  -- and the dashboard all pass straight through.
  IF v_role <> 'authenticated'
     OR current_setting('kudi.allow_plan_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_free_plan(NEW.plan) THEN
      RAISE EXCEPTION 'Paid plans require admin approval — pay by bank transfer and wait for confirmation'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: allow cancellation toggles and downgrades to a free plan; block any
  -- move to or between paid plans, and any paid re-activation.
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.is_free_plan(NEW.plan) THEN
    RAISE EXCEPTION 'Plan upgrades require admin approval'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'active'
     AND NOT public.is_free_plan(NEW.plan)
     AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Plan activation requires admin approval'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subscription_plan ON public.subscriptions;
CREATE TRIGGER trg_guard_subscription_plan
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_plan_writes();

-- ── 4. Replace the broad owner RLS with narrower insert/update ───────────────
DROP POLICY IF EXISTS "own subscriptions"                 ON public.subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;

-- SELECT for owners is still covered by "Users can view own subscriptions" and
-- "staff_read_owner_subscription". Owners keep INSERT/UPDATE on their own row
-- (needed for onboarding, free-plan selection and cancellation) but the trigger
-- above rejects any paid-plan change. No DELETE policy — rows are never removed.
CREATE POLICY "owner_insert_own_subscription" ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_own_subscription" ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 5. activate_free_subscription — owner-callable, free plans only ──────────
CREATE OR REPLACE FUNCTION public.activate_free_subscription(p_plan_slug TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_existing UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_free_plan(p_plan_slug) THEN
    RAISE EXCEPTION 'activate_free_subscription only accepts free plans (got %)', p_plan_slug;
  END IF;

  PERFORM set_config('kudi.allow_plan_write', '1', true);

  SELECT id INTO v_existing FROM public.subscriptions
   WHERE user_id = v_uid
   ORDER BY (status = 'active') DESC, created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = p_plan_slug, status = 'active', expires_at = NULL,
      cancel_at_period_end = false, cancelled_at = NULL
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.subscriptions(user_id, plan, status, billing_cycle)
    VALUES (v_uid, p_plan_slug, 'active', 'monthly');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(TEXT) TO authenticated;

-- ── 6. submit_subscription_upgrade_request — owner-callable ─────────────────
CREATE OR REPLACE FUNCTION public.submit_subscription_upgrade_request(
  p_plan_slug     TEXT,
  p_billing_cycle TEXT    DEFAULT 'monthly',
  p_amount        NUMERIC DEFAULT 0,
  p_reference     TEXT    DEFAULT '',
  p_coupon        JSONB   DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_business TEXT;
  v_id       UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public.is_free_plan(p_plan_slug) THEN
    RAISE EXCEPTION 'Free plans do not require approval';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE slug = p_plan_slug AND is_active) THEN
    RAISE EXCEPTION 'Unknown or inactive plan: %', p_plan_slug;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_approval_requests
    WHERE requester = v_uid AND request_type = 'subscription_upgrade' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a subscription request awaiting approval';
  END IF;
  IF p_reference <> '' AND EXISTS (
    SELECT 1 FROM public.admin_approval_requests
    WHERE request_type = 'subscription_upgrade' AND payload ->> 'reference' = p_reference
  ) THEN
    RAISE EXCEPTION 'This payment reference has already been submitted';
  END IF;

  SELECT business_name INTO v_business FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_approval_requests(
    request_type, requester, business, target_id, payload, reason, status
  ) VALUES (
    'subscription_upgrade', v_uid, COALESCE(v_business, ''), v_uid,
    jsonb_build_object(
      'plan_slug',     p_plan_slug,
      'billing_cycle', COALESCE(p_billing_cycle, 'monthly'),
      'amount',        p_amount,
      'reference',     p_reference,
      'coupon',        p_coupon,
      'submitted_at',  now()
    ),
    'Subscription payment — awaiting admin confirmation',
    'pending'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_subscription_upgrade_request(TEXT, TEXT, NUMERIC, TEXT, JSONB) TO authenticated;

-- ── 7. execute_subscription_upgrade — service-role only (admin API) ─────────
CREATE OR REPLACE FUNCTION public.execute_subscription_upgrade(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req      public.admin_approval_requests%ROWTYPE;
  v_plan     TEXT;
  v_cycle    TEXT;
  v_ref      TEXT;
  v_expires  TIMESTAMPTZ;
  v_existing UUID;
BEGIN
  SELECT * INTO v_req FROM public.admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status;
  END IF;
  IF v_req.request_type <> 'subscription_upgrade' THEN
    RAISE EXCEPTION 'Request type mismatch (got: %)', v_req.request_type;
  END IF;

  v_plan  := v_req.payload ->> 'plan_slug';
  v_cycle := COALESCE(v_req.payload ->> 'billing_cycle', 'monthly');
  v_ref   := COALESCE(v_req.payload ->> 'reference', '');
  v_expires := now() + (CASE WHEN v_cycle = 'yearly' THEN interval '365 days' ELSE interval '30 days' END);

  IF v_plan IS NULL OR v_plan = '' THEN RAISE EXCEPTION 'Request payload has no plan_slug'; END IF;

  PERFORM set_config('kudi.allow_plan_write', '1', true);

  SELECT id INTO v_existing FROM public.subscriptions
   WHERE user_id = v_req.requester
   ORDER BY (status = 'active') DESC, created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = v_plan, status = 'active',
      paystack_reference = NULLIF(v_ref, ''),
      expires_at = v_expires, billing_cycle = v_cycle,
      cancel_at_period_end = false, cancelled_at = NULL
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.subscriptions(user_id, plan, status, paystack_reference, expires_at, billing_cycle)
    VALUES (v_req.requester, v_plan, 'active', NULLIF(v_ref, ''), v_expires, v_cycle);
  END IF;

  UPDATE public.admin_approval_requests SET
    status = 'approved', decided_at = now(), decided_by = p_admin_id, decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_subscription_upgrade(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_subscription_upgrade(UUID, UUID, TEXT) TO service_role;
