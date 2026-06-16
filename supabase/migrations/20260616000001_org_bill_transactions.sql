-- ══════════════════════════════════════════════════════════
--  ORG BILL TRANSACTIONS
--  Stores VTU / ClubKonnect bill payments made by org portals
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_bill_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

ALTER TABLE public.org_bill_transactions ENABLE ROW LEVEL SECURITY;

-- Business owner can manage bills for their orgs
CREATE POLICY "org_owner_bills" ON public.org_bill_transactions
  FOR ALL USING (
    org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );

-- Org portal user (account_type = 'organisation') can manage bills for their own org
CREATE POLICY "org_portal_bills" ON public.org_bill_transactions
  FOR ALL USING (
    org_id IN (
      SELECT id FROM public.organizations WHERE portal_user_id = auth.uid()
    )
  );
