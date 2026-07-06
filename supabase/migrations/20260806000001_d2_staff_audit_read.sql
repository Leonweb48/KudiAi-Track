-- D2: Allow staff to read their own activity from audit_logs
CREATE POLICY "staff_read_own_audit_logs" ON public.audit_logs
  FOR SELECT USING (
    staff_id IN (
      SELECT id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
