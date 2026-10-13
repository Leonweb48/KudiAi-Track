-- Wallet Tier 3, bank-style (2026-10-13). Until now "Request Tier 3" only sent a note and staff collected the documents
-- outside the app. Now, like a bank:
--   1. the customer uploads every document in the app (valid ID — front and, for cards, back — a recent utility bill
--      and a passport photograph) to a PRIVATE bucket, plus their ID type, ID number and address;
--   2. an admin opens each document (short-lived signed links in the admin portal), ticks it as checked, and only then
--      can approve — the database refuses a Tier 3 approval without the documents, or without every one ticked;
--   3. a rejection carries a reason the customer sees in the app, and they can submit again.
-- The tier itself still changes ONLY through wallet_admin_review_tier → wallet_set_tier (service role).

-- ── 1. Private bucket ────────────────────────────────────────────────────────────────────────────────────────────────
-- Never public. A signed-in user may only ADD files under their own "<user id>/tier3/" folder; there is no read, update or
-- delete policy, so nobody but the service role (the edge function and the admin portal) can open or remove them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('kyc_documents', 'kyc_documents', false, 6291456, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS kyc_documents_insert_own ON storage.objects;
CREATE POLICY kyc_documents_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc_documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'tier3'
  );

-- ── 2. What a Tier 3 request carries ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.wallet_tier_requests
  ADD COLUMN IF NOT EXISTS id_type           text,
  ADD COLUMN IF NOT EXISTS id_number         text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS documents         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{kind, path, mime, size}]
  ADD COLUMN IF NOT EXISTS submitted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS review_note       text,                                -- the reason the customer sees
  ADD COLUMN IF NOT EXISTS checked_documents text[];                              -- kinds the approving admin ticked

-- The documents each ID type needs. A passport and a NIN slip have nothing useful on the back.
CREATE OR REPLACE FUNCTION public.wallet_tier3_required_docs(p_id_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_id_type IN ('passport', 'nin_slip')
              THEN ARRAY['id_front', 'utility_bill', 'passport_photo']
              ELSE ARRAY['id_front', 'id_back', 'utility_bill', 'passport_photo'] END
$$;

-- ── 3. Submit (service role — the edge function has already checked the files exist in the bucket) ─────────────────
-- One pending request per user. A pending request with NO documents (made by the old "request" button) is completed
-- in place; one that already has documents is under review and is left alone.
CREATE OR REPLACE FUNCTION public.wallet_submit_tier3(
  p_user_id uuid, p_id_type text, p_id_number text, p_address text, p_documents jsonb, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tier smallint; v_req public.wallet_tier_requests; v_id uuid; v_missing text[];
BEGIN
  SELECT tier INTO v_tier FROM public.wallets WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_tier >= 3 THEN RETURN jsonb_build_object('requested', false, 'already_at_tier', true); END IF;
  IF v_tier < 2 THEN RETURN jsonb_build_object('requested', false, 'error', 'tier2_first'); END IF;
  IF p_id_type NOT IN ('national_id', 'nin_slip', 'voters_card', 'drivers_license', 'passport') THEN RAISE EXCEPTION 'bad id type'; END IF;

  SELECT array_agg(k) INTO v_missing FROM unnest(public.wallet_tier3_required_docs(p_id_type)) k
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d WHERE d->>'kind' = k);
  IF v_missing IS NOT NULL THEN RETURN jsonb_build_object('requested', false, 'error', 'missing_documents', 'missing', to_jsonb(v_missing)); END IF;

  SELECT * INTO v_req FROM public.wallet_tier_requests
   WHERE user_id = p_user_id AND target_tier = 3 AND status = 'pending' FOR UPDATE;
  IF FOUND AND jsonb_array_length(v_req.documents) > 0 THEN
    RETURN jsonb_build_object('requested', false, 'already_pending', true, 'request_id', v_req.id);
  END IF;

  IF FOUND THEN
    UPDATE public.wallet_tier_requests
       SET id_type = p_id_type, id_number = left(p_id_number, 40), address = left(p_address, 200), documents = p_documents,
           submitted_at = now(), note = coalesce(nullif(left(p_note, 500), ''), note)
     WHERE id = v_req.id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.wallet_tier_requests (user_id, target_tier, note, id_type, id_number, address, documents, submitted_at)
    VALUES (p_user_id, 3, nullif(left(p_note, 500), ''), p_id_type, left(p_id_number, 40), left(p_address, 200), p_documents, now())
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.admin_notifications (type, category, title, message, metadata)
  VALUES ('info', 'user', 'Tier 3 documents to review',
          'A wallet holder uploaded their ID, utility bill and passport photograph for Tier 3. Open the wallet''s KYC tab, check each document, then approve or reject.',
          jsonb_build_object('user_id', p_user_id, 'request_id', v_id, 'target_tier', 3));
  RETURN jsonb_build_object('requested', true, 'request_id', v_id);
END;
$$;

-- ── 4. Review: Tier 3 needs the documents AND every one ticked by the admin ─────────────────────────────────────────
-- New 6th argument (p_checked); the old 5-argument version is dropped so named calls stay unambiguous. An admin portal
-- that hasn't updated yet still calls with 5 named arguments, which now resolves here with p_checked = NULL — fine for
-- rejections and Tier 2, and a Tier 3 approval is (correctly) refused until the portal sends the ticks.
DROP FUNCTION IF EXISTS public.wallet_admin_review_tier(uuid, boolean, text, text, text);
CREATE OR REPLACE FUNCTION public.wallet_admin_review_tier(
  p_request_id     uuid,
  p_approve        boolean,
  p_note           text,
  p_admin_id       text,
  p_admin_username text,
  p_checked        text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req     public.wallet_tier_requests;
  v_wallet  public.wallets;
  v_note    text := btrim(coalesce(p_note, ''));
  v_kinds   text[];
  v_unseen  text[];
BEGIN
  IF coalesce(btrim(p_admin_id), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Admin id required'); END IF;
  IF length(v_note) < 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'Add a note (at least 5 characters)'); END IF;

  SELECT * INTO v_req FROM public.wallet_tier_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Tier request not found'); END IF;
  IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'This request was already ' || v_req.status); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_req.user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No wallet'); END IF;

  IF p_approve AND v_req.target_tier = 3 THEN
    SELECT array_agg(DISTINCT d->>'kind') INTO v_kinds FROM jsonb_array_elements(v_req.documents) d;
    IF v_kinds IS NULL OR EXISTS (SELECT 1 FROM unnest(public.wallet_tier3_required_docs(v_req.id_type)) k WHERE k <> ALL (v_kinds)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'The customer has not uploaded all the Tier 3 documents yet — it can''t be approved. Reject it with a note, or wait for the upload.');
    END IF;
    SELECT array_agg(k) INTO v_unseen FROM unnest(v_kinds) k WHERE k <> ALL (coalesce(p_checked, ARRAY[]::text[]));
    IF v_unseen IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Open and tick every document as checked before approving.', 'unchecked', to_jsonb(v_unseen));
    END IF;
  END IF;

  IF p_approve THEN
    PERFORM public.wallet_set_tier(v_req.user_id, v_req.target_tier, left(coalesce(p_admin_username, p_admin_id), 100));
    UPDATE public.wallet_tier_requests SET checked_documents = p_checked WHERE id = v_req.id;
  ELSE
    UPDATE public.wallet_tier_requests
       SET status = 'rejected', reviewed_at = now(), reviewed_by = left(coalesce(p_admin_username, p_admin_id), 100),
           review_note = left(v_note, 500), checked_documents = p_checked
     WHERE id = v_req.id;
  END IF;

  INSERT INTO public.wallet_admin_actions (wallet_id, user_id, action, from_status, to_status, reason, admin_id, admin_username, reference)
  VALUES (v_wallet.id, v_req.user_id, CASE WHEN p_approve THEN 'tier_approve' ELSE 'tier_reject' END,
          'tier ' || v_wallet.tier, CASE WHEN p_approve THEN 'tier ' || v_req.target_tier ELSE 'tier ' || v_wallet.tier END,
          left(v_note, 500), p_admin_id, p_admin_username, v_req.id::text);

  RETURN jsonb_build_object('ok', true, 'approved', p_approve, 'user_id', v_req.user_id, 'target_tier', v_req.target_tier,
                            'tier', CASE WHEN p_approve THEN v_req.target_tier ELSE v_wallet.tier END);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_tier3_required_docs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_tier3_required_docs(text) TO service_role;
REVOKE ALL ON FUNCTION public.wallet_submit_tier3(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_submit_tier3(uuid, text, text, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.wallet_admin_review_tier(uuid, boolean, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_admin_review_tier(uuid, boolean, text, text, text, text[]) TO service_role;

DO $$
DECLARE n_legacy int;
BEGIN
  SELECT count(*) INTO n_legacy FROM public.wallet_tier_requests WHERE target_tier = 3 AND status = 'pending' AND jsonb_array_length(documents) = 0;
  RAISE NOTICE 'tier3 | private kyc_documents bucket ready; % pending Tier 3 request(s) are waiting for the customer to upload documents', n_legacy;
END $$;
