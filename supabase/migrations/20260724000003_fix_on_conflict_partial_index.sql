-- Migration 20260724000002 replaced the full UNIQUE constraint on
-- notifications.dedupe_key with a partial unique index:
--   UNIQUE (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL
--
-- Two RPCs that INSERT directly into notifications used
--   ON CONFLICT (dedupe_key) DO NOTHING
-- which requires a full unique constraint/index to resolve. With the partial
-- index those statements now error with "no unique constraint matching ON CONFLICT".
--
-- Fix: rewrite both RPCs to reference the partial index explicitly by adding
-- the same WHERE predicate to the ON CONFLICT specification.
-- Behaviour is unchanged for the "still-unread row" case; after a row is read
-- the partial index does not apply, so a new INSERT now succeeds (correct).

-- ── 1. manager_update_staff_permission ───────────────────────────────────────
CREATE OR REPLACE FUNCTION manager_update_staff_permission(
  p_target_staff_id uuid,
  p_module          text,
  p_field           text,
  p_value           boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_staff_id  uuid;
  v_manager_branch    uuid;
  v_manager_owner     uuid;
  v_target_branch     uuid;
  v_target_owner      uuid;
  v_manager_ceiling   boolean;
BEGIN
  SELECT s.id, s.branch_id, s.owner_id
  INTO v_manager_staff_id, v_manager_branch, v_manager_owner
  FROM staff s
  WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  LIMIT 1;

  IF v_manager_staff_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Only an active manager can update permissions');
  END IF;

  IF p_target_staff_id = v_manager_staff_id THEN
    RETURN jsonb_build_object('error', 'You cannot edit your own permissions');
  END IF;

  IF p_field NOT IN ('can_view', 'can_create') THEN
    RETURN jsonb_build_object('error',
      format('Invalid field "%s" — valid values are can_view and can_create', p_field));
  END IF;

  SELECT s.branch_id, s.owner_id
  INTO v_target_branch, v_target_owner
  FROM staff s
  WHERE s.id = p_target_staff_id AND s.status = 'active';

  IF v_target_branch IS NULL OR v_target_branch IS DISTINCT FROM v_manager_branch THEN
    RETURN jsonb_build_object('error', 'Target staff member is not on your branch');
  END IF;
  IF v_target_owner IS DISTINCT FROM v_manager_owner THEN
    RETURN jsonb_build_object('error', 'Target staff member is not under the same owner');
  END IF;

  IF p_value = true THEN
    SELECT CASE
      WHEN p_field = 'can_view'   THEN sp.can_view
      WHEN p_field = 'can_create' THEN sp.can_create
    END
    INTO v_manager_ceiling
    FROM staff_permissions sp
    WHERE sp.staff_id = v_manager_staff_id AND sp.module = p_module;

    IF NOT COALESCE(v_manager_ceiling, false) THEN
      RETURN jsonb_build_object('error',
        format('Cannot grant "%s.%s" — you do not hold this permission', p_module, p_field));
    END IF;
  END IF;

  INSERT INTO staff_permissions (staff_id, module, can_view, can_create)
  VALUES (
    p_target_staff_id,
    p_module,
    CASE WHEN p_field = 'can_view'   THEN p_value ELSE false END,
    CASE WHEN p_field = 'can_create' THEN p_value ELSE false END
  )
  ON CONFLICT (staff_id, module) DO UPDATE SET
    can_view   = CASE WHEN p_field = 'can_view'   THEN p_value ELSE staff_permissions.can_view   END,
    can_create = CASE WHEN p_field = 'can_create' THEN p_value ELSE staff_permissions.can_create END;

  INSERT INTO audit_logs (staff_id, owner_id, action, details, module, changed_by)
  VALUES (
    p_target_staff_id,
    v_manager_owner,
    'permission_updated_by_manager',
    format('%s.%s set to %s by manager', p_module, p_field, p_value),
    'permissions',
    v_manager_staff_id
  );

  -- Notify owner — partial-index-aware ON CONFLICT
  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  SELECT
    v_manager_owner,
    'info',
    'Permission Updated',
    format('%s updated %s access for a staff member',
      (SELECT full_name FROM staff WHERE id = v_manager_staff_id),
      p_module),
    'normal',
    format('perm_update_%s_%s_%s', p_target_staff_id, p_module, p_field)
  ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

  -- Notify target staff member — partial-index-aware ON CONFLICT
  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  SELECT
    s.user_id,
    'info',
    'Your Permissions Changed',
    format('Your %s.%s permission was updated by your branch manager', p_module, p_field),
    'normal',
    format('perm_self_%s_%s_%s_%s', p_target_staff_id, p_module, p_field, now()::date)
  FROM staff s
  WHERE s.id = p_target_staff_id AND s.user_id IS NOT NULL
  ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION manager_update_staff_permission(uuid, text, text, boolean) TO authenticated;

-- ── 2. notify_owner_of_staff_change ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_owner_of_staff_change(
  p_field    text,
  p_old_val  text,
  p_new_val  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id  uuid;
  v_owner_id  uuid;
  v_name      text;
BEGIN
  SELECT s.id, s.owner_id, s.full_name
  INTO v_staff_id, v_owner_id, v_name
  FROM staff s
  WHERE s.user_id = auth.uid() AND s.status = 'active'
  LIMIT 1;

  IF v_staff_id IS NULL THEN RETURN; END IF;

  INSERT INTO audit_logs (staff_id, owner_id, action, details, module)
  VALUES (
    v_staff_id,
    v_owner_id,
    'profile_updated',
    format('%s: "%s" → "%s"', p_field, p_old_val, p_new_val),
    'profile'
  );

  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  VALUES (
    v_owner_id,
    'info',
    'Staff Profile Updated',
    format('%s updated their %s', v_name, p_field),
    'normal',
    format('profile_%s_%s_%s', v_staff_id, p_field, now()::date)
  )
  ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_owner_of_staff_change(text, text, text) TO authenticated;
