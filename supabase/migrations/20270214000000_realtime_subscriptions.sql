-- The app listens for changes to the signed-in user's own subscription row (src/hooks/useAuth.js, channel "user_subscription_realtime") so that a plan
-- changed somewhere else — for example an upgrade made on the website — unlocks features in an already-open app.
--
-- Supabase Realtime was refusing that subscription: "Unable to subscribe to changes with given parameters ... table: subscriptions". The table was
-- never added to the realtime publication, so the feature has never worked in production (found 2026-09-26 by upgrading a test account while the app
-- was open: it stayed locked until reopened).
--
-- Row-level security still decides who receives what: a user is only ever sent changes to a subscription row they are allowed to read (their own).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'subscriptions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  END IF;
END $$;
