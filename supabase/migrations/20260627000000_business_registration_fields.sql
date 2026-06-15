-- Add structured business registration fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_type           text,
  ADD COLUMN IF NOT EXISTS reg_status              text,
  ADD COLUMN IF NOT EXISTS country_of_registration text,
  ADD COLUMN IF NOT EXISTS industry                text,
  ADD COLUMN IF NOT EXISTS business_size           text,
  ADD COLUMN IF NOT EXISTS products_services_type  text,
  ADD COLUMN IF NOT EXISTS target_market           text,
  ADD COLUMN IF NOT EXISTS operating_model         text,
  ADD COLUMN IF NOT EXISTS business_country        text,
  ADD COLUMN IF NOT EXISTS business_state          text,
  ADD COLUMN IF NOT EXISTS business_lga            text,
  ADD COLUMN IF NOT EXISTS business_ward           text,
  ADD COLUMN IF NOT EXISTS reg_doc_type            text,
  ADD COLUMN IF NOT EXISTS reg_doc_url             text;
