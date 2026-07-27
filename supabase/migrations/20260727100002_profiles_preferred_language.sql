-- Store the user's chosen app language server-side so it syncs across devices.
-- NULL = user has not made an explicit choice (will trigger the first-open picker).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT NULL;
