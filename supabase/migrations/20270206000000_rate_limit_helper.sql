-- A small fixed-window rate limiter for edge functions that spend money per call (speech-to-text, etc.).
-- Server-only: called with the service-role client. rate_limit_hit() records one hit and answers whether the caller is
-- still within `p_max` hits per `p_window_seconds`.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key    TEXT        NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,      -- start of the fixed window
  hits   INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_window_seconds INTEGER, p_max INTEGER)
 RETURNS BOOLEAN
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window INTEGER := GREATEST(COALESCE(p_window_seconds, 60), 1);
  v_bucket TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / v_window) * v_window);
  v_hits   INTEGER;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 200 THEN
    RAISE EXCEPTION 'bad key';
  END IF;

  INSERT INTO public.rate_limits AS rl (key, bucket, hits) VALUES (p_key, v_bucket, 1)
  ON CONFLICT (key, bucket) DO UPDATE SET hits = rl.hits + 1
  RETURNING rl.hits INTO v_hits;

  -- keep the table small (cheap, occasional)
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limits WHERE bucket < now() - interval '2 days';
  END IF;

  RETURN v_hits <= GREATEST(COALESCE(p_max, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;
