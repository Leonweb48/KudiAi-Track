-- The bill provider switch now covers cable TV (DStv/GOtv/StarTimes), electricity (all 12 discos), WAEC and Smile as
-- well as airtime and data (supabase/functions/_shared/billProvider.ts VT_SERVICES). Descriptions only — values untouched.
UPDATE public.platform_config SET description =
  'Main provider for airtime, data, cable TV (DStv/GOtv/StarTimes), electricity, WAEC and Smile: clubkonnect or vtpass. Betting, JAMB, Spectranet, Showmax and printed PINs always use ClubKonnect. VTpass is only used with live keys.'
 WHERE key = 'bill_provider';
UPDATE public.platform_config SET description =
  'When the main provider is down (or refuses an order for an account reason such as an empty wallet), send airtime, electricity and WAEC orders to the other provider automatically; plan-based bills (data, cable TV, Smile) stay with the provider whose plan list the customer chose from. An order only moves once the first provider has confirmed it holds no order.'
 WHERE key = 'bill_provider_failover';

DO $$
BEGIN
  RAISE NOTICE 'bill provider | descriptions updated for all services (main=%, failover=%)',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_failover');
END $$;
