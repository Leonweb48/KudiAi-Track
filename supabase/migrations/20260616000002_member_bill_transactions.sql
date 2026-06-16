-- ══════════════════════════════════════════════════════════
--  MEMBER BILL TRANSACTIONS
--  Stores VTU / ClubKonnect bill payments made by org members
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_bill_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  org_id           uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  category         text NOT NULL,
  payment_type     text DEFAULT 'bill_payment',
  item_name        text NOT NULL,
  customer_name    text,
  amount           numeric NOT NULL DEFAULT 0,
  note             text,
  transaction_date date,
  bill_status      text DEFAULT 'success' CHECK (bill_status IN ('success','failed')),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.member_bill_transactions ENABLE ROW LEVEL SECURITY;

-- Org member can manage their own bills
CREATE POLICY "member_own_bills" ON public.member_bill_transactions
  FOR ALL USING (
    member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
  );

-- Business owner can view bills for their org's members
CREATE POLICY "org_owner_member_bills" ON public.member_bill_transactions
  FOR ALL USING (
    org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );

-- Org portal can view member bills for their org
CREATE POLICY "org_portal_member_bills" ON public.member_bill_transactions
  FOR ALL USING (
    org_id IN (SELECT id FROM public.organizations WHERE portal_user_id = auth.uid())
  );
