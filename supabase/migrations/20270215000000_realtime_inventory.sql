-- Live stock across devices: useInventory.js subscribes to `products` and `stock_movements` (channel "inv_<userId>") so a sale, restock or edit made on one
-- device (the owner's phone, a staff login, the web) shows on the others. Supabase Realtime refused that subscription — "Unable to subscribe to changes with
-- given parameters ... table: stock_movements" — because neither table was ever in the realtime publication, so the whole channel failed in production
-- (found 2026-09-26 with a websocket probe; see also 20270214000000_realtime_subscriptions.sql).
--
-- Row-level security still decides who is sent what: an owner receives their own rows' changes; staff only what their SELECT policies allow.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'stock_movements'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
