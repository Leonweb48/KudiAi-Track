-- 2026-10-23: ClubKonnect refused two MTN "Direct Data" plans it still lists (INVALID_DATAPLAN: 1500.02 at 08:19 and
-- 17:57, 1000.03 at 17:17 Lagos) — all before the auto-hide (20270395) went live at 18:09. Hide them the same way now:
-- 24 hours, back on their own after that, at once if an order for them is delivered.
SELECT public.bill_plan_block('clubkonnect', 'data', 'MTN', '1500.02', '2GB+2mins Monthly Plan - 30 days (Direct Data)', 24);
SELECT public.bill_plan_block('clubkonnect', 'data', 'MTN', '1000.03', '1.5GB Weekly Plan - 7 days (Direct Data)', 24);
