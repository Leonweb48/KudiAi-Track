-- Add portal_user_id to organizations so a business-owned org can have
-- its own login credentials (separate from the business owner's account).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS portal_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_portal_user_id_idx ON organizations(portal_user_id);
