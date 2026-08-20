-- Commission Attribution Backfill Report
-- Purpose: identify subscriptions where the claimant marketer differs from the
--          referred_by_marketer_id that the old trigger would have credited.
-- READ-ONLY — this script makes no changes.
--
-- Usage: supabase db query --linked --file supabase/scripts/commission_attribution_report.sql

SELECT
  s.id                    AS subscription_id,
  s.user_id               AS business_id,
  s.plan,
  s.created_at            AS subscribed_at,

  -- Who the old trigger credited (referred_by_marketer_id)
  ref_m.id                AS referred_marketer_id,
  ref_m.full_name         AS referred_marketer_name,

  -- Who should have been credited (approved claimant)
  claim_m.id              AS claimant_marketer_id,
  claim_m.full_name       AS claimant_marketer_name,

  -- The claim record
  bc.id                   AS claim_id,
  bc.status               AS claim_status,
  bc.created_at           AS claim_created_at,

  -- Any existing commission row for this subscription
  mc.id                   AS existing_commission_id,
  mc.amount               AS existing_commission_amount,
  mc.marketer_id          AS commission_credited_to,
  mc.status               AS commission_status,

  -- Correct commission estimate at 10% new_subscription rate
  CASE s.plan
    WHEN 'naira' THEN 7000
    WHEN 'oga'   THEN 15000
    ELSE 0
  END                     AS plan_price,

  ROUND(
    CASE s.plan
      WHEN 'naira' THEN 7000 * 0.10
      WHEN 'oga'   THEN 15000 * 0.10
      ELSE 0
    END, 2
  )                       AS correct_commission_10pct,

  -- Is the commission credited to the wrong marketer?
  CASE
    WHEN mc.marketer_id IS NULL                  THEN 'NO_COMMISSION'
    WHEN mc.marketer_id = claim_m.id             THEN 'CORRECT'
    WHEN mc.marketer_id != claim_m.id            THEN 'WRONG_MARKETER'
    ELSE 'UNKNOWN'
  END                     AS attribution_status

FROM subscriptions s

-- Referrer (old trigger path)
LEFT JOIN profiles p           ON p.id                       = s.user_id
LEFT JOIN brm_marketers ref_m  ON ref_m.id                   = p.referred_by_marketer_id

-- Claimant (new trigger path)
LEFT JOIN business_claims bc   ON bc.business_id             = s.user_id
                               AND bc.status                  = 'approved'
LEFT JOIN brm_marketers claim_m ON claim_m.id                = bc.marketer_id

-- Any existing subscription commission
LEFT JOIN marketer_commissions mc ON mc.reference            = s.id::TEXT
                                  AND mc.type                 = 'subscription'

WHERE
  -- Only rows where a claimant exists AND differs from the referrer
  bc.marketer_id IS NOT NULL
  AND p.referred_by_marketer_id IS NOT NULL
  AND bc.marketer_id != p.referred_by_marketer_id

ORDER BY
  CASE
    WHEN mc.marketer_id IS NOT NULL AND mc.marketer_id != claim_m.id THEN 0
    WHEN mc.marketer_id IS NULL THEN 1
    ELSE 2
  END,
  s.created_at DESC;
