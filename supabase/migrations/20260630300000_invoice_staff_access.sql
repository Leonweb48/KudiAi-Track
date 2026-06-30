-- ─────────────────────────────────────────────────────────────────
--  Staff access for invoice tables
--  Staff who have the 'invoices' permission module enabled on their
--  account may read/write the owner's invoices, customers, items,
--  and payments — gated by staff_can(owner_user_id, 'invoices', ...).
--
--  Postgres permissive policies are OR-ed together, so adding new
--  policies never removes existing owner-only access.
-- ─────────────────────────────────────────────────────────────────

-- ── customers ────────────────────────────────────────────────────
CREATE POLICY "customers_staff_select" ON public.customers
  FOR SELECT USING (public.staff_can(user_id, 'invoices', false));

CREATE POLICY "customers_staff_write" ON public.customers
  FOR ALL
  USING    (public.staff_can(user_id, 'invoices', true))
  WITH CHECK (public.staff_can(user_id, 'invoices', true));

-- ── invoices ─────────────────────────────────────────────────────
CREATE POLICY "invoices_staff_select" ON public.invoices
  FOR SELECT USING (public.staff_can(user_id, 'invoices', false));

-- INSERT: staff sets user_id = owner's id; staff_can checks their permission for that owner
CREATE POLICY "invoices_staff_insert" ON public.invoices
  FOR INSERT WITH CHECK (public.staff_can(user_id, 'invoices', true));

CREATE POLICY "invoices_staff_update" ON public.invoices
  FOR UPDATE
  USING    (public.staff_can(user_id, 'invoices', true))
  WITH CHECK (public.staff_can(user_id, 'invoices', true));

-- Staff cannot delete invoices (owners only)

-- ── invoice_items ────────────────────────────────────────────────
CREATE POLICY "invoice_items_staff_select" ON public.invoice_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND public.staff_can(user_id, 'invoices', false)
    )
  );

CREATE POLICY "invoice_items_staff_write" ON public.invoice_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND public.staff_can(user_id, 'invoices', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND public.staff_can(user_id, 'invoices', true)
    )
  );

-- ── invoice_payments ─────────────────────────────────────────────
CREATE POLICY "invoice_payments_staff_select" ON public.invoice_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND public.staff_can(user_id, 'invoices', false)
    )
  );

CREATE POLICY "invoice_payments_staff_insert" ON public.invoice_payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND public.staff_can(user_id, 'invoices', true)
    )
  );
