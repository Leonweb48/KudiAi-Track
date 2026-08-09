-- P1: Store loan rejection reason on the record so members can see it.
-- Previously the reason was sent in a notification but not persisted; this
-- makes it available on the member's loan detail screen indefinitely.

ALTER TABLE public.org_loans
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260809000003', 'coop_p1_changes', ARRAY['-- see file'])
ON CONFLICT (version) DO NOTHING;
