-- Fix trg_queue_business_welcome: profiles has no owner_name column, use full_name instead
CREATE OR REPLACE FUNCTION trg_queue_business_welcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.welcome_email_queue (user_id, email, full_name, user_type, extra_data)
  VALUES (NEW.id, COALESCE(NEW.email,''), NEW.full_name, 'business', jsonb_build_object('business_name', NEW.business_name))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
