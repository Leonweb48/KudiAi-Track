-- Allow ajo clients to upload and overwrite their own avatar.
-- Path structure enforced by uploadAjoAvatar: ajo/{aso_client_id}/avatar.{ext}
-- auth.uid() must be the client_user_id tied to that aso_clients row.

CREATE POLICY "ajo_avatar_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = 'ajo'
    AND EXISTS (
      SELECT 1 FROM public.aso_clients
      WHERE id::text = split_part(name, '/', 2)
        AND client_user_id = auth.uid()
    )
  );

CREATE POLICY "ajo_avatar_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = 'ajo'
    AND EXISTS (
      SELECT 1 FROM public.aso_clients
      WHERE id::text = split_part(name, '/', 2)
        AND client_user_id = auth.uid()
    )
  );
