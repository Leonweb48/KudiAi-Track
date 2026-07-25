-- Restore admin and aso-portal-client SELECT policies that were wiped by the
-- nuclear RLS migration (20261025000004).  These are not staff-scope policies;
-- they serve the admin dashboard and the aso client portal respectively.

-- ── transactions ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transactions'
      AND policyname = 'admin_read_all_txns'
  ) THEN
    CREATE POLICY "admin_read_all_txns" ON public.transactions
      FOR SELECT USING (public.is_admin());
  END IF;
END $$;

-- ── aso_clients ───────────────────────────────────────────────────────────────

-- Admin panel access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'aso_clients'
      AND policyname = 'admin_read_all_aso'
  ) THEN
    CREATE POLICY "admin_read_all_aso" ON public.aso_clients
      FOR SELECT USING (public.is_admin());
  END IF;
END $$;

-- Aso portal: client can read their own record
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'aso_clients'
      AND policyname = 'aso_clients_client_select'
  ) THEN
    CREATE POLICY "aso_clients_client_select" ON public.aso_clients
      FOR SELECT USING (client_user_id = auth.uid());
  END IF;
END $$;
