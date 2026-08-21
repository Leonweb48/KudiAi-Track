-- Delete dummy milestone
DELETE FROM public.marketer_milestone_config
WHERE id = '577ee75f-eecd-4a34-a1a1-50148b7e8fec';

-- Activate all 5 real milestones
UPDATE public.marketer_milestone_config
SET is_active = true
WHERE id IN (
  '5e6c1f39-6aa9-43a5-8660-cd893059ce60',
  '9523c821-9187-4f71-b362-d9f34a2831a6',
  'de13ffcc-ccfc-436c-80d6-f04e5171f60c',
  'ab8ffe37-d391-4ee3-b639-7213c7749b35',
  '25a9cbcd-f541-483d-a51c-56d080585d30'
);

-- Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000008',
  'activate_real_milestones',
  ARRAY[
    'DELETE FROM public.marketer_milestone_config WHERE id = ''577ee75f-eecd-4a34-a1a1-50148b7e8fec''',
    'UPDATE public.marketer_milestone_config SET is_active = true WHERE id IN (''5e6c1f39-6aa9-43a5-8660-cd893059ce60'',''9523c821-9187-4f71-b362-d9f34a2831a6'',''de13ffcc-ccfc-436c-80d6-f04e5171f60c'',''ab8ffe37-d391-4ee3-b639-7213c7749b35'',''25a9cbcd-f541-483d-a51c-56d080585d30'')'
  ]
)
ON CONFLICT (version) DO NOTHING;
