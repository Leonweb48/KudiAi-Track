-- ═════════════════════════════════════════════════════════════════════════════
-- ClubKonnect pricing + pre-flight config
--
--  • ck_discounts            JSON of provider wholesale discounts, refreshed from
--                            ClubKonnect by the `refresh-ck-prices` edge action.
--  • ck_discounts_updated    ISO timestamp of the last refresh.
--  • enterprise_bill_fee_pct platform fee added on top of the CK cost for
--                            Enterprise-plan owners (0.01 = 1%). Non-Enterprise
--                            users keep the existing retail pricing.
--  • ck_wallet_min_buffer    naira kept spare on top of an order's CK cost when
--                            deciding whether the provider wallet can cover it.
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_config (key, value, description) VALUES
  ('ck_discounts', '{}',
   'ClubKonnect wholesale discount rates (JSON), refreshed by the refresh-ck-prices edge action.'),
  ('ck_discounts_updated', '',
   'ISO timestamp of the last ck_discounts refresh.'),
  ('enterprise_bill_fee_pct', '0.01',
   'Platform fee added on top of the ClubKonnect cost for Enterprise-plan owners (0.01 = 1%).'),
  ('ck_wallet_min_buffer', '0',
   'Naira kept spare above an order''s CK cost when checking the provider wallet.')
ON CONFLICT (key) DO NOTHING;

-- Admins may edit these from the portal (service role already bypasses RLS).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_config' AND policyname = 'admin_write_platform_config'
  ) THEN
    CREATE POLICY "admin_write_platform_config"
      ON public.platform_config FOR ALL TO authenticated
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;
