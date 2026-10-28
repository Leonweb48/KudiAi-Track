-- Holiday logo caps, redesigned (2026-10-28): the eight caps are now professional animations (Google's Noto Emoji
-- Animation, self-hosted in public/holiday-caps/) shown as a badge on the logo's corner. Same ids, so every scheduled cap
-- keeps working. Six more choices are added: christmas_bell, snowman, star, sparkles, dove, rabbit.
-- Keep this list in step with src/utils/holidayCapPresets.js and the admin portal's copy.
DO $$
DECLARE c record;
BEGIN
  -- the original inline CHECK on preset, whatever Postgres named it
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.holiday_caps'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%preset%'
  LOOP
    EXECUTE format('ALTER TABLE public.holiday_caps DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.holiday_caps ADD CONSTRAINT holiday_caps_preset_check
  CHECK (preset IN ('nigeria','christmas','new_year','eid','easter','workers','valentine','celebration','christmas_bell','snowman','star','sparkles','dove','rabbit'));
