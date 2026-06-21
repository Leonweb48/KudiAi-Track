-- Add missing FK from org_savings.program_id → org_contribution_programs.id
-- Without this FK PostgREST cannot resolve the embedded join and the
-- get-savings query returns an empty result set.
ALTER TABLE public.org_savings
  ADD CONSTRAINT fk_org_savings_program
  FOREIGN KEY (program_id)
  REFERENCES public.org_contribution_programs(id)
  ON DELETE SET NULL;
