-- Holiday logo caps: an animated decoration (Santa hat, green-white-green cap, crescent…) that sits on the app logo for a
-- time window the admin sets, on the portals the admin picks. Managed from the admin portal (Settings → Holiday Logo Caps,
-- service-role writes); the app reads the schedule and switches each cap on/off at its start/end time.
--
-- Public read on purpose (the login screens show caps too) — but only the harmless columns, only enabled rows, and only
-- caps that haven't ended. No SECURITY DEFINER function: the 15-minute anon lockdown job (20270199) strips anon from
-- those, so the read is plain RLS + column grants.
CREATE TABLE IF NOT EXISTS public.holiday_caps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 60),
  preset      text        NOT NULL CHECK (preset IN ('nigeria','christmas','new_year','eid','easter','workers','valentine','celebration')),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  portals     text[]      NOT NULL CHECK (cardinality(portals) BETWEEN 1 AND 7
                            AND portals <@ ARRAY['owner','staff','manager','ajo_client','coop_admin','coop_member','public']::text[]),
  enabled     boolean     NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '31 days')
);
CREATE INDEX IF NOT EXISTS holiday_caps_ends_at_idx ON public.holiday_caps (ends_at);

ALTER TABLE public.holiday_caps ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand anon/authenticated ALL on new tables — take that back, then allow reading the
-- display columns only (not created_by).
REVOKE ALL ON public.holiday_caps FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, title, preset, starts_at, ends_at, portals) ON public.holiday_caps TO anon, authenticated;
GRANT ALL ON public.holiday_caps TO service_role;

DROP POLICY IF EXISTS holiday_caps_read_live ON public.holiday_caps;
CREATE POLICY holiday_caps_read_live ON public.holiday_caps
  FOR SELECT TO anon, authenticated
  USING (enabled AND ends_at > now());
