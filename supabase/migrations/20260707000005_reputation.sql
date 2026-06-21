-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 6: Reputation, Badges & Leaderboard
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Badge Definitions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_badges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name         text        NOT NULL,
  description  text,
  icon         text        NOT NULL DEFAULT '🏅',
  color        text        DEFAULT '#f59e0b',
  category     text        DEFAULT 'engagement'
                           CHECK (category IN (
                             'engagement','milestone','moderation','special','top_contributor'
                           )),
  -- auto-award criteria
  auto_award   boolean     DEFAULT false,
  criteria_type text       CHECK (criteria_type IN ('message_count','reputation','days_active','events_attended','polls_voted',NULL)),
  criteria_value integer,
  -- visibility
  is_active    boolean     DEFAULT true,
  sort_order   smallint    DEFAULT 0,
  created_by   uuid,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badges_org ON public.group_badges(org_id, is_active);
ALTER TABLE public.group_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badge_def_select"  ON public.group_badges
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "badge_def_manage"  ON public.group_badges
  FOR ALL    USING (public.is_org_admin(org_id));

-- Seed a few default badges per org on settings upsert
-- (Application layer calls award_badge after org creation)

-- ── Member Badges (awarded) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_member_badges (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id    uuid        REFERENCES public.group_badges(id) ON DELETE CASCADE NOT NULL,
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id   uuid        REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  awarded_by  uuid,
  awarded_at  timestamptz DEFAULT now(),
  note        text,
  UNIQUE(badge_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_member_badges_member ON public.group_member_badges(org_id, member_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_badge  ON public.group_member_badges(badge_id);
ALTER TABLE public.group_member_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mbadge_select"  ON public.group_member_badges
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "mbadge_manage"  ON public.group_member_badges
  FOR ALL    USING (public.is_org_admin(org_id));

-- Trigger: keep org_members.badge_count in sync
CREATE OR REPLACE FUNCTION public.sync_badge_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member_id uuid := COALESCE(NEW.member_id, OLD.member_id);
BEGIN
  UPDATE public.org_members
  SET badge_count = (
    SELECT count(*) FROM public.group_member_badges
    WHERE member_id = v_member_id
  )
  WHERE id = v_member_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_badge_count ON public.group_member_badges;
CREATE TRIGGER trg_badge_count
  AFTER INSERT OR DELETE ON public.group_member_badges
  FOR EACH ROW EXECUTE FUNCTION public.sync_badge_count();

-- ── Reputation Points Log ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_reputation_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id   uuid        REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid,
  points      integer     NOT NULL,
  action      text        NOT NULL
                          CHECK (action IN (
                            'message_sent','media_shared','reaction_received',
                            'poll_voted','event_attended','voice_joined',
                            'helpful_reply','milestone_reached','badge_earned',
                            'admin_grant','admin_deduct'
                          )),
  reference_id uuid,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_log_member ON public.group_reputation_log(org_id, member_id, created_at DESC);
ALTER TABLE public.group_reputation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rep_select"  ON public.group_reputation_log
  FOR SELECT USING (
    member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
    OR public.is_org_mod_or_above(org_id)
  );

-- ── Award Reputation (callable from triggers and API) ────────────────────────

CREATE OR REPLACE FUNCTION public.award_reputation(
  p_org_id    uuid,
  p_member_id uuid,
  p_points    integer,
  p_action    text,
  p_ref_id    uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id    uuid;
  v_new_points integer;
  v_new_level  smallint;
BEGIN
  SELECT user_id INTO v_user_id FROM public.org_members WHERE id = p_member_id;

  INSERT INTO public.group_reputation_log (org_id, member_id, user_id, points, action, reference_id)
  VALUES (p_org_id, p_member_id, v_user_id, p_points, p_action, p_ref_id);

  UPDATE public.org_members
  SET reputation_points = reputation_points + p_points
  WHERE id = p_member_id
  RETURNING reputation_points INTO v_new_points;

  -- Level thresholds: 1→0, 2→100, 3→300, 4→600, 5→1000, 6→2000, 7→4000, 8→7000, 9→12000, 10→20000
  v_new_level := CASE
    WHEN v_new_points <    100 THEN 1
    WHEN v_new_points <    300 THEN 2
    WHEN v_new_points <    600 THEN 3
    WHEN v_new_points <   1000 THEN 4
    WHEN v_new_points <   2000 THEN 5
    WHEN v_new_points <   4000 THEN 6
    WHEN v_new_points <   7000 THEN 7
    WHEN v_new_points <  12000 THEN 8
    WHEN v_new_points <  20000 THEN 9
    ELSE 10
  END;

  UPDATE public.org_members SET level = v_new_level WHERE id = p_member_id;
END;
$$;

-- ── Leaderboard View ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.group_leaderboard AS
SELECT
  m.id             AS member_id,
  m.org_id,
  m.full_name,
  m.avatar_url,
  m.chat_role,
  m.reputation_points,
  m.level,
  m.badge_count,
  m.message_count,
  rank() OVER (PARTITION BY m.org_id ORDER BY m.reputation_points DESC) AS rank,
  rank() OVER (PARTITION BY m.org_id ORDER BY m.message_count      DESC) AS message_rank
FROM public.org_members m
WHERE m.status = 'active' AND m.is_banned = false;

-- ── Trigger: award points on message send ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rep_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member record;
  v_points integer := 2;
BEGIN
  IF NEW.is_deleted OR NEW.sender_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_member FROM public.org_members
  WHERE org_id = NEW.org_id AND user_id = NEW.sender_id AND status = 'active'
  LIMIT 1;

  IF v_member.id IS NOT NULL THEN
    -- Media earns more points than plain text
    IF NEW.type IN ('image','audio','file') THEN v_points := 5; END IF;
    -- Announcements earn more
    IF NEW.is_announcement THEN v_points := 10; END IF;

    PERFORM public.award_reputation(NEW.org_id, v_member.id, v_points, 'message_sent', NEW.id);

    -- Update message_count
    UPDATE public.org_members SET
      message_count   = message_count + 1,
      last_active_at  = now()
    WHERE id = v_member.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rep_message ON public.org_group_messages;
CREATE TRIGGER trg_rep_message
  AFTER INSERT ON public.org_group_messages
  FOR EACH ROW
  WHEN (NEW.type <> 'system')
  EXECUTE FUNCTION public.rep_on_message();

-- ── Trigger: award points on poll vote ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rep_on_poll_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_member record;
BEGIN
  SELECT id INTO v_member FROM public.org_members
  WHERE org_id = NEW.org_id AND user_id = NEW.user_id AND status = 'active'
  LIMIT 1;

  IF v_member.id IS NOT NULL THEN
    PERFORM public.award_reputation(NEW.org_id, v_member.id, 3, 'poll_voted', NEW.poll_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rep_poll ON public.group_poll_votes;
CREATE TRIGGER trg_rep_poll
  AFTER INSERT ON public.group_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.rep_on_poll_vote();

-- ── Trigger: award points on voice join ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rep_on_voice_join()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_member record;
BEGIN
  SELECT id INTO v_member FROM public.org_members
  WHERE org_id = NEW.org_id AND user_id = NEW.user_id AND status = 'active'
  LIMIT 1;

  IF v_member.id IS NOT NULL THEN
    PERFORM public.award_reputation(NEW.org_id, v_member.id, 5, 'voice_joined', NEW.room_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rep_voice ON public.group_voice_participants;
CREATE TRIGGER trg_rep_voice
  AFTER INSERT ON public.group_voice_participants
  FOR EACH ROW EXECUTE FUNCTION public.rep_on_voice_join();

-- ── Auto-award badge when criteria met ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_auto_badges(p_org_id uuid, p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member  public.org_members;
  v_badge   public.group_badges;
BEGIN
  SELECT * INTO v_member FROM public.org_members WHERE id = p_member_id;

  FOR v_badge IN
    SELECT * FROM public.group_badges
    WHERE org_id = p_org_id AND auto_award = true AND is_active = true
      AND id NOT IN (
        SELECT badge_id FROM public.group_member_badges WHERE member_id = p_member_id
      )
  LOOP
    IF (v_badge.criteria_type = 'message_count'  AND v_member.message_count     >= v_badge.criteria_value) OR
       (v_badge.criteria_type = 'reputation'      AND v_member.reputation_points >= v_badge.criteria_value)
    THEN
      INSERT INTO public.group_member_badges (badge_id, org_id, member_id, awarded_by, note)
      VALUES (v_badge.id, p_org_id, p_member_id, NULL, 'Auto-awarded')
      ON CONFLICT DO NOTHING;

      PERFORM public.award_reputation(p_org_id, p_member_id, 20, 'badge_earned', v_badge.id);

      PERFORM public.log_audit_event(
        p_org_id, NULL, NULL, 'badge_awarded',
        'member', p_member_id, v_member.full_name,
        jsonb_build_object('badge', v_badge.name)
      );
    END IF;
  END LOOP;
END;
$$;
