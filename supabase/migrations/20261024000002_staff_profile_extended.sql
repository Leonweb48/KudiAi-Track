-- ── Staff profile extended columns ─────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS address               text,
  ADD COLUMN IF NOT EXISTS nok_name              text,
  ADD COLUMN IF NOT EXISTS nok_phone             text,
  ADD COLUMN IF NOT EXISTS nok_relationship      text,
  ADD COLUMN IF NOT EXISTS shift_assignment      text,
  ADD COLUMN IF NOT EXISTS email_change_pending  text,
  ADD COLUMN IF NOT EXISTS email_change_otp      text,
  ADD COLUMN IF NOT EXISTS email_change_otp_expires_at timestamptz;

-- ── audit_logs: track which manager made a change ───────────────────────────
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS changed_by uuid;

-- ── Staff payment requests (M4) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_payment_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL,
  branch_id      uuid,
  requested_by   uuid        NOT NULL,   -- manager's staff.id
  staff_id       uuid        NOT NULL,   -- target staff member's staff.id
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  reason         text,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','paid')),
  approved_by    uuid,                   -- owner auth.uid() on approval
  approved_at    timestamptz,
  rejected_reason text,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_payment_requests ENABLE ROW LEVEL SECURITY;

-- Manager can read/create requests for their own branch
CREATE POLICY "manager_read_own_branch_requests" ON staff_payment_requests
FOR SELECT USING (
  branch_id IN (
    SELECT s.branch_id FROM staff s
    WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  )
);

CREATE POLICY "manager_insert_payment_request" ON staff_payment_requests
FOR INSERT WITH CHECK (
  requested_by IN (
    SELECT s.id FROM staff s
    WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  )
  AND branch_id IN (
    SELECT s.branch_id FROM staff s
    WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  )
);

-- Owner can read all requests and update (approve/reject/mark paid)
CREATE POLICY "owner_manage_payment_requests" ON staff_payment_requests
FOR ALL USING (owner_id = auth.uid());

-- ── RPC: manager_update_staff_permission ─────────────────────────────────────
-- Ceiling rule: manager can only toggle a permission they themselves hold.
-- Branch-scoped: target staff must be on the same branch as the calling manager.
-- Forbidden ops (create/delete/suspend/reassign) are left to existing owner-only
-- RLS on the staff table; this RPC only touches staff_permissions.
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

  -- Verify p_field is valid
  IF p_field NOT IN ('can_view', 'can_create') THEN
    RETURN jsonb_build_object('error', 'Invalid field — use can_view or can_create');
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

  -- Ceiling enforcement: manager can only grant a permission they hold
  IF p_value = true THEN
    SELECT CASE WHEN p_field = 'can_view' THEN sp.can_view ELSE sp.can_create END
    INTO v_manager_ceiling
    FROM staff_permissions sp
    WHERE sp.staff_id = v_manager_staff_id AND sp.module = p_module;

    IF NOT COALESCE(v_manager_ceiling, false) THEN
      RETURN jsonb_build_object('error',
        format('Cannot grant "%s.%s" — you do not hold this permission', p_module, p_field));
    END IF;
  END IF;

  -- Apply the permission change
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

  -- Audit log with changed_by
  INSERT INTO audit_logs (staff_id, owner_id, action, details, module, changed_by)
  VALUES (
    p_target_staff_id,
    v_manager_owner,
    'permission_updated_by_manager',
    format('%s.%s changed to %s', p_module, p_field, p_value),
    'permissions',
    v_manager_staff_id
  );

  -- Owner notification (service_role bypass via SECURITY DEFINER)
  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  SELECT
    v_manager_owner,
    'info',
    'Permission Updated',
    format('%s updated %s access for a staff member on their branch',
      (SELECT full_name FROM staff WHERE id = v_manager_staff_id),
      p_module),
    'normal',
    format('perm_update_%s_%s_%s', p_target_staff_id, p_module, p_field)
  ON CONFLICT (dedupe_key) DO NOTHING;

  -- Target staff notification
  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  SELECT
    s.user_id,
    'info',
    'Your Permissions Changed',
    format('Your %s.%s permission was updated by your branch manager', p_module, p_field),
    'normal',
    format('perm_self_%s_%s_%s_%s', p_target_staff_id, p_module, p_field, now()::date)
  FROM staff s WHERE s.id = p_target_staff_id AND s.user_id IS NOT NULL
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION manager_update_staff_permission(uuid, text, text, boolean) TO authenticated;

-- ── RPC: notify_owner_of_staff_change ────────────────────────────────────────
-- Client calls this after a profile save so the owner gets a notification.
-- SECURITY DEFINER allows INSERT into notifications (service_role-only table).
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

  -- Audit log
  INSERT INTO audit_logs (staff_id, owner_id, action, details, module)
  VALUES (
    v_staff_id,
    v_owner_id,
    'profile_updated',
    format('%s: "%s" → "%s"', p_field, p_old_val, p_new_val),
    'profile'
  );

  -- Owner notification
  INSERT INTO notifications (user_id, type, title, body, priority, dedupe_key)
  VALUES (
    v_owner_id,
    'info',
    'Staff Profile Updated',
    format('%s updated their %s', v_name, p_field),
    'normal',
    format('profile_%s_%s_%s', v_staff_id, p_field, now()::date)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_owner_of_staff_change(text, text, text) TO authenticated;

-- ── RPC: manager_update_staff_shift ─────────────────────────────────────────
-- Allows a manager to set the shift_assignment text on a branch staff member.
CREATE OR REPLACE FUNCTION manager_update_staff_shift(
  p_target_staff_id uuid,
  p_shift           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mgr_id     uuid;
  v_mgr_branch uuid;
  v_mgr_owner  uuid;
  v_tgt_branch uuid;
  v_tgt_owner  uuid;
BEGIN
  SELECT s.id, s.branch_id, s.owner_id
  INTO v_mgr_id, v_mgr_branch, v_mgr_owner
  FROM staff s
  WHERE s.user_id = auth.uid() AND s.role = 'manager' AND s.status = 'active'
  LIMIT 1;

  IF v_mgr_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Only an active manager can update shift assignments');
  END IF;

  SELECT s.branch_id, s.owner_id INTO v_tgt_branch, v_tgt_owner
  FROM staff s WHERE s.id = p_target_staff_id AND s.status = 'active';

  IF v_tgt_branch IS DISTINCT FROM v_mgr_branch OR v_tgt_owner IS DISTINCT FROM v_mgr_owner THEN
    RETURN jsonb_build_object('error', 'Target staff is not on your branch');
  END IF;

  UPDATE staff SET shift_assignment = p_shift WHERE id = p_target_staff_id;

  INSERT INTO audit_logs (staff_id, owner_id, action, details, module, changed_by)
  VALUES (p_target_staff_id, v_mgr_owner,
    'shift_updated_by_manager', format('shift → "%s"', p_shift), 'schedule', v_mgr_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION manager_update_staff_shift(uuid, text) TO authenticated;
