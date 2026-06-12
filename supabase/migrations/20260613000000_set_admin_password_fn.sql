-- Set admin password (used by change-password flow)
CREATE OR REPLACE FUNCTION set_admin_password(p_admin_id UUID, p_password TEXT)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER AS $$
  UPDATE admin_users
  SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
  WHERE id = p_admin_id;
$$;
