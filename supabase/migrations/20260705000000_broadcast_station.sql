-- ── Broadcast Station: Events + Polls ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  event_type   text NOT NULL DEFAULT 'event'
               CHECK (event_type IN ('event','workshop','training','social','fundraiser')),
  event_date   timestamptz NOT NULL,
  end_date     timestamptz,
  location     text,
  event_link   text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_polls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  question    text NOT NULL,
  options     jsonb NOT NULL DEFAULT '[]',
  closes_at   timestamptz,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_poll_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id      uuid NOT NULL REFERENCES public.org_polls(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.org_members(id) ON DELETE CASCADE,
  option_index integer NOT NULL,
  voted_at     timestamptz DEFAULT now(),
  UNIQUE (poll_id, member_id)
);

-- RLS
ALTER TABLE public.org_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_poll_votes ENABLE ROW LEVEL SECURITY;

-- Org owners can do everything
CREATE POLICY "events_owner"      ON public.org_events     FOR ALL USING (org_id IN (SELECT my_owned_org_ids()));
CREATE POLICY "polls_owner"       ON public.org_polls      FOR ALL USING (org_id IN (SELECT my_owned_org_ids()));
CREATE POLICY "poll_votes_owner"  ON public.org_poll_votes FOR ALL USING (
  poll_id IN (SELECT id FROM public.org_polls WHERE org_id IN (SELECT my_owned_org_ids()))
);

-- Members can read events/polls for their org
CREATE POLICY "events_member_read" ON public.org_events FOR SELECT
  USING (org_id = (SELECT my_member_org_id()));
CREATE POLICY "polls_member_read"  ON public.org_polls  FOR SELECT
  USING (org_id = (SELECT my_member_org_id()));

-- Members can insert and read their own votes
CREATE POLICY "poll_votes_member_insert" ON public.org_poll_votes FOR INSERT
  WITH CHECK (member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid()));
CREATE POLICY "poll_votes_member_read"   ON public.org_poll_votes FOR SELECT
  USING (member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
      OR poll_id IN (SELECT id FROM public.org_polls WHERE org_id IN (SELECT my_owned_org_ids())));
