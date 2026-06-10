-- Fix staff inventory RLS policies.
-- Original migration used staff.id (UUID primary key) to match auth.uid(),
-- but for staff auth users, auth.uid() == staff.user_id (separate column).

DROP POLICY IF EXISTS "staff_read_products"    ON public.products;
DROP POLICY IF EXISTS "staff_update_products"  ON public.products;
DROP POLICY IF EXISTS "staff_insert_products"  ON public.products;
DROP POLICY IF EXISTS "staff_read_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "staff_insert_movements" ON public.stock_movements;

CREATE POLICY "staff_read_products" ON public.products
  FOR SELECT USING (
    user_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "staff_update_products" ON public.products
  FOR UPDATE USING (
    user_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "staff_insert_products" ON public.products
  FOR INSERT WITH CHECK (
    user_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "staff_read_movements" ON public.stock_movements
  FOR SELECT USING (
    user_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "staff_insert_movements" ON public.stock_movements
  FOR INSERT WITH CHECK (
    user_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
