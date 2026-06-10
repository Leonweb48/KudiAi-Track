-- ═══════════════════════════════════════════════════════
--  COOPERATIVE SYSTEM v2 — Extended Features
-- ═══════════════════════════════════════════════════════

-- Drop & widen type constraint to support all org types
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_type_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_type_check
  CHECK (type IN ('cooperative','market_association','church','ngo','youth_group',
                  'savings_group','community_group','professional_association','savings_club'));

-- Extend organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS purpose              text,
  ADD COLUMN IF NOT EXISTS vision               text,
  ADD COLUMN IF NOT EXISTS mission              text,
  ADD COLUMN IF NOT EXISTS website              text,
  ADD COLUMN IF NOT EXISTS social_instagram     text,
  ADD COLUMN IF NOT EXISTS social_facebook      text,
  ADD COLUMN IF NOT EXISTS social_twitter       text,
  ADD COLUMN IF NOT EXISTS date_established     date,
  ADD COLUMN IF NOT EXISTS registration_fee     numeric DEFAULT 0;

-- Extend org_members
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS gender               text,
  ADD COLUMN IF NOT EXISTS next_of_kin          text,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone    text,
  ADD COLUMN IF NOT EXISTS privacy_balance      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_contributions boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_activities   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS must_change_pin      boolean DEFAULT false;

-- Extend org_meetings
ALTER TABLE public.org_meetings
  ADD COLUMN IF NOT EXISTS format               text DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS meeting_link         text,
  ADD COLUMN IF NOT EXISTS agenda               text;

-- Add program tracking to savings
ALTER TABLE public.org_savings
  ADD COLUMN IF NOT EXISTS program_id uuid;

-- ── Org Leaders ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_leaders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name          text NOT NULL,
  position      text NOT NULL,
  phone         text,
  email         text,
  sort_order    int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.org_leaders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_leaders_owner" ON public.org_leaders;
CREATE POLICY "org_leaders_owner" ON public.org_leaders
  USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

-- ── Contribution Programs ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_contribution_programs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name              text NOT NULL,
  description       text,
  contribution_type text DEFAULT 'fixed'  CHECK (contribution_type IN ('fixed','voluntary')),
  amount            numeric DEFAULT 0,
  frequency         text DEFAULT 'monthly'
    CHECK (frequency IN ('daily','weekly','monthly','quarterly','annual','one_time')),
  due_day           int,
  status            text DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  target_amount     numeric,
  created_at        timestamptz DEFAULT now()
);
ALTER TABLE public.org_contribution_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "programs_owner" ON public.org_contribution_programs;
CREATE POLICY "programs_owner" ON public.org_contribution_programs
  USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

-- ── Announcements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  author_name text DEFAULT 'Admin',
  type        text DEFAULT 'announcement'
    CHECK (type IN ('announcement','notice','circular','emergency')),
  title       text NOT NULL,
  body        text NOT NULL,
  is_pinned   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.org_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcements_owner" ON public.org_announcements;
CREATE POLICY "announcements_owner" ON public.org_announcements
  USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

-- ── Meeting RSVP ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_meeting_rsvp (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid REFERENCES public.org_meetings(id) ON DELETE CASCADE NOT NULL,
  member_id   uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  org_id      uuid NOT NULL,
  status      text DEFAULT 'attending'
    CHECK (status IN ('attending','maybe','not_attending')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(meeting_id, member_id)
);
ALTER TABLE public.org_meeting_rsvp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rsvp_open" ON public.org_meeting_rsvp;
CREATE POLICY "rsvp_open" ON public.org_meeting_rsvp USING (true);

-- ── Org Withdrawals ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_withdrawals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  program_id    uuid REFERENCES public.org_contribution_programs(id),
  purpose       text NOT NULL,
  total_amount  numeric NOT NULL,
  method        text DEFAULT 'equal' CHECK (method IN ('equal','individual')),
  authorized_by text,
  notes         text,
  member_count  int DEFAULT 0,
  status        text DEFAULT 'completed',
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.org_withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "withdrawals_owner" ON public.org_withdrawals;
CREATE POLICY "withdrawals_owner" ON public.org_withdrawals
  USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.org_withdrawal_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid REFERENCES public.org_withdrawals(id) ON DELETE CASCADE NOT NULL,
  member_id     uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  member_name   text,
  amount        numeric NOT NULL,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.org_withdrawal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wi_open" ON public.org_withdrawal_items;
CREATE POLICY "wi_open" ON public.org_withdrawal_items USING (true);
