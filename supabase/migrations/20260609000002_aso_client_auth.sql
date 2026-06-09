-- Add Supabase auth link for ajo clients
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS client_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS aso_clients_client_user_idx ON aso_clients(client_user_id);

-- Clients can read their own record
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'aso_clients' AND policyname = 'aso_clients_client_select'
  ) THEN
    CREATE POLICY "aso_clients_client_select" ON aso_clients
      FOR SELECT USING (client_user_id = auth.uid());
  END IF;
END $$;

-- Clients can read their own contributions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ajo_contributions' AND policyname = 'ajo_contributions_client_select'
  ) THEN
    CREATE POLICY "ajo_contributions_client_select" ON ajo_contributions
      FOR SELECT USING (
        aso_client_id IN (
          SELECT id FROM aso_clients WHERE client_user_id = auth.uid()
        )
      );
  END IF;
END $$;
