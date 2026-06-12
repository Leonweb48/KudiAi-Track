-- ═══════════════════════════════════════════════════════════════
-- SUPPORT TICKETS & ADMIN TASKS SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Support Tickets ───────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS ticket_seq START 1;

CREATE TABLE IF NOT EXISTS support_tickets (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_no        TEXT        UNIQUE NOT NULL DEFAULT 'TKT-' || LPAD(nextval('ticket_seq')::TEXT, 4, '0'),
  subject          TEXT        NOT NULL,
  description      TEXT,
  type             TEXT        DEFAULT 'general'
                   CHECK (type IN ('account','payment','transaction','technical','subscription','general')),
  priority         TEXT        DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  status           TEXT        DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','escalated','resolved','closed')),
  user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email       TEXT,
  user_name        TEXT,
  assigned_to      TEXT,
  assigned_admin_id UUID       REFERENCES admin_users(id) ON DELETE SET NULL,
  escalation_level INTEGER     DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 4),
  resolution       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status   ON support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority, created_at DESC);

-- ── 2. Support Ticket Comments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id      UUID        REFERENCES support_tickets(id) ON DELETE CASCADE NOT NULL,
  admin_id       UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_username TEXT        NOT NULL,
  admin_role     TEXT,
  comment        TEXT        NOT NULL,
  is_internal    BOOLEAN     DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON support_ticket_comments(ticket_id, created_at);

-- ── 3. Admin Tasks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_tasks (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title                TEXT        NOT NULL,
  description          TEXT,
  status               TEXT        DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','completed','cancelled')),
  priority             TEXT        DEFAULT 'medium'
                       CHECK (priority IN ('low','medium','high','critical')),
  assigned_to          UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_username    TEXT,
  assigned_role        TEXT,
  created_by           UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_username  TEXT,
  category             TEXT        DEFAULT 'general',
  due_date             DATE,
  completed_at         TIMESTAMPTZ,
  tags                 TEXT[]      DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON admin_tasks(assigned_to, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON admin_tasks(status, created_at DESC);

-- ── 4. Admin Task Comments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_task_comments (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id        UUID        REFERENCES admin_tasks(id) ON DELETE CASCADE NOT NULL,
  admin_id       UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_username TEXT        NOT NULL,
  admin_role     TEXT,
  comment        TEXT        NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON admin_task_comments(task_id, created_at);

-- ── 5. Monthly Snapshots View (for analytics) ────────────────────
-- View: monthly user registrations
CREATE OR REPLACE VIEW monthly_user_growth AS
SELECT
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*) AS new_users
FROM profiles
GROUP BY 1
ORDER BY 1;

-- View: monthly transaction volume
CREATE OR REPLACE VIEW monthly_txn_volume AS
SELECT
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*)                         AS txn_count,
  COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS total_in,
  COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS total_out
FROM transactions
GROUP BY 1
ORDER BY 1;

-- View: monthly subscription revenue (by plan prices)
CREATE OR REPLACE VIEW monthly_sub_revenue AS
SELECT
  DATE_TRUNC('month', s.created_at) AS month,
  COUNT(*) AS new_subs,
  SUM(
    CASE s.plan
      WHEN 'starter'      THEN 2000
      WHEN 'business'     THEN 5000
      WHEN 'premium'      THEN 10000
      ELSE 0
    END
  ) AS revenue
FROM subscriptions s
WHERE s.status = 'active'
GROUP BY 1
ORDER BY 1;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE support_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_task_comments      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_tickets_admin_only"         ON support_tickets         FOR ALL USING (is_admin());
CREATE POLICY "support_ticket_comments_admin_only" ON support_ticket_comments FOR ALL USING (is_admin());
CREATE POLICY "admin_tasks_admin_only"             ON admin_tasks             FOR ALL USING (is_admin());
CREATE POLICY "admin_task_comments_admin_only"     ON admin_task_comments     FOR ALL USING (is_admin());
