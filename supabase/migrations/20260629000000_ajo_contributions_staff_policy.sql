-- Allow staff to insert ajo_contributions on behalf of their owner
-- (existing "ajo_contributions_owner" FOR ALL policy blocks staff inserts
--  because auth.uid() = staffUID but owner_id = businessOwnerUID)
CREATE POLICY "staff_ajo_contributions_insert" ON ajo_contributions
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    OR public.staff_can(owner_id, 'aso', true)
  );

-- Same fix for UPDATE (e.g. voiding entries)
CREATE POLICY "staff_ajo_contributions_update" ON ajo_contributions
  FOR UPDATE TO authenticated
  USING  (owner_id = auth.uid() OR public.staff_can(owner_id, 'aso', true))
  WITH CHECK (owner_id = auth.uid() OR public.staff_can(owner_id, 'aso', true));
