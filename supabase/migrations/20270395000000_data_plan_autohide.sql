-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Refused data plans are hidden for a while (owner, 2026-10-23).
-- ClubKonnect's plan list has no "available" flag, and it sometimes refuses a plan it still lists (INVALID_DATAPLAN —
-- MTN 1500.02 on 2026-10-23). When it does, the plan is recorded here and the data-plans list leaves it out for 24 hours
-- (or shows Bigisub's plan of the same size and validity in its place). After that it comes back on its own; refused
-- again → hidden again. A delivered order for it clears the record at once.
-- Written and read only by the clubkonnect function with the service-role key. Logic: _shared/planMatch.ts
-- (hideRefusedPlans); wiring: clubkonnect/index.ts (data, data-plans).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bill_plan_blocks (
  provider         text NOT NULL CHECK (length(provider) BETWEEN 1 AND 32),
  service          text NOT NULL CHECK (length(service) BETWEEN 1 AND 32),
  network          text NOT NULL CHECK (length(network) BETWEEN 1 AND 32),
  plan_id          text NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 64),
  plan_name        text CHECK (plan_name IS NULL OR length(plan_name) <= 200),
  blocked_until    timestamptz NOT NULL,
  refused_count    integer NOT NULL DEFAULT 1,
  first_refused_at timestamptz NOT NULL DEFAULT now(),
  last_refused_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, service, network, plan_id)
);
ALTER TABLE public.bill_plan_blocks ENABLE ROW LEVEL SECURITY;   -- no policies: nobody but the service role
REVOKE ALL ON TABLE public.bill_plan_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bill_plan_blocks TO service_role;

COMMENT ON TABLE public.bill_plan_blocks IS
  'Plans a bill provider refused while still listing them; hidden from the plan list until blocked_until. See _shared/planMatch.ts.';

-- Record a refusal: hidden for p_hours from now. Returns true when the plan was NOT already hidden (admins are told once).
CREATE OR REPLACE FUNCTION public.bill_plan_block(
  p_provider text, p_service text, p_network text, p_plan_id text, p_plan_name text, p_hours integer
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  was_hidden boolean;
BEGIN
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 720 THEN
    RAISE EXCEPTION 'bill_plan_block: hours out of range';
  END IF;
  SELECT blocked_until > now() INTO was_hidden FROM public.bill_plan_blocks
   WHERE provider = p_provider AND service = p_service AND network = p_network AND plan_id = p_plan_id FOR UPDATE;

  INSERT INTO public.bill_plan_blocks (provider, service, network, plan_id, plan_name, blocked_until)
  VALUES (p_provider, p_service, p_network, p_plan_id, NULLIF(left(p_plan_name, 200), ''), now() + make_interval(hours => p_hours))
  ON CONFLICT (provider, service, network, plan_id) DO UPDATE
     SET blocked_until   = EXCLUDED.blocked_until,
         plan_name       = COALESCE(EXCLUDED.plan_name, bill_plan_blocks.plan_name),
         refused_count   = bill_plan_blocks.refused_count + 1,
         last_refused_at = now();
  RETURN NOT COALESCE(was_hidden, false);
END $$;

REVOKE ALL ON FUNCTION public.bill_plan_block(text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_plan_block(text, text, text, text, text, integer) TO service_role;
