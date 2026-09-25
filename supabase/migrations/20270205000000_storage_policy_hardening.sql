-- Storage policy hardening from the 2026-09-25 security review. Only policies with no current legitimate user are removed:
--
--  • ajo_proofs_insert    — let ANYONE (even logged-out) upload files into the ajo-proofs bucket. Nothing in the app writes
--                           there any more (Ajo photos go through the ajo-portal edge function with the service role).
--                           The bucket itself stays public so deposit proofs already stored keep displaying.
--  • avatars_delete       — let any logged-in user delete ANY avatar object. Nothing in the app deletes avatars.
--  • ticket_attach_read / ticket_attach_upload — let any logged-in user read every support-ticket attachment in a private
--                           bucket. No app or admin-portal code uses this bucket (the admin portal uses the service role).
--
-- Left alone on purpose: avatars_insert / avatars_update (any logged-in user can still write ANY avatar path) because avatars
-- use at least six different path layouts (users/<id>/…, clients/aso/<id>, orgs/<id>/…, members/<id>/…, staff/…, ajo/…);
-- tightening them needs one ownership rule per layout and a coordinated app change.

DROP POLICY IF EXISTS "ajo_proofs_insert"    ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete"       ON storage.objects;
DROP POLICY IF EXISTS "ticket_attach_read"   ON storage.objects;
DROP POLICY IF EXISTS "ticket_attach_upload" ON storage.objects;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, cmd, roles::text AS roles
             FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (roles::text ~ '(anon|public)') ORDER BY policyname LOOP
    RAISE NOTICE 'storage | remaining policy open to public/anon: % (%) roles=%', r.policyname, r.cmd, r.roles;
  END LOOP;
END $$;
