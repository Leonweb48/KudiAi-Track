-- Enable Realtime for core business tables so that:
-- 1. transactions/credits subscriptions in useStore.js fire for staff-recorded events
-- 2. ajo_withdrawal_requests updates notify the client's withdrawal status in AjoMemberPortal

ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.credits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ajo_withdrawal_requests;
