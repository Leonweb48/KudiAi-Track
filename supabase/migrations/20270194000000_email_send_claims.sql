-- Once-per-period claim for the emails the owner's app sends on first load ("yesterday's profit", overdue digest,
-- weekly unnamed-sales nudge).
--
-- Those were guarded ONLY by localStorage, so every new device or browser (or a cleared cache) sent the email again.
-- The guard now lives on the server: the first device to claim a (kind, period) wins, everyone else gets `false`.
-- The caller is always auth.uid() — a user can only ever claim for themselves.

CREATE TABLE IF NOT EXISTS public.email_send_claims (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL,
  bucket     TEXT        NOT NULL,            -- the period: a date ("2026-09-25") or a week start
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, bucket)
);

ALTER TABLE public.email_send_claims ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: nothing reads or writes this table except claim_daily_email() below.
REVOKE ALL ON public.email_send_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_daily_email(p_kind TEXT, p_bucket TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_rows INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('daily_summary', 'ajo_overdue_digest', 'weekly_unnamed_nudge') THEN
    RAISE EXCEPTION 'unknown email kind';
  END IF;
  IF p_bucket IS NULL OR length(p_bucket) = 0 OR length(p_bucket) > 16 THEN
    RAISE EXCEPTION 'bad bucket';
  END IF;

  -- keep the table small: a user's own claims older than 60 days are no longer needed
  DELETE FROM public.email_send_claims WHERE user_id = v_uid AND claimed_at < now() - interval '60 days';

  INSERT INTO public.email_send_claims (user_id, kind, bucket) VALUES (v_uid, p_kind, p_bucket)
  ON CONFLICT (user_id, kind, bucket) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_rows = 1;   -- true only for the caller that inserted the row
END;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_email(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_email(TEXT, TEXT) TO authenticated;
