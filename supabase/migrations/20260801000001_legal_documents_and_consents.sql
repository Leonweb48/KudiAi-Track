-- ── Legal documents: versioned T&C and Privacy Policy edited by super admin ──
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  type                 text        NOT NULL CHECK (type IN ('tnc', 'privacy')),
  content              text        NOT NULL DEFAULT '',
  version              integer     NOT NULL DEFAULT 1,
  status               text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  published_by         text,
  editor_name          text,
  requires_reacceptance boolean    NOT NULL DEFAULT false,
  change_summary       text        NOT NULL DEFAULT ''
);

-- Index for fast "latest published" lookup
CREATE INDEX IF NOT EXISTS legal_documents_type_status_version_idx
  ON public.legal_documents (type, status, version DESC);

-- RLS: published docs are publicly readable; writes go through service role (admin API)
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published legal documents"
  ON public.legal_documents FOR SELECT
  USING (status = 'published');

-- ── User consents: full audit trail — one row per consent event ───────────────
CREATE TABLE IF NOT EXISTS public.user_consents (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tnc_version    integer     NOT NULL,
  privacy_version integer    NOT NULL,
  consented_at   timestamptz NOT NULL DEFAULT now(),
  ip_address     text
);

-- Index for fast "has this user consented?" lookup
CREATE INDEX IF NOT EXISTS user_consents_user_id_idx
  ON public.user_consents (user_id, consented_at DESC);

-- RLS: users can insert and read their own consent records
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own consent"
  ON public.user_consents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own consent"
  ON public.user_consents FOR SELECT
  USING (auth.uid() = user_id);

-- ── Seed: initial draft placeholder so the admin editor is not blank ──────────
INSERT INTO public.legal_documents (type, version, status, editor_name, content)
VALUES
  ('tnc', 1, 'draft', 'System', '<h2>Terms &amp; Conditions</h2><p>Draft content — edit and publish in the admin panel.</p>'),
  ('privacy', 1, 'draft', 'System', '<h2>Privacy Policy</h2><p>Draft content — edit and publish in the admin panel.</p>')
ON CONFLICT DO NOTHING;
