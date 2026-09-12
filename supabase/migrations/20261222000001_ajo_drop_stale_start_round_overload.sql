-- 20261222000000 changed ajo_start_round's signature (added p_payout_slots_per_round),
-- but CREATE OR REPLACE FUNCTION does not drop a function when its argument list
-- changes — it creates a second overload instead. That left the OLD 3-arg
-- ajo_start_round(uuid, uuid, jsonb) callable in parallel with the new 4-arg
-- version, silently bypassing the new duplicate-client-id and divisibility
-- checks for any caller that doesn't pass payout_slots_per_round. Drop it.

DROP FUNCTION IF EXISTS public.ajo_start_round(uuid, uuid, jsonb);
