-- ══════════════════════════════════════════════════════
--  Storage bucket for invoice logo uploads.
--  Run once in Supabase SQL editor.
-- ══════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-logos', 'invoice-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Users can upload/update only inside their own folder (first path segment = user_id)
CREATE POLICY "invoice_logos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoice-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "invoice_logos_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'invoice-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "invoice_logos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'invoice-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public read so logos appear in PDFs without auth
CREATE POLICY "invoice_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoice-logos');
