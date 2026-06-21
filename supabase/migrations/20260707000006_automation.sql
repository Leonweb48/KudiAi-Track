-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 7: Automation, Cleanup & Analytics
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Disappearing Messages: set expires_at on insert ──────────────────────────

CREATE OR REPLACE FUNCTION public.set_message_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_duration text;
BEGIN
  SELECT disappearing_messages INTO v_duration
  FROM public.org_chat_settings WHERE org_id = NEW.org_id;

  NEW.expires_at := CASE v_duration
    WHEN '24h' THEN now() + interval '24 hours'
    WHEN '7d'  THEN now() + interval '7 days'
    WHEN '30d' THEN now() + interval '30 days'
    WHEN '90d' THEN now() + interval '90 days'
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_expiry ON public.org_group_messages;
CREATE TRIGGER trg_set_expiry
  BEFORE INSERT ON public.org_group_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_message_expiry();

-- ── Disappearing Messages: cleanup function ───────────────────────────────────
-- Schedule via pg_cron: SELECT cron.schedule('expire-msgs','0 * * * *','SELECT public.expire_disappearing_messages();');

CREATE OR REPLACE FUNCTION public.expire_disappearing_messages()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    UPDATE public.org_group_messages
    SET is_deleted = true, content = null, media_url = null
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
      AND is_deleted = false
      AND is_kept    = false
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;

  RETURN v_count;
END;
$$;

-- ── Invite: auto-increment use_count ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_invite_use(p_code text)
RETURNS public.group_invites LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite public.group_invites;
BEGIN
  UPDATE public.group_invites
  SET use_count = use_count + 1
  WHERE code      = p_code
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_uses   IS NULL OR use_count  < max_uses)
  RETURNING * INTO v_invite;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite' USING HINT = 'Invite not found, expired, or exhausted';
  END IF;

  -- Auto-deactivate if max uses reached
  IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
    UPDATE public.group_invites SET is_active = false WHERE id = v_invite.id;
  END IF;

  RETURN v_invite;
END;
$$;

-- ── Mute expiry: auto-unmute when muted_until passes ─────────────────────────
-- Schedule via pg_cron: SELECT cron.schedule('unmute-expired','*/15 * * * *','SELECT public.expire_mutes();');

CREATE OR REPLACE FUNCTION public.expire_mutes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count integer;
BEGIN
  WITH unmuted AS (
    UPDATE public.org_members
    SET is_muted = false, muted_until = null
    WHERE is_muted = true AND muted_until IS NOT NULL AND muted_until < now()
    RETURNING id, org_id
  ),
  del_mutes AS (
    DELETE FROM public.group_mutes
    WHERE (org_id, member_id) IN (SELECT org_id, id FROM unmuted)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM unmuted;
  RETURN v_count;
END;
$$;

-- ── Analytics: group activity summary ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_group_analytics(
  p_org_id uuid,
  p_days   integer DEFAULT 30
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'total_members',     (SELECT count(*) FROM public.org_members WHERE org_id = p_org_id AND status = 'active'),
    'online_now',        0,  -- populated from Realtime presence in app layer
    'total_messages',    (SELECT count(*) FROM public.org_group_messages WHERE org_id = p_org_id AND NOT is_deleted),
    'messages_last_7d',  (SELECT count(*) FROM public.org_group_messages WHERE org_id = p_org_id AND created_at > now() - interval '7 days' AND NOT is_deleted),
    'messages_last_30d', (SELECT count(*) FROM public.org_group_messages WHERE org_id = p_org_id AND created_at > now() - interval '30 days' AND NOT is_deleted),
    'active_members_7d', (SELECT count(DISTINCT sender_id) FROM public.org_group_messages WHERE org_id = p_org_id AND created_at > now() - interval '7 days' AND NOT is_deleted),
    'media_shared',      (SELECT count(*) FROM public.group_media WHERE org_id = p_org_id),
    'polls_created',     (SELECT count(*) FROM public.group_polls WHERE org_id = p_org_id),
    'events_created',    (SELECT count(*) FROM public.group_events WHERE org_id = p_org_id),
    'voice_sessions',    (SELECT count(*) FROM public.group_voice_rooms WHERE org_id = p_org_id),
    'reports_pending',   (SELECT count(*) FROM public.group_reports WHERE org_id = p_org_id AND status = 'pending'),
    'join_requests',     (SELECT count(*) FROM public.group_join_requests WHERE org_id = p_org_id AND status = 'pending'),
    'top_contributors',  (
      SELECT jsonb_agg(jsonb_build_object(
        'member_id',  member_id,
        'full_name',  full_name,
        'avatar_url', avatar_url,
        'points',     reputation_points,
        'level',      level,
        'rank',       rank
      ) ORDER BY rank)
      FROM public.group_leaderboard
      WHERE org_id = p_org_id
      LIMIT 5
    ),
    'new_members_30d', (
      SELECT count(*) FROM public.org_members
      WHERE org_id = p_org_id AND status = 'active'
        AND created_at > now() - interval '30 days'
    ),
    'daily_messages', (
      SELECT jsonb_agg(jsonb_build_object('date', day, 'count', cnt) ORDER BY day)
      FROM (
        SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
        FROM public.org_group_messages
        WHERE org_id = p_org_id
          AND created_at > now() - (p_days || ' days')::interval
          AND NOT is_deleted
        GROUP BY 1
        ORDER BY 1
      ) t
    )
  );
$$;

-- ── Member count sync on status change ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_org_member_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.organizations
  SET member_count = (
    SELECT count(*) FROM public.org_members
    WHERE org_id = COALESCE(NEW.org_id, OLD.org_id) AND status = 'active'
  )
  WHERE id = COALESCE(NEW.org_id, OLD.org_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_count ON public.org_members;
CREATE TRIGGER trg_member_count
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_member_count();

-- ── Announce new member via system message ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.welcome_new_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_welcome text;
  v_org_id  uuid := NEW.org_id;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    SELECT welcome_message INTO v_welcome FROM public.org_chat_settings WHERE org_id = v_org_id;

    IF v_welcome IS NOT NULL THEN
      INSERT INTO public.org_group_messages (org_id, sender_id, sender_name, content, type)
      VALUES (
        v_org_id,
        NEW.user_id,
        'System',
        replace(v_welcome, '{name}', NEW.full_name),
        'system'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_welcome_member ON public.org_members;
CREATE TRIGGER trg_welcome_member
  AFTER INSERT ON public.org_members
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.welcome_new_member();

-- ── pg_cron job registration (uncomment on Supabase Pro) ─────────────────────
-- SELECT cron.schedule('expire-msgs',   '0 * * * *',    'SELECT public.expire_disappearing_messages();');
-- SELECT cron.schedule('expire-mutes',  '*/15 * * * *', 'SELECT public.expire_mutes();');
-- SELECT cron.schedule('check-milestones','0 0 * * *',  'SELECT public.check_milestones_all();');
