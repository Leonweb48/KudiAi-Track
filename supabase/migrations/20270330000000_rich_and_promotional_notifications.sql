-- Rich + promotional notifications (2026-10-13).
--  • notifications.image_url — a picture shown when a push is expanded (and in the in-app bell). Only the server sets it.
--  • notification_preferences.pref_promotions — the person's "Offers & updates" switch (default on). Marketing messages
--    must be easy to turn off (Google Play policy, Nigeria Data Protection Act); turning it off stops promotional pushes
--    AND their bell rows. Service notifications (money, savings, …) are unaffected.
--  • admin_broadcasts gets what a push broadcast needs: picture, where a tap leads, and real delivery counts.
ALTER TABLE public.notifications            ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS pref_promotions boolean NOT NULL DEFAULT true;

ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS image_url        text;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS deep_link        jsonb;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS in_app_count     integer;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS push_count       integer;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS no_device_count  integer;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS opted_out_count  integer;

-- the SQL-side preference gate knows the new category too (anything unknown already defaults to allowed)
CREATE OR REPLACE FUNCTION public.notif_pref_allows(p_user uuid, p_category text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT CASE p_category
           WHEN 'money'       THEN pref_money
           WHEN 'savings'     THEN pref_savings
           WHEN 'stock'       THEN pref_stock
           WHEN 'permissions' THEN pref_permissions
           WHEN 'approvals'   THEN pref_approvals
           WHEN 'credit'      THEN pref_credit
           WHEN 'alert'       THEN pref_alert
           WHEN 'bills'       THEN pref_bills
           WHEN 'milestone'   THEN pref_milestone
           WHEN 'promotions'  THEN pref_promotions
           ELSE true
         END
    INTO v_allowed
    FROM public.notification_preferences
   WHERE user_id = p_user;

  RETURN COALESCE(v_allowed, true);
END;
$function$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%category%';
  RAISE NOTICE 'notif | image_url + pref_promotions ready; category checks on notifications: % (0 = promotions accepted as-is)', n;
END $$;
