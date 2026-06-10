-- ═══════════════════════════════════════════════════════
--  COOPERATIVE / COMMUNITY ORGANIZATION SYSTEM
-- ═══════════════════════════════════════════════════════

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'cooperative'
    CHECK (type IN ('cooperative','market_association','church','ngo','youth_group','savings_group')),
  reg_number      text UNIQUE,
  description     text,
  address         text,
  state_name      text,
  lga             text,
  phone           text,
  email           text,
  logo_url        text,
  wallet_balance  numeric DEFAULT 0,
  total_savings   numeric DEFAULT 0,
  total_loans_out numeric DEFAULT 0,
  member_count    int DEFAULT 0,
  status          text DEFAULT 'active'
    CHECK (status IN ('active','suspended','inactive')),
  created_at      timestamptz DEFAULT now()
);

-- Members table
CREATE TABLE IF NOT EXISTS public.org_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  membership_id     text NOT NULL,
  full_name         text NOT NULL,
  email             text,
  phone             text,
  role              text DEFAULT 'member'
    CHECK (role IN ('admin','president','treasurer','secretary','officer','member')),
  status            text DEFAULT 'active'
    CHECK (status IN ('active','suspended','removed')),
  profile_image_url text,
  address           text,
  occupation        text,
  date_of_birth     date,
  joined_date       date DEFAULT CURRENT_DATE,
  suspended_at      timestamptz,
  suspension_reason text,
  removed_at        timestamptz,
  portal_pin        text DEFAULT '0000',
  portal_token      text DEFAULT replace(gen_random_uuid()::text, '-', ''),
  savings_balance   numeric DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  UNIQUE(org_id, membership_id)
);

-- Member savings
CREATE TABLE IF NOT EXISTS public.org_savings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id      uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  type           text DEFAULT 'deposit' CHECK (type IN ('deposit','withdrawal')),
  payment_method text DEFAULT 'cash',
  paystack_ref   text,
  balance_after  numeric DEFAULT 0,
  notes          text,
  recorded_by    text,
  created_at     timestamptz DEFAULT now()
);

-- Loans
CREATE TABLE IF NOT EXISTS public.org_loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id           uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  amount_requested    numeric NOT NULL CHECK (amount_requested > 0),
  amount_approved     numeric,
  outstanding_balance numeric DEFAULT 0,
  interest_rate       numeric DEFAULT 0,
  loan_purpose        text,
  repayment_months    int DEFAULT 1,
  status              text DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','disbursed','repaid','defaulted')),
  applied_at          timestamptz DEFAULT now(),
  approved_at         timestamptz,
  approved_by_name    text,
  disbursed_at        timestamptz,
  due_date            date,
  notes               text,
  created_at          timestamptz DEFAULT now()
);

-- Loan repayments
CREATE TABLE IF NOT EXISTS public.org_loan_repayments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  loan_id        uuid REFERENCES public.org_loans(id) ON DELETE CASCADE NOT NULL,
  member_id      uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  payment_method text DEFAULT 'cash',
  paystack_ref   text,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- Meetings
CREATE TABLE IF NOT EXISTS public.org_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  title        text NOT NULL,
  description  text,
  meeting_type text DEFAULT 'general'
    CHECK (meeting_type IN ('general','board','special','agm')),
  scheduled_at timestamptz NOT NULL,
  location     text,
  status       text DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','ongoing','completed','cancelled')),
  qr_token     text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at   timestamptz DEFAULT now()
);

-- Meeting attendance
CREATE TABLE IF NOT EXISTS public.org_attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid REFERENCES public.org_meetings(id) ON DELETE CASCADE NOT NULL,
  org_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id     uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  status        text DEFAULT 'present' CHECK (status IN ('present','absent','excused')),
  checked_in_at timestamptz DEFAULT now(),
  notes         text,
  UNIQUE(meeting_id, member_id)
);

-- Wallet transactions
CREATE TABLE IF NOT EXISTS public.org_wallet_txns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  type          text NOT NULL,
  amount        numeric NOT NULL,
  description   text,
  reference_id  uuid,
  paystack_ref  text,
  balance_after numeric DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────
ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_savings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_loans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_meetings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_attendance      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_wallet_txns     ENABLE ROW LEVEL SECURITY;

-- Owner can do everything on their organizations
CREATE POLICY "coop_org_owner" ON public.organizations
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "coop_members_owner" ON public.org_members
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_savings_owner" ON public.org_savings
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_loans_owner" ON public.org_loans
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_repayments_owner" ON public.org_loan_repayments
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_meetings_owner" ON public.org_meetings
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_attendance_owner" ON public.org_attendance
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));

CREATE POLICY "coop_wallet_owner" ON public.org_wallet_txns
  FOR ALL USING (org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
