-- 2026-10-27 (owner: "let it fall back to VTpass if there are any issues"): the owner's ClubKonnect test bought MTN "500MB Weekly
-- Plan (Direct Data)" (code 18 in ClubKonnect's own list) and ClubKonnect delivered "2.5GB Daily" at ₦750 instead (its code 15) —
-- ClubKonnect's product codes don't match its own price list, so every data order could deliver (and charge) the wrong plan.
-- Data → VTpass main until ClubKonnect fixes its codes. Cable, electricity, Smile stay on VTpass; airtime and WAEC on ClubKonnect.
UPDATE public.platform_config SET value = 'data,cable,electricity,smile' WHERE key = 'bill_provider_vtpass_services';
DO $$ BEGIN
  RAISE NOTICE 'DV vtpass main for: %', (SELECT value FROM public.platform_config WHERE key = 'bill_provider_vtpass_services');
END $$;
