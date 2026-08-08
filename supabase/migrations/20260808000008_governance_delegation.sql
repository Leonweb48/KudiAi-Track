-- Phase 2: governance delegation flag on organizations
-- When true, org owner is restricted to provisioning-only actions in coop-portal.
-- Portal admin (portal_user_id) retains full operational access.
-- Default false: all existing orgs retain current behaviour unchanged.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS governance_delegated BOOLEAN NOT NULL DEFAULT false;

-- Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260808000008',
  'governance_delegation',
  ARRAY[
    'ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS governance_delegated BOOLEAN NOT NULL DEFAULT false'
  ]
)
ON CONFLICT (version) DO NOTHING;
