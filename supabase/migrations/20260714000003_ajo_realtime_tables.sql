-- Enable Supabase Realtime on aso_clients and ajo_contributions so that:
-- 1. aso_clients UPDATE fires when a payout credits current_balance (AjoMemberPortal balance refreshes instantly)
-- 2. ajo_contributions INSERT fires so the client sees the "Esusu Payout Received" notification in real-time

ALTER PUBLICATION supabase_realtime ADD TABLE public.aso_clients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ajo_contributions;
