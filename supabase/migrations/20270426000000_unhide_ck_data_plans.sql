-- 2026-10-26: ClubKonnect data purchases now send the plan's PRODUCT_CODE (ClubKonnect support: "use the data plan's product
-- code for API integration"). Every ClubKonnect data plan hidden since 23 Oct was hidden because the PRODUCT_ID was refused,
-- not because the plan is gone — bring them back now instead of waiting out the 24 h. A plan ClubKonnect still refuses with
-- its code is hidden again by the next refusal, as before. Prints only counts.
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.bill_plan_blocks
     SET blocked_until = now()
   WHERE provider = 'clubkonnect' AND service = 'data' AND blocked_until > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'unhide | ClubKonnect data plans shown again: %', n;
END $$;
