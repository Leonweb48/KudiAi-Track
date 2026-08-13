-- Platform feature flags: a simple key/value table read by the client at startup.
-- Toggle coop_module_enabled to 'true' to open the cooperative module with zero rebuild.

CREATE TABLE IF NOT EXISTS public.platform_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_config' AND policyname = 'public_read_platform_config'
  ) THEN
    CREATE POLICY "public_read_platform_config"
    ON public.platform_config FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

INSERT INTO public.platform_config (key, value, description)
VALUES (
  'coop_module_enabled',
  'false',
  'Set to true to enable the cooperative/organisation module for all users. No rebuild required.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20261101000001', 'platform_config', ARRAY['-- see file'])
ON CONFLICT (version) DO NOTHING;
