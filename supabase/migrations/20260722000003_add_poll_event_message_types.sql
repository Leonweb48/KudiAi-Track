-- Allow 'poll' and 'event' as message types in org_group_messages

DO $$
DECLARE v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.org_group_messages'::regclass AND contype = 'c' AND conname LIKE '%type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.org_group_messages DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
END$$;

ALTER TABLE public.org_group_messages
  ADD CONSTRAINT org_group_messages_type_check
  CHECK (type IN ('text','image','audio','file','system','poll','event'));
