-- ── chat-media Storage bucket for group chat images & voice messages ──────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','audio/webm','audio/mp4','audio/ogg','audio/mpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can upload (org members, admin, portal user)
CREATE POLICY "chat_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'chat-media' AND auth.uid() IS NOT NULL);

-- Public read (images/audio served directly via public URL)
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-media');

-- Uploader can delete their own file
CREATE POLICY "chat_media_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'chat-media' AND auth.uid() IS NOT NULL);
