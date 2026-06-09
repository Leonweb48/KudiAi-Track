-- Allow staff to insert new products for their owner's business
-- (staff could previously only read/update, not add new product entries)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'staff_insert_products'
  ) THEN
    CREATE POLICY "staff_insert_products" ON public.products
      FOR INSERT WITH CHECK (
        user_id IN (SELECT owner_id FROM public.staff WHERE id = auth.uid())
      );
  END IF;
END $$;
