-- ═══════════════════════════════════════════════════════════════
--  KOBO / NAIRA / OGA PLAN RESTRUCTURE
--  Replaces starter/basic/professional/enterprise with 3 Nigerian
--  context plans: Kobo (free), Naira (₦7k/mo), Oga (₦15k/mo).
-- ═══════════════════════════════════════════════════════════════

-- 1. Add billing_cycle to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));

-- 2. Deactivate legacy plans (keep rows for historical data)
UPDATE public.subscription_plans
  SET is_active = false
  WHERE slug IN ('starter', 'basic', 'professional', 'enterprise');

-- 3. Upsert new plans
INSERT INTO public.subscription_plans
  (name, slug, description, price_monthly, price_yearly,
   max_transactions, max_organizations, max_org_members, max_ajo_groups,
   feature_keys, features, sort_order, is_active)
VALUES
  (
    'Kobo', 'kobo',
    'Free forever — get started at your own pace',
    0, 0,
    50, 1, 5, 1,
    '[]'::jsonb,
    '["Basic dashboard","1 organisation","5 team members","50 transactions/month"]'::jsonb,
    0, true
  ),
  (
    'Naira', 'naira',
    'Everything your business needs to grow',
    7000, 75600,
    999999, 5, 50, 10,
    '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches"]'::jsonb,
    '["Unlimited transactions","Ajo savings management","PDF export & reports","Staff management","Inventory tracking","Loyalty program","AI business insights","Branch management"]'::jsonb,
    1, true
  ),
  (
    'Oga', 'oga',
    'Maximum power for serious business owners',
    15000, 171000,
    999999, 20, 200, 50,
    '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches","apiAccess","loanAccess","printWholesale"]'::jsonb,
    '["Everything in Naira","Business loan access","Print airtime wholesale","Print data wholesale","API access","Priority support"]'::jsonb,
    2, true
  )
ON CONFLICT (slug) DO UPDATE SET
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  price_monthly     = EXCLUDED.price_monthly,
  price_yearly      = EXCLUDED.price_yearly,
  max_transactions  = EXCLUDED.max_transactions,
  max_organizations = EXCLUDED.max_organizations,
  max_org_members   = EXCLUDED.max_org_members,
  max_ajo_groups    = EXCLUDED.max_ajo_groups,
  feature_keys      = EXCLUDED.feature_keys,
  features          = EXCLUDED.features,
  sort_order        = EXCLUDED.sort_order,
  is_active         = EXCLUDED.is_active;

-- 4. Create loan_applications table for Oga plan users
CREATE TABLE IF NOT EXISTS public.loan_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           text,
  business_name       text,
  phone               text,
  loan_amount         numeric,
  loan_purpose        text,
  business_type       text,
  years_in_business   text,
  monthly_revenue     numeric,
  status              text DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected')),
  admin_notes         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_apps_insert_own" ON public.loan_applications;
CREATE POLICY "loan_apps_insert_own" ON public.loan_applications
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "loan_apps_read_own" ON public.loan_applications;
CREATE POLICY "loan_apps_read_own" ON public.loan_applications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "loan_apps_admin_all" ON public.loan_applications;
CREATE POLICY "loan_apps_admin_all" ON public.loan_applications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );
