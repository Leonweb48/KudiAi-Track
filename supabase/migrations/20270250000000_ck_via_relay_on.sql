-- ClubKonnect now has an IP whitelist and rejects our account's API calls from any address not on it. Supabase has no
-- fixed outgoing IP, so the clubkonnect function sends every call made with our account through the payout relay
-- (flw-relay on Fly.io, fixed IP 209.71.82.233) while this is "true" — 209.71.82.233 is the address to whitelist on
-- clubkonnect.com. Set to "false" to go direct again (e.g. if the relay is down and the whitelist is set to 0.0.0.0).
-- The function caches it for 60 seconds.
INSERT INTO public.platform_config (key, value, description) VALUES
  ('ck_via_relay', 'true',
   'Send ClubKonnect API calls through the fixed-IP relay (209.71.82.233 — whitelist it on clubkonnect.com). false = call ClubKonnect directly from Supabase (changing IP).')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
