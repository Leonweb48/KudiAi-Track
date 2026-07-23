-- ajo_cycles was missing from the realtime publication.
-- Without this, INSERT/UPDATE events on ajo_cycles never fire to AjoMemberPortal,
-- so the portal has to wait for the next foreground-resume to pick up cycle changes.
ALTER PUBLICATION supabase_realtime ADD TABLE public.ajo_cycles;
