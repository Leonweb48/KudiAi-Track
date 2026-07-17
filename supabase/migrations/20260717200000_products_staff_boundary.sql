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
-- SECURITY FIX (v2): v1 lacked an authorization gate — any authenticated user
-- who supplied an arbitrary p_owner_id could receive that owner's products with
-- real cost_price (because caller_is_staff=false for non-staff of that owner).
-- Fixed: callers not recognized as owner OR active staff receive 0 rows.
--
-- HOSTILE EVIDENCE:
--   (a) Staff JWT  GET  /rest/v1/products?select=*  → 0 rows (RLS blocks)
--   (b) Staff JWT  POST /rest/v1/rpc/get_products_safe {"p_owner_id":"<oid>"}
--         → rows with cost_price: null
--   (c) Owner JWT  GET  /rest/v1/products?select=*&user_id=eq.<oid>
--         → rows with cost_price intact
--   (d) Third-party JWT POST /rpc/get_products_safe {"p_owner_id":"<oid>"}
--         → [] (empty, unauthorized)

DROP POLICY IF EXISTS "staff_read_products" ON public.products;

-- ── get_products_safe ──────────────────────────────────────────────────────
-- SECURITY DEFINER: runs as the function owner (postgres), not the caller.
-- This lets it read products.cost_price internally while masking it for staff.
-- Returns identical schema to the products table so the client can use the
-- same state type; cost_price is NULL for staff callers.
--
-- Authorization gate (v2):
--   - Caller is the owner   → full columns including cost_price
--   - Caller is active staff of owner → all columns, cost_price = NULL
--   - Caller is neither     → 0 rows returned (no error, just empty)
--
-- Identity is derived exclusively from auth.uid() (the JWT claim set by
-- Supabase Auth from the request's Authorization header). The p_owner_id
-- parameter controls WHICH owner's products are returned, not WHO the caller
-- is. A caller cannot elevate their identity by choosing a different p_owner_id.
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
  cost_price          NUMERIC,      -- NULL for staff callers; real value for owner
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
  caller_is_owner BOOLEAN;
  caller_is_staff BOOLEAN;
BEGIN
  -- Identity is read from auth.uid() — the JWT sub claim, set by Supabase Auth
  -- before this function runs. Cannot be influenced by any client-supplied param.
  caller_is_owner := (auth.uid() = p_owner_id);

  SELECT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.user_id  = auth.uid()  -- auth.uid() only — never p_owner_id
      AND s.owner_id = p_owner_id
      AND s.status   = 'active'
  ) INTO caller_is_staff;

  -- Authorization gate: unauthorized callers receive 0 rows, not an error.
  -- This prevents a third-party JWT probing arbitrary p_owner_id values.
  IF NOT (caller_is_owner OR caller_is_staff) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.user_id,
      p.branch_id,
      p.product_name,
      p.sku,
      p.category,
      -- Only field masked: cost_price. All other columns are non-margin-derivable.
      -- selling_price is intentionally visible (staff need it to process sales).
      -- needs_costing and source are operational metadata — they confirm no cost
      -- price exists (needs_costing=true) but never reveal what it is.
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

-- Allow any authenticated user to call the function; the authorization gate
-- inside enforces that only the owner or their active staff can read the data.
GRANT EXECUTE ON FUNCTION public.get_products_safe(UUID, UUID) TO authenticated;

-- Staff INSERT and UPDATE policies are preserved — auto-stub creation works
-- through the INSERT path (no SELECT, no cost_price returned).
-- Staff UPDATE preserved for recordMovement quantity patching.
