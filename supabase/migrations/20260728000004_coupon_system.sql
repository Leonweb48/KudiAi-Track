-- ═══════════════════════════════════════════════════════════════
--  COUPON SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Coupons table ────────────────────────────────────────────
CREATE TABLE public.coupons (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT          NOT NULL,
  type           TEXT          NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value          NUMERIC(10,2) NOT NULL CHECK (value > 0),
  applies_to     TEXT[]        NOT NULL DEFAULT '{}',
  billing_cycles TEXT[]        NOT NULL DEFAULT '{}',
  max_uses       INTEGER,
  used_count     INTEGER       NOT NULL DEFAULT 0,
  one_per_user   BOOLEAN       NOT NULL DEFAULT TRUE,
  min_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  valid_from     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valid_until    TIMESTAMPTZ,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  description    TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_coupons_code   ON public.coupons (UPPER(code));
CREATE INDEX         idx_coupons_active ON public.coupons (is_active, valid_until);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons_read_all"      ON public.coupons FOR SELECT USING (true);
CREATE POLICY "coupons_service_write" ON public.coupons FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Redemptions table ─────────────────────────────────────────
CREATE TABLE public.coupon_redemptions (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id          UUID          NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id            UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_slug          TEXT          NOT NULL,
  billing_cycle      TEXT          NOT NULL,
  original_amount    NUMERIC(10,2) NOT NULL,
  discount_amount    NUMERIC(10,2) NOT NULL,
  final_amount       NUMERIC(10,2) NOT NULL,
  paystack_reference TEXT,
  redeemed_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupon_red_coupon ON public.coupon_redemptions (coupon_id, redeemed_at DESC);
CREATE INDEX idx_coupon_red_user   ON public.coupon_redemptions (user_id,    redeemed_at DESC);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupon_red_own_read"   ON public.coupon_redemptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "coupon_red_own_insert" ON public.coupon_redemptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "coupon_red_service"    ON public.coupon_redemptions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. check_coupon — lightweight "Apply" button check ──────────
CREATE OR REPLACE FUNCTION public.check_coupon(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  vc     public.coupons%ROWTYPE;
  v_used INT := 0;
BEGIN
  SELECT * INTO vc FROM public.coupons WHERE UPPER(code) = UPPER(p_code);

  IF NOT FOUND              THEN RETURN jsonb_build_object('valid', false, 'message', 'Invalid coupon code'); END IF;
  IF NOT vc.is_active       THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is no longer active'); END IF;
  IF vc.valid_from > NOW()  THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is not active yet'); END IF;
  IF vc.valid_until IS NOT NULL AND vc.valid_until < NOW()
                            THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has expired'); END IF;
  IF vc.max_uses IS NOT NULL AND vc.used_count >= vc.max_uses
                            THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit'); END IF;

  IF vc.one_per_user AND auth.uid() IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used FROM public.coupon_redemptions
    WHERE coupon_id = vc.id AND user_id = auth.uid();
    IF v_used > 0 THEN RETURN jsonb_build_object('valid', false, 'message', 'You have already used this coupon'); END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid',          true,
    'coupon_id',      vc.id,
    'code',           vc.code,
    'type',           vc.type,
    'value',          vc.value,
    'applies_to',     to_jsonb(vc.applies_to),
    'billing_cycles', to_jsonb(vc.billing_cycles),
    'min_amount',     vc.min_amount,
    'description',    COALESCE(vc.description, ''),
    'message',        'Coupon applied!'
  );
END;
$$;

-- ── 4. validate_coupon — full check + discount calculation ─────────
CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_code          TEXT,
  p_plan_slug     TEXT,
  p_billing_cycle TEXT,
  p_amount        NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  vc         public.coupons%ROWTYPE;
  v_discount NUMERIC;
  v_final    NUMERIC;
  v_used     INT := 0;
BEGIN
  SELECT * INTO vc FROM public.coupons WHERE UPPER(code) = UPPER(p_code);

  IF NOT FOUND        THEN RETURN jsonb_build_object('valid', false, 'message', 'Invalid coupon code'); END IF;
  IF NOT vc.is_active THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is no longer active'); END IF;
  IF vc.valid_until IS NOT NULL AND vc.valid_until < NOW()
                      THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has expired'); END IF;
  IF vc.max_uses IS NOT NULL AND vc.used_count >= vc.max_uses
                      THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit'); END IF;

  IF array_length(vc.applies_to, 1) > 0 AND NOT (p_plan_slug = ANY(vc.applies_to)) THEN
    RETURN jsonb_build_object('valid', false, 'message', 'This coupon is not valid for this plan');
  END IF;

  IF array_length(vc.billing_cycles, 1) > 0 AND NOT (p_billing_cycle = ANY(vc.billing_cycles)) THEN
    RETURN jsonb_build_object('valid', false, 'message',
      'This coupon is only valid for ' || vc.billing_cycles[1] || ' billing');
  END IF;

  IF p_amount < vc.min_amount THEN
    RETURN jsonb_build_object('valid', false, 'message',
      format('This coupon requires a minimum amount of ₦%s', to_char(vc.min_amount, 'FM999,999,990')));
  END IF;

  IF vc.one_per_user AND auth.uid() IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used FROM public.coupon_redemptions
    WHERE coupon_id = vc.id AND user_id = auth.uid();
    IF v_used > 0 THEN RETURN jsonb_build_object('valid', false, 'message', 'You have already used this coupon'); END IF;
  END IF;

  v_discount := CASE WHEN vc.type = 'percentage'
    THEN ROUND(p_amount * vc.value / 100, 2)
    ELSE LEAST(vc.value, p_amount) END;
  v_final := GREATEST(0, p_amount - v_discount);

  RETURN jsonb_build_object(
    'valid',           true,
    'coupon_id',       vc.id,
    'type',            vc.type,
    'value',           vc.value,
    'discount_amount', v_discount,
    'final_amount',    v_final,
    'message',         CASE WHEN vc.type = 'percentage'
      THEN format('%s%% off — you save ₦%s', vc.value::INT, to_char(v_discount, 'FM999,999,990'))
      ELSE format('₦%s discount applied!', to_char(v_discount, 'FM999,999,990')) END
  );
END;
$$;

-- ── 5. redeem_coupon — called after payment success ───────────────
CREATE OR REPLACE FUNCTION public.redeem_coupon(
  p_code            TEXT,
  p_plan_slug       TEXT,
  p_billing_cycle   TEXT,
  p_original_amount NUMERIC,
  p_discount_amount NUMERIC,
  p_final_amount    NUMERIC,
  p_reference       TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  vc public.coupons%ROWTYPE;
BEGIN
  SELECT * INTO vc FROM public.coupons WHERE UPPER(code) = UPPER(p_code);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'Coupon not found'); END IF;

  INSERT INTO public.coupon_redemptions
    (coupon_id, user_id, plan_slug, billing_cycle, original_amount, discount_amount, final_amount, paystack_reference)
  VALUES
    (vc.id, auth.uid(), p_plan_slug, p_billing_cycle, p_original_amount, p_discount_amount, p_final_amount, p_reference);

  UPDATE public.coupons SET used_count = used_count + 1 WHERE id = vc.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
