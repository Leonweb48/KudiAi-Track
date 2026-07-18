-- The no_first_period_in_group constraint was added when one client = one group.
-- With multi-membership, commission_model on aso_clients controls personal savings
-- cycles only — it is orthogonal to group membership. Drop the constraint.
ALTER TABLE aso_clients
  DROP CONSTRAINT IF EXISTS aso_clients_no_first_period_in_group;
