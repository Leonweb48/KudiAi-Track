-- Festive receipt themes (2026-10-27): during a holiday a user can share a receipt dressed for it (Christmas, New Year,
-- Eid/Sallah, Easter, Independence Day, Valentine's) with a short greeting — like OPay's themed receipts.
-- The admin portal switches each theme on (optionally for a window) and may set the greeting; EVERY THEME STARTS OFF.
-- The artwork and colours live in the app (src/utils/receiptThemes.js); the id list must match it and the admin copy.
--
-- Read like holiday_caps (20270251): the public key may read only the live rows (enabled, inside the window) and only
-- the display columns; writes are the admin portal's (service role). Deliberately not a SECURITY DEFINER function —
-- the 15-minute anon lockdown job (20270199) would strip it.

CREATE TABLE IF NOT EXISTS public.receipt_themes (
  id          text        PRIMARY KEY CHECK (id IN ('christmas','new_year','eid','easter','nigeria','valentine')),
  enabled     boolean     NOT NULL DEFAULT false,
  starts_at   timestamptz,                          -- empty = from when it is switched on
  ends_at     timestamptz,                          -- empty = until it is switched off
  message     text        CHECK (message IS NULL OR length(btrim(message)) BETWEEN 1 AND 80),   -- empty = the app's own greeting, in the user's language
  sort        integer     NOT NULL DEFAULT 0,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE public.receipt_themes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_themes FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, starts_at, ends_at, message, sort) ON public.receipt_themes TO anon, authenticated;
GRANT ALL ON public.receipt_themes TO service_role;

DROP POLICY IF EXISTS receipt_themes_read_live ON public.receipt_themes;
CREATE POLICY receipt_themes_read_live ON public.receipt_themes
  FOR SELECT TO anon, authenticated
  USING (enabled AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()));

INSERT INTO public.receipt_themes (id, sort) VALUES
  ('christmas', 1), ('new_year', 2), ('eid', 3), ('easter', 4), ('nigeria', 5), ('valentine', 6)
ON CONFLICT (id) DO NOTHING;
