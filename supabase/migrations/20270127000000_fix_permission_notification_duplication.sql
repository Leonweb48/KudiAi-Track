-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase A producer fix: permission-change duplicate
-- notifications, and the generic uncategorized 'info' type.
--
-- manager_update_staff_permission() directly INSERTs two 'info' rows (no
-- category, no icon, no push — bypasses notify-send entirely) EVERY time a
-- manager toggles a staff permission. But ManagerStaffManagement.jsx's
-- togglePerm() (src/screens/manager/ManagerStaffManagement.jsx:108,111)
-- ALREADY calls notify({type:"permission_change", userId: member.user_id})
-- and notify({type:"manager_perm_change", userId: ownerId}) right after this
-- RPC succeeds — covering the exact same two audiences (target staff, owner)
-- through the proper path (real category, push, preference-checked). Net
-- effect today: one permission toggle produces 4 rows across 2 users. Fix:
-- drop the RPC's own direct inserts — the client-side calls are the sole,
-- correct notifier now.
--
-- notify_owner_of_staff_change() has no such duplicate (confirmed: its only
-- caller, src/components/shared/ProfileEdit.jsx, makes no separate notify()
-- call) — it just needs a real type/category instead of generic 'info' so
-- it isn't stuck on the fallback gray icon and can be muted independently.
-- ═════════════════════════════════════════════════════════════════════════════

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

  -- Notifications removed here — ManagerStaffManagement.jsx's togglePerm()
  -- already notifies both the target staff member (type:"permission_change")
  -- and the owner (type:"manager_perm_change") via notify-send right after
  -- this RPC succeeds, with real categories and push support. This RPC
  -- previously duplicated both with a generic, uncategorized 'info' row.

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION manager_update_staff_permission(uuid, text, text, boolean) TO authenticated;

-- ── notify_owner_of_staff_change: real type/category instead of 'info' ─────
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

  INSERT INTO notifications (user_id, type, category, title, body, priority, dedupe_key)
  VALUES (
    v_owner_id,
    'staff_profile_updated',
    'permissions',
    'Staff Profile Updated',
    format('%s updated their %s', v_name, p_field),
    'normal',
    format('profile_%s_%s_%s', v_staff_id, p_field, now()::date)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_owner_of_staff_change(text, text, text) TO authenticated;
