-- Enable Supabase Realtime on subscription_plans so the business app
-- receives instant cache-invalidation when admin changes any plan.
ALTER PUBLICATION supabase_realtime ADD TABLE subscription_plans;
