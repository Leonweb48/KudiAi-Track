-- Security audit 2026-10-25: user uploads are served from the app's own address (kudiai.app/sb/storage/…), and the
-- avatars / invoice-logos / store-logos buckets accepted ANY file type — an uploaded SVG or HTML "logo" opened by its link
-- would run script as kudiai.app and could read the session. These buckets now take real image formats only (no SVG).
-- vercel.json also sandboxes any .svg/.html/.xml served from storage, so files already there can't run script either.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
 WHERE id IN ('avatars', 'invoice-logos', 'store-logos');

DO $$
BEGIN
  RAISE NOTICE 'image buckets | % bucket(s) limited to image formats',
    (SELECT count(*) FROM storage.buckets WHERE id IN ('avatars', 'invoice-logos', 'store-logos') AND allowed_mime_types IS NOT NULL);
END $$;
