-- Add user_id to org_members so they can log in via Supabase Auth
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON public.org_members(user_id);
