-- ── Fix org_poll_votes: switch from member_id to user_id for chat-based voting ─

-- Make member_id nullable (it was designed for the org portal; chat uses user_id)
ALTER TABLE public.org_poll_votes ALTER COLUMN member_id DROP NOT NULL;

-- Add user_id and org_id columns used by the chat poll bubble
ALTER TABLE public.org_poll_votes
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS org_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Drop the member_id-based unique constraint and add a user_id-based one
ALTER TABLE public.org_poll_votes
  DROP CONSTRAINT IF EXISTS org_poll_votes_poll_id_member_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_poll_votes_poll_user_key'
  ) THEN
    ALTER TABLE public.org_poll_votes
      ADD CONSTRAINT org_poll_votes_poll_user_key UNIQUE (poll_id, user_id);
  END IF;
END$$;

-- Rebuild RLS policies
DROP POLICY IF EXISTS "poll_votes_owner"          ON public.org_poll_votes;
DROP POLICY IF EXISTS "poll_votes_member_insert"  ON public.org_poll_votes;
DROP POLICY IF EXISTS "poll_votes_member_read"    ON public.org_poll_votes;

-- Owner / portal user sees all votes for their org's polls
CREATE POLICY "poll_votes_owner" ON public.org_poll_votes FOR ALL
  USING (poll_id IN (
    SELECT id FROM public.org_polls WHERE org_id IN (SELECT my_owned_org_ids())
  ));

-- Members can read ALL votes for polls in their org (needed to show % bars)
CREATE POLICY "poll_votes_member_read" ON public.org_poll_votes FOR SELECT
  USING (
    poll_id IN (
      SELECT id FROM public.org_polls WHERE org_id = (SELECT my_member_org_id())
    )
  );

-- Members can cast a vote
CREATE POLICY "poll_votes_member_insert" ON public.org_poll_votes FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Members can un-vote (delete their own vote)
CREATE POLICY "poll_votes_member_delete" ON public.org_poll_votes FOR DELETE
  USING (user_id = auth.uid());

-- ── org_event_rsvps: RSVP table for org_events ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_event_rsvps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES public.org_events(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL,
  member_name text,
  status      text        NOT NULL DEFAULT 'going'
              CHECK (status IN ('going','maybe','not_going')),
  rsvp_at     timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_rsvp_event ON public.org_event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_org_rsvp_user  ON public.org_event_rsvps(user_id);

ALTER TABLE public.org_event_rsvps ENABLE ROW LEVEL SECURITY;

-- Owner / portal user sees all RSVPs
CREATE POLICY "org_rsvp_owner" ON public.org_event_rsvps FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

-- Members can read all RSVPs for events in their org (to show counts)
CREATE POLICY "org_rsvp_member_read" ON public.org_event_rsvps FOR SELECT
  USING (
    org_id = (SELECT my_member_org_id())
    OR user_id = auth.uid()
  );

-- Members can insert their own RSVP
CREATE POLICY "org_rsvp_member_insert" ON public.org_event_rsvps FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Members can update their own RSVP status
CREATE POLICY "org_rsvp_member_update" ON public.org_event_rsvps FOR UPDATE
  USING (user_id = auth.uid());

-- Members can remove their own RSVP
CREATE POLICY "org_rsvp_member_delete" ON public.org_event_rsvps FOR DELETE
  USING (user_id = auth.uid());
