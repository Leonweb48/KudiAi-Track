-- ═══════════════════════════════════════════════════════════════
-- ADVANCED BUSINESS RELATIONSHIP MANAGEMENT (BRM) + CRM SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- ── 1. BRM Clients — B2B relationships managed by this business ─────
CREATE TABLE IF NOT EXISTS brm_clients (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name          TEXT        NOT NULL,
  industry              TEXT,
  business_size         TEXT        CHECK (business_size IN ('micro','small','medium','large','enterprise')),
  employee_count        INTEGER,
  annual_revenue        BIGINT      DEFAULT 0,
  website               TEXT,
  cac_number            TEXT,
  kyc_status            TEXT        DEFAULT 'pending' CHECK (kyc_status IN ('pending','submitted','verified','rejected')),
  contact_name          TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  address               TEXT,
  state                 TEXT,
  relationship_type     TEXT        DEFAULT 'client' CHECK (relationship_type IN ('lead','prospect','client','partner','inactive')),
  lifetime_value        BIGINT      DEFAULT 0,
  health_score          INTEGER     DEFAULT 50,
  churn_risk            TEXT        DEFAULT 'low' CHECK (churn_risk IN ('low','medium','high','critical')),
  acquisition_date      DATE        DEFAULT CURRENT_DATE,
  last_interaction_date TIMESTAMPTZ DEFAULT NOW(),
  notes                 TEXT,
  tags                  TEXT[]      DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. BRM Marketers — Sales agents / account managers ──────────────
CREATE TABLE IF NOT EXISTS brm_marketers (
  id                       UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id                 UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name                TEXT         NOT NULL,
  email                    TEXT,
  phone                    TEXT,
  territory                TEXT,
  commission_rate          DECIMAL(5,2) DEFAULT 10.0,
  target_clients           INTEGER      DEFAULT 20,
  status                   TEXT         DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  profile_image_url        TEXT,
  joined_date              DATE         DEFAULT CURRENT_DATE,
  total_clients            INTEGER      DEFAULT 0,
  total_revenue            BIGINT       DEFAULT 0,
  total_commission_earned  BIGINT       DEFAULT 0,
  created_at               TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 3. Client–Marketer Assignments with full ownership history ───────
CREATE TABLE IF NOT EXISTS brm_assignments (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID        NOT NULL REFERENCES brm_clients(id) ON DELETE CASCADE,
  marketer_id     UUID        REFERENCES brm_marketers(id) ON DELETE SET NULL,
  assignment_type TEXT        DEFAULT 'primary' CHECK (assignment_type IN ('primary','secondary','acquisition')),
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  released_at     TIMESTAMPTZ,
  transfer_reason TEXT,
  is_current      BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Activity Timeline — full audit trail per client ───────────────
CREATE TABLE IF NOT EXISTS brm_timeline (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   UUID        REFERENCES brm_clients(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  event_title TEXT        NOT NULL,
  event_data  JSONB       DEFAULT '{}',
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Client Notes & Follow-ups ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS brm_notes (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID        REFERENCES brm_clients(id) ON DELETE CASCADE,
  marketer_id    UUID        REFERENCES brm_marketers(id) ON DELETE SET NULL,
  note_type      TEXT        DEFAULT 'note' CHECK (note_type IN ('note','meeting','call','visit','email','follow_up','complaint')),
  content        TEXT        NOT NULL,
  follow_up_date DATE,
  is_completed   BOOLEAN     DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. CRM Leads Pipeline ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_leads (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marketer_id         UUID        REFERENCES brm_marketers(id) ON DELETE SET NULL,
  company_name        TEXT        NOT NULL,
  contact_name        TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  industry            TEXT,
  source              TEXT        DEFAULT 'direct' CHECK (source IN ('direct','referral','cold_call','social_media','event','website','walk_in','other')),
  stage               TEXT        DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','proposal','negotiation','won','lost')),
  deal_value          BIGINT      DEFAULT 0,
  probability         INTEGER     DEFAULT 20 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  last_activity_at    TIMESTAMPTZ DEFAULT NOW(),
  notes               TEXT,
  lost_reason         TEXT,
  converted_client_id UUID        REFERENCES brm_clients(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Commission Rules ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_rules (
  id                       UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id                 UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name                TEXT         NOT NULL,
  rule_type                TEXT         DEFAULT 'acquisition' CHECK (rule_type IN ('acquisition','renewal','upsell','retention')),
  rate                     DECIMAL(5,2) NOT NULL,
  min_deal_value           BIGINT       DEFAULT 0,
  ownership_period_months  INTEGER      DEFAULT 12,
  notes                    TEXT,
  is_active                BOOLEAN      DEFAULT true,
  created_at               TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 8. Commission Records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_records (
  id                UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marketer_id       UUID         NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  client_id         UUID         REFERENCES brm_clients(id) ON DELETE SET NULL,
  lead_id           UUID         REFERENCES crm_leads(id) ON DELETE SET NULL,
  commission_type   TEXT         DEFAULT 'acquisition',
  deal_value        BIGINT       NOT NULL,
  rate              DECIMAL(5,2) NOT NULL,
  commission_amount BIGINT       NOT NULL,
  status            TEXT         DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','disputed','cancelled')),
  payout_date       DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Row Level Security ───────────────────────────────────────────────
ALTER TABLE brm_clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE brm_marketers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE brm_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE brm_timeline    ENABLE ROW LEVEL SECURITY;
ALTER TABLE brm_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brm_clients_owner"     ON brm_clients;
DROP POLICY IF EXISTS "brm_marketers_owner"   ON brm_marketers;
DROP POLICY IF EXISTS "brm_assignments_owner" ON brm_assignments;
DROP POLICY IF EXISTS "brm_timeline_owner"    ON brm_timeline;
DROP POLICY IF EXISTS "brm_notes_owner"       ON brm_notes;
DROP POLICY IF EXISTS "crm_leads_owner"       ON crm_leads;
DROP POLICY IF EXISTS "commission_rules_owner"   ON commission_rules;
DROP POLICY IF EXISTS "commission_records_owner" ON commission_records;

CREATE POLICY "brm_clients_owner"     ON brm_clients     USING (owner_id = auth.uid());
CREATE POLICY "brm_marketers_owner"   ON brm_marketers   USING (owner_id = auth.uid());
CREATE POLICY "brm_assignments_owner" ON brm_assignments USING (owner_id = auth.uid());
CREATE POLICY "brm_timeline_owner"    ON brm_timeline    USING (owner_id = auth.uid());
CREATE POLICY "brm_notes_owner"       ON brm_notes       USING (owner_id = auth.uid());
CREATE POLICY "crm_leads_owner"       ON crm_leads       USING (owner_id = auth.uid());
CREATE POLICY "commission_rules_owner"   ON commission_rules   USING (owner_id = auth.uid());
CREATE POLICY "commission_records_owner" ON commission_records USING (owner_id = auth.uid());

-- ── Performance Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brm_clients_owner       ON brm_clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_brm_clients_health      ON brm_clients(owner_id, health_score DESC);
CREATE INDEX IF NOT EXISTS idx_brm_clients_churn       ON brm_clients(owner_id, churn_risk);
CREATE INDEX IF NOT EXISTS idx_brm_clients_interaction ON brm_clients(owner_id, last_interaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_brm_marketers_owner     ON brm_marketers(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_brm_assignments_client  ON brm_assignments(client_id, is_current);
CREATE INDEX IF NOT EXISTS idx_brm_assignments_owner   ON brm_assignments(owner_id);
CREATE INDEX IF NOT EXISTS idx_brm_timeline_client     ON brm_timeline(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brm_notes_client        ON brm_notes(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brm_notes_followup      ON brm_notes(owner_id, follow_up_date) WHERE is_completed = false;
CREATE INDEX IF NOT EXISTS idx_crm_leads_owner_stage   ON crm_leads(owner_id, stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_marketer      ON crm_leads(marketer_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_mktr ON commission_records(marketer_id, status);
CREATE INDEX IF NOT EXISTS idx_commission_records_owner ON commission_records(owner_id, created_at DESC);
