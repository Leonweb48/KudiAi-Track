-- Add feature_keys column to subscription_plans and populate enterprise plan
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS feature_keys jsonb DEFAULT '[]';

UPDATE public.subscription_plans SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches","apiAccess"]'
  WHERE slug = 'enterprise';

UPDATE public.subscription_plans SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches"]'
  WHERE slug = 'professional';

UPDATE public.subscription_plans SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty"]'
  WHERE slug = 'basic';

UPDATE public.subscription_plans SET feature_keys = '[]'
  WHERE slug = 'starter';
