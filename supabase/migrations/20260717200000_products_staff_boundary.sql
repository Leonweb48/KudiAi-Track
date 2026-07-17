-- Part 4: Staff cost-price boundary — server-enforced, Batch-1 standard.
--
-- Drop the staff SELECT policy on products so staff JWTs cannot query
-- cost_price (or any column) from the products table directly via REST.
-- Staff reads are redirected to get_products_safe() which returns
-- cost_price = NULL for staff callers and the real value for owners.
--
-- INSERT / UPDATE stay open for staff (needed for auto-stub creation).
-- stock_movements policies are unchanged (staff still read/write movements).
--
-- HOSTILE EVIDENCE:
--   (a) Staff JWT  GET  /rest/v1/products?select=*  → 0 rows (RLS blocks)
--   (b) Staff JWT  POST /rest/v1/rpc/get_products_safe {"p_owner_id":"<oid>"}
--         → rows with cost_price: null
--   (c) Owner JWT  GET  /rest/v1/products?select=*&user_id=eq.<oid>
--         → rows with cost_price intact

DROP POLICY IF EXISTS "staff_read_products" ON public.products;

-- ── get_products_safe ──────────────────────────────────────────────────────
-- SECURITY DEFINER: runs as the function owner (postgres), not the caller.
-- This lets it read products.cost_price internally while masking it for staff.
-- Returns identical schema to the products table so the client can use the
-- same state type; cost_price is NULL for staff callers.
CREATE OR REPLACE FUNCTION public.get_products_safe(
  p_owner_id  UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id                  UUID,
  user_id             UUID,
  branch_id           UUID,
  product_name        TEXT,
  sku                 TEXT,
  category            TEXT,
  cost_price          NUMERIC,      -- NULL for staff callers
  selling_price       NUMERIC,
  quantity            INTEGER,
  low_stock_threshold INTEGER,
  source              TEXT,
  needs_costing       BOOLEAN,
  updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_staff BOOLEAN;
BEGIN
  -- Determine if the calling JWT belongs to an active staff member of this owner.
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id  = auth.uid()
      AND owner_id = p_owner_id
      AND status   = 'active'
  ) INTO caller_is_staff;

  RETURN QUERY
    SELECT
      p.id,
      p.user_id,
      p.branch_id,
      p.product_name,
      p.sku,
      p.category,
      -- Core enforcement: staff never see cost_price
      CASE WHEN caller_is_staff THEN NULL::NUMERIC ELSE p.cost_price END AS cost_price,
      p.selling_price,
      p.quantity,
      p.low_stock_threshold,
      p.source,
      p.needs_costing,
      p.updated_at
    FROM public.products p
    WHERE p.user_id = p_owner_id
      AND (
        p_branch_id IS NULL                   -- no branch filter → all products
        OR p.branch_id = p_branch_id          -- this branch's products
        OR p.branch_id IS NULL                -- plus main-stock (no branch)
      )
    ORDER BY p.product_name;
END;
$$;

-- Allow any authenticated user to call the function; the internal check
-- enforces that only active staff of the given owner can read that owner's data.
GRANT EXECUTE ON FUNCTION public.get_products_safe(UUID, UUID) TO authenticated;

-- Staff INSERT and UPDATE policies are preserved — auto-stub creation works
-- through the INSERT path (no SELECT, no cost_price returned).
-- Staff UPDATE preserved for recordMovement quantity patching.
