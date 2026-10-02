-- Bank "network strength" for the transfer screen (2026-10-02, owner request after transfers failed on Flutterwave's side).
--
-- Two signals, per destination bank code, over the last few hours:
--   • name enquiries the flutterwave function makes (resolve-account / suggest-banks): did the bank answer at all? A
--     "no such account" reply still counts as UP — only no answer / timeouts / server errors count as DOWN. Recorded here.
--   • our own transfers (wallet_withdrawals): successful vs failed/reversed — read straight from that table.
-- bank_network_status() turns them into good / fair / poor / unknown (too few samples to say). Server-only: the function
-- reads it with the service role and hands the app a small map; nothing here is readable or writable by app users.

CREATE TABLE IF NOT EXISTS public.bank_network_events (
  id         BIGSERIAL PRIMARY KEY,
  bank_code  TEXT        NOT NULL CHECK (length(bank_code) BETWEEN 2 AND 10),
  kind       TEXT        NOT NULL CHECK (kind IN ('resolve')),
  ok         BOOLEAN     NOT NULL,
  ms         INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_network_events_code_time ON public.bank_network_events (bank_code, created_at DESC);
ALTER TABLE public.bank_network_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_network_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.bank_network_events_id_seq FROM PUBLIC, anon, authenticated;

-- Record one name-enquiry outcome. Keeps the table small (7 days).
CREATE OR REPLACE FUNCTION public.bank_network_record(p_bank_code TEXT, p_ok BOOLEAN, p_ms INTEGER DEFAULT NULL)
 RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_bank_code IS NULL OR p_bank_code !~ '^[0-9A-Za-z]{2,10}$' OR p_ok IS NULL THEN RETURN; END IF;
  INSERT INTO public.bank_network_events (bank_code, kind, ok, ms) VALUES (p_bank_code, 'resolve', p_ok, p_ms);
  IF random() < 0.01 THEN
    DELETE FROM public.bank_network_events WHERE created_at < now() - interval '7 days';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.bank_network_record(TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_network_record(TEXT, BOOLEAN, INTEGER) TO service_role;

-- Per bank: samples, share that worked, and a word. bank_code '*' = all transfers together (is Flutterwave itself OK?).
-- Transfers weigh double a name enquiry (they are the thing that actually failed for customers). < 3 samples = unknown.
CREATE OR REPLACE FUNCTION public.bank_network_status(p_hours INTEGER DEFAULT 3)
 RETURNS TABLE (bank_code TEXT, samples INTEGER, ok_share NUMERIC, status TEXT)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH since AS (SELECT now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(p_hours, 3), 48))) AS t),
  ev AS (
    SELECT e.bank_code, CASE WHEN e.ok THEN 1 ELSE 0 END AS good, 1 AS w
      FROM public.bank_network_events e, since WHERE e.created_at > since.t
    UNION ALL
    SELECT w.bank_code, CASE WHEN w.status = 'successful' THEN 1 ELSE 0 END, 2
      FROM public.wallet_withdrawals w, since
     WHERE w.created_at > since.t AND w.status IN ('successful', 'failed', 'reversed')
  ),
  per AS (
    SELECT ev.bank_code, count(*)::int AS n, sum(good * w)::numeric / NULLIF(sum(w), 0) AS share FROM ev GROUP BY ev.bank_code
    UNION ALL
    SELECT '*', count(*)::int, avg(CASE WHEN w.status = 'successful' THEN 1 ELSE 0 END)::numeric
      FROM public.wallet_withdrawals w, since
     WHERE w.created_at > since.t AND w.status IN ('successful', 'failed', 'reversed')
  )
  SELECT per.bank_code, per.n, round(per.share, 2),
         CASE WHEN per.n < 3 OR per.share IS NULL THEN 'unknown'
              WHEN per.share >= 0.9 THEN 'good'
              WHEN per.share >= 0.6 THEN 'fair'
              ELSE 'poor' END
    FROM per;
$$;
REVOKE ALL ON FUNCTION public.bank_network_status(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_network_status(INTEGER) TO service_role;
