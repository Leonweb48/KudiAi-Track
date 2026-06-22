-- Allow org members (not just admins) to create polls and events in the group chat
-- Also registers 'document' as a valid org_group_messages type

-- ── group_polls: member INSERT ───────────────────────────────────────────────
DROP POLICY IF EXISTS "poll_member_insert" ON public.group_polls;
CREATE POLICY "poll_member_insert" ON public.group_polls
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.can_access_org_chat(org_id)
  );

-- ── group_poll_options: member INSERT (for their own polls) ──────────────────
DROP POLICY IF EXISTS "pollopt_member_insert" ON public.group_poll_options;
CREATE POLICY "pollopt_member_insert" ON public.group_poll_options
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_polls
      WHERE id = poll_id AND created_by = auth.uid()
    )
  );

-- ── group_events: member INSERT ──────────────────────────────────────────────
DROP POLICY IF EXISTS "events_member_insert" ON public.group_events;
CREATE POLICY "events_member_insert" ON public.group_events
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.can_access_org_chat(org_id)
  );

-- ── org_group_messages: add 'document' to the type check constraint ──────────
DO $$
DECLARE v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.org_group_messages'::regclass
    AND contype = 'c'
    AND conname LIKE '%type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.org_group_messages DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
END$$;

ALTER TABLE public.org_group_messages
  ADD CONSTRAINT org_group_messages_type_check
  CHECK (type IN ('text','image','audio','file','system','poll','event','document'));
