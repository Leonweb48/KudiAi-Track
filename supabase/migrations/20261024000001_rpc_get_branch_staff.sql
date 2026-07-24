-- RPC: get_branch_staff
-- Allows a manager to read all active staff on their own branch.
-- Direct SELECT on the staff table is blocked by RLS to user_id = auth.uid()
-- (own row only), so the roster screen cannot see peers without this helper.
-- SECURITY DEFINER bypasses RLS; the inner subquery re-gates on
-- auth.uid() being an active manager on the requested branch so a manager
-- cannot enumerate staff on branches they do not belong to.
CREATE OR REPLACE FUNCTION get_branch_staff(p_branch_id uuid)
RETURNS TABLE (
  id                uuid,
  full_name         text,
  email             text,
  role              text,
  profile_image_url text,
  status            text,
  branch_id         uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    s.id,
    s.full_name,
    s.email,
    s.role,
    s.profile_image_url,
    s.status,
    s.branch_id
  FROM staff s
  WHERE s.branch_id = p_branch_id
    AND s.owner_id = (
      SELECT s2.owner_id
      FROM   staff s2
      WHERE  s2.user_id    = auth.uid()
        AND  s2.branch_id  = p_branch_id
        AND  s2.role       = 'manager'
        AND  s2.status     = 'active'
      LIMIT 1
    )
    AND s.status = 'active'
  ORDER BY s.full_name;
$$;

GRANT EXECUTE ON FUNCTION get_branch_staff(uuid) TO authenticated;
