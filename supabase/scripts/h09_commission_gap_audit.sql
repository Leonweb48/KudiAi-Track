-- H-09: Plan-slug gap audit
-- Finds subscriptions to naira/oga plans that have no corresponding
-- marketer commission row, within the gap window:
--   Start: ~2026-07-27 (kobo/naira/oga plans introduced)
--   End:   when 20260828000002_fix_commission_plan_slugs.sql was applied
--
-- Run: supabase db query --linked --file supabase/scripts/h09_commission_gap_audit.sql
-- If rows come back, decide: backfill (INSERT into marketer_commissions) or waive.

SELECT
  s.id           AS subscription_id,
  s.user_id      AS business_id,
  p.business_name,
  s.plan,
  s.created_at   AS subscribed_at,
  m.id           AS marketer_id,
  m.full_name    AS marketer_name,
  mc.id          AS commission_id   -- NULL = gap: no commission was created
FROM subscriptions s
JOIN profiles      p ON p.id = s.user_id
JOIN profiles      rp ON rp.id = s.user_id                            -- same row, for marketer FK
JOIN brm_marketers m  ON m.id  = (
  SELECT bm.id FROM brm_marketers bm
  WHERE bm.id = rp.referred_by_marketer_id AND bm.status = 'active'
  LIMIT 1
)
LEFT JOIN marketer_commissions mc
  ON mc.business_id = s.user_id
  AND mc.type = 'subscription'
  AND mc.reference = s.id::TEXT
WHERE s.plan IN ('naira', 'oga')
  AND s.created_at >= '2026-07-27 00:00:00+00'
  AND mc.id IS NULL                  -- no commission row exists
ORDER BY s.created_at;

-- ── Backfill template (run ONLY after reviewing the above output) ────────────
-- For each row above, create the missing commission using the current config.
-- Uncomment and adapt:
--
-- INSERT INTO marketer_commissions
--   (marketer_id, business_id, config_id, type, amount, status, reference)
-- SELECT
--   m.id,
--   s.user_id,
--   cfg.id,
--   'subscription',
--   CASE s.plan WHEN 'naira' THEN 7000 WHEN 'oga' THEN 15000 ELSE 0 END
--     * CASE cfg.is_percentage WHEN true THEN cfg.percentage ELSE 1 END,
--   'pending',
--   s.id::TEXT
-- FROM subscriptions s
-- JOIN profiles p ON p.id = s.user_id
-- JOIN brm_marketers m ON m.id = p.referred_by_marketer_id AND m.status = 'active'
-- LEFT JOIN marketer_commissions mc ON mc.reference = s.id::TEXT AND mc.type = 'subscription'
-- JOIN LATERAL (
--   SELECT * FROM marketer_commission_config
--   WHERE type = 'subscription' AND is_active = true
--     AND (plan = s.plan OR plan IS NULL)
--   ORDER BY plan NULLS LAST LIMIT 1
-- ) cfg ON true
-- WHERE s.plan IN ('naira', 'oga')
--   AND s.created_at >= '2026-07-27 00:00:00+00'
--   AND mc.id IS NULL;
