-- ── Group chat metadata editable by org admin ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_chat_settings (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  chat_name   text,
  description text,
  rules       text,
  emoji       text DEFAULT '💬',
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid
);

ALTER TABLE public.org_chat_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_settings_select" ON public.org_chat_settings
  FOR SELECT USING (public.can_access_org_chat(org_id));

CREATE POLICY "chat_settings_write" ON public.org_chat_settings
  FOR ALL USING (
    org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  );

-- Enable realtime for read-cursor updates (last seen)
ALTER TABLE public.org_chat_reads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.org_chat_reads;
