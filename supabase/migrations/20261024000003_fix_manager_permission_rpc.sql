-- Fix: manager_update_staff_permission ON CONFLICT failure.
--
-- Root causes:
--  1. UNIQUE (staff_id, module) may be missing from staff_permissions.
--     Migration 20260721050000 added it, but it is not present on the remote
--     database. Reapply idempotently (DROP IF EXISTS then ADD).
--  2. The RPC accepted only 'can_view'|'can_create', matching the actual DB
--     columns. The UI was sending 'can_add'|'can_edit'|'can_delete' which do
--     not exist as columns — so every toggle either silently errored or hit the
--     field-validation guard. The RPC is rewritten here to accept exactly the
--     two real columns: can_view and can_create.

-- ── 1. Ensure unique constraint ─────────────────────────────────────────────
ALTER TABLE public.staff_permissions
  DROP CONSTRAINT IF EXISTS staff_permissions_staff_id_module_key;
ALTER TABLE public.staff_permissions
  ADD CONSTRAINT staff_permissions_staff_id_module_key UNIQUE (staff_id, module);

-- ── 2. Rewrite the RPC with correct column names and full field set ──────────
CREATE OR REPLACE FUNCTION manager_update_staff_permission(
  p_target_staff_id uuid,
  p_module          text,
  p_field           text,   -- 'can_view' or 'can_create'
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
  -- Verify caller is an active manager
  SELECT s.id, s.branch_id, s.owner_id
  INTO v_manager_staff_id, v_manager_branch, v_manager_owner
  FROM staff s
  WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  LIMIT 1;

  IF v_manager_staff_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Only an active manager can update permissions');
  END IF;

  -- Managers cannot edit their own permissions
  IF p_target_staff_id = v_manager_staff_id THEN
    RETURN jsonb_build_object('error', 'You cannot edit your own permissions');
  END IF;

  -- Validate field against actual columns
  IF p_field NOT IN ('can_view', 'can_create') THEN
    RETURN jsonb_build_object('error',
      format('Invalid field "%s" — valid values are can_view and can_create', p_field));
  END IF;

  -- Verify target is on the same branch and same owner
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

  -- Ceiling enforcement: manager can only grant a permission they themselves hold
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

  -- Upsert the permission row
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

  -- Audit log with changed_by = manager
  INSERT INTO audit_logs (staff_id, owner_id, action, details, module, changed_by)
  VALUES (
    p_target_staff_id,
    v_manager_owner,
    'permission_updated_by_manager',
    format('%s.%s set to %s by manager', p_module, p_field, p_value),
    'permissions',
    v_manager_staff_id
  );

  -- Notify owner
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
  ON CONFLICT (dedupe_key) DO NOTHING;

  -- Notify target staff member
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
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION manager_update_staff_permission(uuid, text, text, boolean) TO authenticated;
