-- ─── Extend admin_broadcasts ─────────────────────────────────────────────────
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS recipients_count int DEFAULT 0;
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS sent_count int DEFAULT 0;
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS created_by text;

-- ─── Email Templates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  category     text        NOT NULL DEFAULT 'General',
  subject      text        NOT NULL DEFAULT '',
  html_body    text        NOT NULL DEFAULT '',
  text_body    text,
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft')),
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_templates_service_only" ON email_templates USING (auth.role() = 'service_role');

INSERT INTO email_templates (name, category, subject, status, html_body) VALUES
  ('Welcome Email',              'Authentication', 'Welcome to KudiAI Track!',               'active', ''),
  ('Email Verification OTP',     'Authentication', 'Verify your email address',              'active', ''),
  ('Password Reset',             'Authentication', 'Reset your password',                    'active', ''),
  ('Login Alert',                'Security',       'New login detected on your account',      'active', ''),
  ('Business Approval',          'Business',       'Your business has been approved!',        'active', ''),
  ('Subscription Confirmed',     'Business',       'Your subscription is now active',         'active', ''),
  ('Payment Confirmation',       'Business',       'Payment received — thank you!',           'active', ''),
  ('Payment Failed',             'Business',       'Action required: payment failed',         'active', ''),
  ('Subscription Renewal',       'Business',       'Your subscription renews in 7 days',      'active', ''),
  ('Ajo Contribution Reminder',  'Ajo',            'Your Ajo contribution is due',            'active', ''),
  ('Escalated Ticket Alert',     'Admin',          'A support ticket has been escalated',     'active', ''),
  ('System Maintenance',         'System',         'Scheduled maintenance notice',            'draft',  '')
ON CONFLICT DO NOTHING;

-- ─── Campaigns ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  subject          text        NOT NULL DEFAULT '',
  html_body        text        NOT NULL DEFAULT '',
  text_body        text,
  segment          text        NOT NULL DEFAULT 'all',
  channel          text        NOT NULL DEFAULT 'email',
  status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  recipients_count int         DEFAULT 0,
  sent_count       int         DEFAULT 0,
  created_by       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_service_only" ON campaigns USING (auth.role() = 'service_role');

-- ─── Subscription Plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  slug                text        NOT NULL UNIQUE,
  description         text        DEFAULT '',
  price_monthly       numeric     NOT NULL DEFAULT 0,
  price_yearly        numeric,
  is_active           boolean     DEFAULT true,
  max_organizations   int         DEFAULT 1,
  max_org_members     int         DEFAULT 10,
  max_ajo_groups      int         DEFAULT 2,
  max_transactions    int         DEFAULT 100,
  features            jsonb       DEFAULT '[]',
  sort_order          int         DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_service_only" ON subscription_plans USING (auth.role() = 'service_role');

INSERT INTO subscription_plans (name, slug, description, price_monthly, price_yearly, max_organizations, max_org_members, max_ajo_groups, max_transactions, features, sort_order) VALUES
  ('Starter',      'starter',      'Free plan for individuals getting started',         0,      0,      1,  5,  1,  50,  '["Basic dashboard","1 organization","5 members","50 transactions/mo","Email support"]', 0),
  ('Basic',        'basic',        'For small businesses ready to grow',                2000,   20000,  2,  20, 3,  500, '["Everything in Starter","2 organizations","20 members","500 transactions/mo","Ajo groups","Priority support"]', 1),
  ('Professional', 'professional', 'For established businesses with more needs',        5000,   50000,  5,  50, 10, 2000,'["Everything in Basic","5 organizations","50 members","2,000 transactions/mo","Advanced analytics","API access"]', 2),
  ('Enterprise',   'enterprise',   'Full-featured plan for large businesses',           15000,  150000, 20, 200,50, 999999,'["Everything in Professional","Unlimited organizations","200 members","Unlimited transactions","Dedicated support","Custom integrations","SLA guarantee"]', 3)
ON CONFLICT (slug) DO NOTHING;

-- ─── Commission Settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_settings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_type text        NOT NULL UNIQUE,
  rate_percent    numeric     NOT NULL DEFAULT 0,
  flat_amount     numeric     DEFAULT 0,
  description     text        DEFAULT '',
  is_active       boolean     DEFAULT true,
  updated_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE commission_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_settings_service_only" ON commission_settings USING (auth.role() = 'service_role');

INSERT INTO commission_settings (commission_type, rate_percent, flat_amount, description) VALUES
  ('registration',    10, 0,    'Commission earned when a new business registers via marketer referral'),
  ('subscription',    5,  0,    'Commission earned on each subscription payment made by referred business'),
  ('renewal',         3,  0,    'Commission earned on subscription renewal by referred business'),
  ('organization',    5,  0,    'Commission on organization creation by referred business'),
  ('enterprise',      8,  5000, 'Commission on enterprise plan subscription (includes flat bonus)')
ON CONFLICT (commission_type) DO NOTHING;

-- ─── Commission Benefits / Milestones ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_benefits (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text        NOT NULL,
  description        text        DEFAULT '',
  threshold_clients  int         DEFAULT 0,
  bonus_amount       numeric     DEFAULT 0,
  benefit_type       text        DEFAULT 'bonus' CHECK (benefit_type IN ('bonus','badge','perk','upgrade')),
  is_active          boolean     DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE commission_benefits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_benefits_service_only" ON commission_benefits USING (auth.role() = 'service_role');

INSERT INTO commission_benefits (title, description, threshold_clients, bonus_amount, benefit_type) VALUES
  ('Rising Star',    'First milestone bonus for onboarding 5 clients',   5,   2500,  'bonus'),
  ('Growth Champion','Bonus for reaching 15 clients',                    15,  7500,  'bonus'),
  ('Elite Agent',    'Elite bonus for onboarding 30 clients',            30,  20000, 'bonus'),
  ('Top Performer',  'Premium bonus for onboarding 50+ clients',         50,  50000, 'bonus')
ON CONFLICT DO NOTHING;

-- ─── Marketer Notifications ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id  uuid        REFERENCES brm_marketers(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  message      text        NOT NULL,
  type         text        DEFAULT 'info' CHECK (type IN ('info','warning','success','alert','commission')),
  is_read      boolean     DEFAULT false,
  created_by   text,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE marketer_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketer_notifications_service_only" ON marketer_notifications USING (auth.role() = 'service_role');
CREATE POLICY "marketer_notifications_owner_read" ON marketer_notifications
  FOR SELECT USING (
    marketer_id IN (
      SELECT id FROM brm_marketers WHERE owner_id = auth.uid()
    )
  );
