-- Welcome email queue — populated by triggers, processed by admin portal API
CREATE TABLE IF NOT EXISTS public.welcome_email_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  email       text NOT NULL,
  full_name   text,
  user_type   text NOT NULL CHECK (user_type IN ('business','staff','ajo_client','org_member','marketer')),
  extra_data  jsonb DEFAULT '{}',
  sent        boolean DEFAULT false,
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.welcome_email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.welcome_email_queue USING (true) WITH CHECK (true);

-- Trigger: when a new profile is created (business signup)
CREATE OR REPLACE FUNCTION trg_queue_business_welcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.welcome_email_queue (user_id, email, full_name, user_type, extra_data)
  VALUES (NEW.id, COALESCE(NEW.email,''), NEW.owner_name, 'business', jsonb_build_object('business_name', NEW.business_name))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_business_welcome ON public.profiles;
CREATE TRIGGER trg_business_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION trg_queue_business_welcome();

-- Trigger: when a new staff member is created
CREATE OR REPLACE FUNCTION trg_queue_staff_welcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.welcome_email_queue (user_id, email, full_name, user_type, extra_data)
  VALUES (NEW.id, COALESCE(NEW.email,''), NEW.full_name, 'staff', jsonb_build_object('role', NEW.role))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_staff_welcome ON public.staff;
CREATE TRIGGER trg_staff_welcome
  AFTER INSERT ON public.staff
  FOR EACH ROW WHEN (NEW.email IS NOT NULL AND NEW.email != '')
  EXECUTE FUNCTION trg_queue_staff_welcome();

-- Trigger: when a new ajo client is created
CREATE OR REPLACE FUNCTION trg_queue_ajo_welcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email != '' THEN
    INSERT INTO public.welcome_email_queue (user_id, email, full_name, user_type, extra_data)
    VALUES (NEW.id, NEW.email, NEW.full_name, 'ajo_client', jsonb_build_object('membership_number', NEW.membership_number))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ajo_welcome ON public.aso_clients;
CREATE TRIGGER trg_ajo_welcome
  AFTER INSERT ON public.aso_clients
  FOR EACH ROW EXECUTE FUNCTION trg_queue_ajo_welcome();

-- Trigger: when a new org member is created
CREATE OR REPLACE FUNCTION trg_queue_org_member_welcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email != '' THEN
    INSERT INTO public.welcome_email_queue (user_id, email, full_name, user_type, extra_data)
    VALUES (NEW.id, NEW.email, NEW.full_name, 'org_member', jsonb_build_object('membership_id', NEW.membership_id))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_org_member_welcome ON public.org_members;
CREATE TRIGGER trg_org_member_welcome
  AFTER INSERT ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION trg_queue_org_member_welcome();
