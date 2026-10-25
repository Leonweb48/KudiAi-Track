-- Security audit 2026-10-25 follow-up: the bill price floor moves from 80% to 95% of the server's price (the ₦200
-- tolerance stays). 60 days of real orders: every one under 97% was a small airtime/data order paid mostly with cashback,
-- all inside the ₦200 tolerance — none would have been stopped. A cheat's saving on a large order drops from 20% to 5%.
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bills_gate_floor_pct', '95', 'Bill price floor: the payment must cover this % of the server''s price (less coupon and the tolerance).')
ON CONFLICT (key) DO UPDATE SET value = '95', updated_at = now();
