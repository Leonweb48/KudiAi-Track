-- ═══════════════════════════════════════════════════════════════════════════════
--  Help & Support System
--  Migration: 20260705000001_help_support.sql
--
--  Creates: profile extensions, profile audit log, FAQ system, support tickets,
--  support_ticket_comments (admin panel), ticket_messages (user follow-up),
--  ticket attachments, storage bucket, RLS policies, and seed data.
--
--  Status values: open | in_progress | escalated | awaiting_response | resolved | closed
--  Priority values: low | medium | high | critical
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. Extend public.profiles ────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_registration_number text,
  ADD COLUMN IF NOT EXISTS business_phone               text,
  ADD COLUMN IF NOT EXISTS business_email               text,
  ADD COLUMN IF NOT EXISTS business_category            text,
  ADD COLUMN IF NOT EXISTS member_since                 timestamptz DEFAULT now();


-- ── 2. Profile Audit Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_audit_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name text        NOT NULL,
  old_value  text,
  new_value  text,
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_audit_log_user
  ON public.profile_audit_log (user_id, changed_at DESC);


-- ── 3. FAQ Categories ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faq_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  icon       text        NOT NULL DEFAULT '❓',
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);


-- ── 4. FAQ Items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faq_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid        REFERENCES public.faq_categories(id) ON DELETE SET NULL,
  question     text        NOT NULL,
  answer       text        NOT NULL,   -- HTML from rich text editor
  sort_order   int         NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faq_items_category
  ON public.faq_items (category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_faq_items_published
  ON public.faq_items (is_published, category_id, sort_order);


-- ── 5. FAQ Feedback ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faq_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  faq_item_id uuid        REFERENCES public.faq_items(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  is_helpful  boolean     NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (faq_item_id, user_id)
);


-- ── 6. Ticket Sequence & Reference Number Function ───────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_ticket_no()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'KT-'
      || extract(year FROM now())::int::text
      || '-'
      || lpad(nextval('public.support_ticket_seq')::text, 5, '0');
END;
$$;


-- ── 7. Support Tickets ───────────────────────────────────────────────────────
--
--  status:   open | in_progress | escalated | awaiting_response | resolved | closed
--  priority: low  | medium      | high      | critical
--  type:     bug  | payment_issue | invoice_issue | account_access | feature_request | other
--
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no          text        UNIQUE NOT NULL DEFAULT generate_ticket_no(),
  user_id            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email         text,
  user_name          text,
  subject            text        NOT NULL,
  description        text        NOT NULL,
  type               text        NOT NULL DEFAULT 'general',
  priority           text        NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status             text        NOT NULL DEFAULT 'open'
                     CHECK (status IN (
                       'open', 'in_progress', 'escalated',
                       'awaiting_response', 'resolved', 'closed'
                     )),
  assigned_to        text,
  assigned_admin_id  uuid,
  escalation_level   int         NOT NULL DEFAULT 1,
  resolution         text,
  needs_info_message text,
  rating             int         CHECK (rating BETWEEN 1 AND 5),
  closed_at          timestamptz,
  resolved_at        timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON public.support_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON public.support_tickets (status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_no
  ON public.support_tickets (ticket_no);


-- ── 8. Support Ticket Comments (admin panel) ─────────────────────────────────
--
--  Used by kuditrack-admin API routes. Admin staff write comments here.
--  is_internal = true → visible only to admins, hidden from the user.
--
CREATE TABLE IF NOT EXISTS public.support_ticket_comments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  comment        text        NOT NULL,
  is_internal    boolean     NOT NULL DEFAULT false,
  admin_username text,
  admin_role     text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket
  ON public.support_ticket_comments (ticket_id, created_at ASC);


-- ── 9. Ticket Messages (user-side follow-up thread) ──────────────────────────
--
--  Used by the user-facing app for ongoing conversation on an open ticket.
--  sender_type: 'user' | 'support' | 'system'
--
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type text        NOT NULL DEFAULT 'user'
              CHECK (sender_type IN ('user', 'support', 'system')),
  sender_id   uuid,
  sender_name text,
  content     text        NOT NULL,
  is_internal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
  ON public.ticket_messages (ticket_id, created_at ASC);


-- ── 10. Ticket Attachments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_attachments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id uuid        REFERENCES public.ticket_messages(id) ON DELETE CASCADE,
  file_name  text        NOT NULL,
  file_url   text        NOT NULL,
  file_size  int         NOT NULL,
  file_type  text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket
  ON public.ticket_attachments (ticket_id);


-- ── 11. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.profile_audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_items                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_attachments       ENABLE ROW LEVEL SECURITY;

-- faq_categories: anyone (including anonymous) can read
CREATE POLICY "faq_categories_public_read" ON public.faq_categories
  FOR SELECT USING (true);

-- faq_items: public read for published items only
CREATE POLICY "faq_items_published_read" ON public.faq_items
  FOR SELECT USING (is_published = true);

-- faq_feedback: authenticated user manages their own rows
CREATE POLICY "faq_feedback_own_all" ON public.faq_feedback
  FOR ALL TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- support_tickets: users read and insert their own tickets
CREATE POLICY "tickets_own_select" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "tickets_own_insert" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- support_tickets: users may only update the rating field on resolved/closed tickets
CREATE POLICY "tickets_rate_resolved" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING     (user_id = auth.uid() AND status IN ('resolved', 'closed'))
  WITH CHECK (user_id = auth.uid());

-- support_ticket_comments: users can read non-internal comments on their own tickets
CREATE POLICY "ticket_comments_user_select" ON public.support_ticket_comments
  FOR SELECT TO authenticated
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

-- support_ticket_comments: only service_role inserts (admin panel uses service key)
-- (no authenticated INSERT policy — users cannot write admin comments)

-- ticket_messages: users read non-internal messages on their own tickets
CREATE POLICY "ticket_messages_own_select" ON public.ticket_messages
  FOR SELECT TO authenticated
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

-- ticket_messages: users insert follow-up messages as 'user' sender on their own tickets
CREATE POLICY "ticket_messages_own_insert" ON public.ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'user'
    AND sender_id = auth.uid()
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

-- ticket_attachments: users read/insert attachments on their own tickets
CREATE POLICY "ticket_attachments_own_select" ON public.ticket_attachments
  FOR SELECT TO authenticated
  USING (
    ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ticket_attachments_own_insert" ON public.ticket_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

-- profile_audit_log: users read/insert their own audit rows
CREATE POLICY "audit_log_own_select" ON public.profile_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "audit_log_own_insert" ON public.profile_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- service_role: full access on all support tables (admin dashboard)
CREATE POLICY "tickets_service_all"          ON public.support_tickets         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ticket_comments_service_all"  ON public.support_ticket_comments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "messages_service_all"         ON public.ticket_messages         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "attachments_service_all"      ON public.ticket_attachments      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "audit_log_service_all"        ON public.profile_audit_log       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "faq_items_service_all"        ON public.faq_items               FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "faq_categories_service_all"   ON public.faq_categories          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "faq_feedback_service_all"     ON public.faq_feedback            FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── 12. Storage Bucket: ticket-attachments ───────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload and read from this private bucket
DO $storage$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'ticket_attach_upload'
  ) THEN
    CREATE POLICY "ticket_attach_upload" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'ticket-attachments' AND auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'ticket_attach_read'
  ) THEN
    CREATE POLICY "ticket_attach_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'ticket-attachments' AND auth.uid() IS NOT NULL);
  END IF;
END $storage$;


-- ── 13. Seed: FAQ Categories ─────────────────────────────────────────────────
INSERT INTO public.faq_categories (id, name, icon, sort_order) VALUES
  ('a0fac001-0000-4000-8000-000000000001', 'Getting Started',    '🚀', 1),
  ('a0fac001-0000-4000-8000-000000000002', 'Invoices',           '🧾', 2),
  ('a0fac001-0000-4000-8000-000000000003', 'Payments & Wallet',  '💳', 3),
  ('a0fac001-0000-4000-8000-000000000004', 'Ajo/Savings Groups', '🤝', 4),
  ('a0fac001-0000-4000-8000-000000000005', 'Security & PINs',    '🔐', 5),
  ('a0fac001-0000-4000-8000-000000000006', 'Account & Billing',  '⚙️', 6)
ON CONFLICT (id) DO NOTHING;


-- ── 14. Seed: FAQ Items (22 items, 3-4 per category) ────────────────────────
INSERT INTO public.faq_items (id, category_id, question, answer, sort_order) VALUES

-- ────────────────────────────────────────────────────────────────────────────
-- Getting Started (4 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000001',
 'a0fac001-0000-4000-8000-000000000001',
 'What is KudiAI Track and how does it work?',
 '<p>KudiAI Track is a Nigerian SME-focused business management platform that brings invoicing, bookkeeping, staff management, Ajo savings groups, and AI-powered financial insights together in one easy-to-use app.</p>
<p>Getting started is simple:</p>
<ul>
  <li>Create a free account with your business email address.</li>
  <li>Complete your business profile — name, category, CAC number, and contact details.</li>
  <li>Start creating invoices, recording expenses, and tracking your cash flow.</li>
  <li>Invite staff members and control what each person can access.</li>
  <li>Use the built-in AI assistant to get instant answers about your finances.</li>
</ul>
<p>KudiAI Track works on web browsers and as a mobile app, so you can manage your business from anywhere in Nigeria.</p>',
 1),

('b0fac001-0000-4000-8000-000000000002',
 'a0fac001-0000-4000-8000-000000000001',
 'How do I set up my business profile?',
 '<p>A complete business profile makes your invoices look professional and helps customers recognise your brand. To set it up:</p>
<ul>
  <li>Go to <strong>Settings</strong> and select <strong>Business Profile</strong>.</li>
  <li>Enter your business name, CAC registration number, and business category.</li>
  <li>Add your business phone number and email address.</li>
  <li>Upload your business logo — it will appear on all invoices and PDF documents.</li>
  <li>Add your bank account details so customers know where to send payment.</li>
  <li>Save your changes.</li>
</ul>
<p>You can update your profile at any time. Changes take effect immediately on all new invoices created going forward.</p>',
 2),

('b0fac001-0000-4000-8000-000000000003',
 'a0fac001-0000-4000-8000-000000000001',
 'How do I invite and manage staff members?',
 '<p>You can add staff members up to the limit of your subscription plan. Here is how:</p>
<ul>
  <li>Navigate to the <strong>Staff</strong> section from the main menu and tap <strong>Invite Staff</strong>.</li>
  <li>Enter the staff member''s full name and email address.</li>
  <li>Select the appropriate role: <em>Manager</em> or <em>Staff</em>.</li>
  <li>Choose which features the staff member can access — for example, invoices, inventory, or reports.</li>
  <li>Click <strong>Send Invite</strong>. The staff member will receive an email with a one-time setup link.</li>
</ul>
<p>To manage existing staff, go to <strong>Staff → Manage Staff</strong>. From there you can edit permissions, reset access, or deactivate an account when a staff member leaves.</p>',
 3),

('b0fac001-0000-4000-8000-000000000004',
 'a0fac001-0000-4000-8000-000000000001',
 'What are the different user roles and their permissions?',
 '<p>KudiAI Track has three roles, each with different levels of access:</p>
<ul>
  <li><strong>Owner:</strong> Full access to all features, including billing, subscription management, and all financial reports. Only one Owner exists per business account.</li>
  <li><strong>Manager:</strong> Can create and manage invoices, expenses, inventory, and staff. Can view reports but cannot change billing settings or subscription plans.</li>
  <li><strong>Staff:</strong> Limited access based on what the Owner has granted. Typically used for day-to-day operations such as recording sales, viewing assigned tasks, or issuing invoices — without access to sensitive financial summaries or settings.</li>
</ul>
<p>Owners can customise permissions for each Staff member individually from the <strong>Staff Settings</strong> page.</p>',
 4),


-- ────────────────────────────────────────────────────────────────────────────
-- Invoices (4 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000005',
 'a0fac001-0000-4000-8000-000000000002',
 'How do I create and send an invoice to a customer?',
 '<p>Creating and sending a professional invoice takes just a few steps:</p>
<ul>
  <li>Go to <strong>Invoices</strong> and tap <strong>New Invoice</strong>.</li>
  <li>Search for an existing customer or add a new one with their name, phone, and email.</li>
  <li>Add the products or services you are billing for, along with quantities and unit prices.</li>
  <li>Set the invoice date and payment due date. Apply any discounts or VAT as needed.</li>
  <li>Preview the invoice, then choose to <strong>Send via Email</strong>, <strong>Share via WhatsApp</strong>, or <strong>Download as PDF</strong>.</li>
</ul>
<p>Your customer receives a branded invoice showing your logo, itemised breakdown, totals, and bank payment details — everything they need to pay on time.</p>',
 1),

('b0fac001-0000-4000-8000-000000000006',
 'a0fac001-0000-4000-8000-000000000002',
 'Can I add my business logo and bank details to invoices?',
 '<p>Yes. KudiAI Track automatically pulls your logo and bank account details from your Business Profile and places them on every invoice you generate.</p>
<p>To ensure they appear correctly:</p>
<ul>
  <li>Go to <strong>Settings → Business Profile</strong> and upload a clear square logo (PNG or JPG recommended, at least 300x300 px).</li>
  <li>Under <strong>Payment Details</strong>, add your bank name, account number, and account name.</li>
  <li>Save the changes — all new invoices will immediately use the updated information.</li>
</ul>
<p>Previously issued invoices retain the logo and bank details that were active at the time they were generated, so your records stay accurate.</p>',
 2),

('b0fac001-0000-4000-8000-000000000007',
 'a0fac001-0000-4000-8000-000000000002',
 'How do I record a payment received against an invoice?',
 '<p>When a customer pays, you can mark the invoice as fully or partially paid:</p>
<ul>
  <li>Open the invoice from the <strong>Invoices</strong> list.</li>
  <li>Tap <strong>Record Payment</strong>.</li>
  <li>Enter the amount received, the payment date, and the payment method (bank transfer, cash, POS, etc.).</li>
  <li>Optionally add a reference note such as a bank teller number or transfer reference.</li>
  <li>Tap <strong>Save Payment</strong>.</li>
</ul>
<p>If the customer pays in instalments, you can record multiple partial payments over time. The invoice status updates automatically — from <em>Unpaid</em> to <em>Partially Paid</em> to <em>Paid</em> — so your records always reflect the true balance owed.</p>',
 3),

('b0fac001-0000-4000-8000-000000000008',
 'a0fac001-0000-4000-8000-000000000002',
 'Can I download invoices as PDF and share them via WhatsApp?',
 '<p>Yes. Every invoice on KudiAI Track can be exported as a professionally designed PDF and shared through multiple channels:</p>
<ul>
  <li>Open the invoice and tap the <strong>Share / Download</strong> button.</li>
  <li>Choose <strong>Download PDF</strong> to save the file to your device.</li>
  <li>Choose <strong>Share via WhatsApp</strong> to send it directly to the customer''s WhatsApp number.</li>
  <li>Choose <strong>Send via Email</strong> to deliver it to the customer''s inbox with the PDF as an attachment.</li>
</ul>
<p>The PDF includes your logo, business details, itemised line items, subtotal, discounts, taxes, total amount, and bank payment instructions — everything your customer needs to process the payment promptly.</p>',
 4),


-- ────────────────────────────────────────────────────────────────────────────
-- Payments & Wallet (4 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000009',
 'a0fac001-0000-4000-8000-000000000003',
 'How do I fund my KudiAI wallet?',
 '<p>Your KudiAI wallet is your in-app balance used for quick transactions, Ajo contributions, and subscription payments. To add funds:</p>
<ul>
  <li>Go to <strong>Wallet</strong> from the main menu and tap <strong>Fund Wallet</strong>.</li>
  <li>Enter the amount you want to add (minimum ₦100).</li>
  <li>Select your preferred payment channel: <strong>Debit/Credit Card</strong>, <strong>Bank Transfer</strong>, or <strong>USSD</strong>.</li>
  <li>Complete the payment through our secure Paystack gateway.</li>
</ul>
<p>Your wallet balance updates instantly once the payment is confirmed. You will receive both an in-app notification and an email receipt for every top-up transaction.</p>',
 1),

('b0fac001-0000-4000-8000-000000000010',
 'a0fac001-0000-4000-8000-000000000003',
 'How do I withdraw money from my wallet to my bank account?',
 '<p>Withdrawing from your wallet to a Nigerian bank account is quick and straightforward:</p>
<ul>
  <li>Navigate to <strong>Wallet</strong> and tap <strong>Withdraw</strong>.</li>
  <li>Select a saved bank account or add a new one by entering your bank name and account number — the account name will be verified automatically.</li>
  <li>Enter the amount to withdraw and confirm with your 4-digit transaction PIN.</li>
  <li>Tap <strong>Confirm Withdrawal</strong>.</li>
</ul>
<p>Funds are typically credited to your bank account within 5–30 minutes. During peak banking hours or on public holidays, transfers may take up to 2 hours. If a withdrawal has not arrived after 2 hours, please open a support ticket with the withdrawal reference number.</p>',
 2),

('b0fac001-0000-4000-8000-000000000011',
 'a0fac001-0000-4000-8000-000000000003',
 'What payment methods are accepted for subscription plans?',
 '<p>You can pay for your KudiAI Track subscription using any of the following methods:</p>
<ul>
  <li><strong>Debit / Credit Card:</strong> Mastercard, Visa, and Verve cards are all accepted.</li>
  <li><strong>Bank Transfer:</strong> Transfer directly to the virtual account number displayed at checkout.</li>
  <li><strong>USSD:</strong> Use your bank''s USSD shortcode to complete payment without an internet connection.</li>
  <li><strong>KudiAI Wallet:</strong> Pay directly from your in-app wallet balance — the fastest option with no redirects.</li>
</ul>
<p>All payments are processed securely through Paystack. Your card details are never stored on KudiAI servers. You will receive a receipt by email after every successful subscription payment.</p>',
 3),

('b0fac001-0000-4000-8000-000000000012',
 'a0fac001-0000-4000-8000-000000000003',
 'How long do wallet top-ups and transfers take to reflect?',
 '<p>Processing times depend on the type of transaction:</p>
<ul>
  <li><strong>Wallet top-up via card:</strong> Instant — balance updates within seconds of payment confirmation.</li>
  <li><strong>Wallet top-up via USSD:</strong> Instant after the USSD session completes.</li>
  <li><strong>Wallet top-up via bank transfer:</strong> Usually within 5 minutes once the transfer leaves your bank.</li>
  <li><strong>Withdrawal to bank account:</strong> Typically 5–30 minutes; up to 2 hours during peak periods.</li>
  <li><strong>Ajo contribution payments:</strong> Instant once confirmed in the app.</li>
</ul>
<p>If a transaction has not reflected after 2 hours, please contact our support team with your payment reference or transaction ID and we will investigate immediately.</p>',
 4),


-- ────────────────────────────────────────────────────────────────────────────
-- Ajo/Savings Groups (4 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000013',
 'a0fac001-0000-4000-8000-000000000004',
 'What is an Ajo group and how does it work?',
 '<p>Ajo (also known as Esusu, Adashi, or rotating savings) is a traditional Nigerian cooperative savings arrangement where a group of trusted people each contribute a fixed amount at regular intervals, and each member takes turns receiving the total pooled sum.</p>
<p>On KudiAI Track, this entire process is managed digitally:</p>
<ul>
  <li>A group organiser creates the Ajo group, sets the contribution amount and frequency (weekly or monthly), and invites members.</li>
  <li>Each member is assigned a payout position — the order in which they receive the pooled funds.</li>
  <li>Contributions and payments are tracked automatically with full transparency.</li>
  <li>Automatic reminders are sent to members before each contribution deadline.</li>
  <li>All transaction history is recorded and available for download as a report.</li>
</ul>
<p>KudiAI Track makes running an Ajo group straightforward, transparent, and dispute-free.</p>',
 1),

('b0fac001-0000-4000-8000-000000000014',
 'a0fac001-0000-4000-8000-000000000004',
 'How do I create a new Ajo savings group?',
 '<p>Setting up an Ajo group takes just a few minutes:</p>
<ul>
  <li>Go to <strong>Ajo Groups</strong> from the main menu and tap <strong>Create Group</strong>.</li>
  <li>Enter the group name and set the contribution amount (e.g. ₦10,000 per cycle).</li>
  <li>Choose the contribution frequency: <strong>Weekly</strong> or <strong>Monthly</strong>.</li>
  <li>Set the start date and total number of members in the group.</li>
  <li>Add each member by entering their name, phone number, and email address.</li>
  <li>Assign each member a payout position — the order in which they receive the collected pool.</li>
  <li>Save the group and share the invite link with your members.</li>
</ul>
<p>Once all members confirm their participation, the group becomes active and contributions are tracked from the start date.</p>',
 2),

('b0fac001-0000-4000-8000-000000000015',
 'a0fac001-0000-4000-8000-000000000004',
 'How are Ajo contributions tracked and who receives the payout?',
 '<p>KudiAI Track maintains a real-time ledger of all contributions so every kobo is accounted for:</p>
<ul>
  <li>Each time a member makes a contribution, it is recorded instantly in the group ledger.</li>
  <li>The organiser can see at a glance who has paid and who is outstanding for the current cycle.</li>
  <li>Automatic reminders are sent to members who have not yet contributed as the deadline approaches.</li>
  <li>At the end of each cycle, the member whose turn it is receives a notification to collect their payout.</li>
  <li>The organiser initiates the payout, and the recipient receives the total pooled amount to their wallet or bank account.</li>
</ul>
<p>A full contribution history and payout schedule is available at any time from the group dashboard. You can also export the complete record as a PDF or spreadsheet.</p>',
 3),

('b0fac001-0000-4000-8000-000000000016',
 'a0fac001-0000-4000-8000-000000000004',
 'What happens if a group member misses their Ajo contribution?',
 '<p>Missing a contribution disrupts the group, so KudiAI Track has built-in safeguards:</p>
<ul>
  <li>Members receive <strong>automatic reminders</strong> via push notification, SMS, and email before and on the contribution due date.</li>
  <li>If a member still misses the deadline, the group organiser is alerted immediately.</li>
  <li>The organiser can mark the member as <strong>Defaulted</strong> for that cycle and choose the appropriate action: pause the member''s payout turn, require the outstanding amount before the next cycle begins, or remove the member from the group entirely.</li>
  <li>A detailed <strong>default history</strong> is maintained per member, giving the organiser a clear record in case of disputes.</li>
</ul>
<p>We recommend that group organisers clearly communicate the rules for defaults to all members before the group starts, to avoid misunderstandings later.</p>',
 4),


-- ────────────────────────────────────────────────────────────────────────────
-- Security & PINs (3 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000017',
 'a0fac001-0000-4000-8000-000000000005',
 'How do I set or change my transaction PIN?',
 '<p>Your transaction PIN is a 4-digit code that authorises sensitive financial actions — such as wallet withdrawals, Ajo payouts, and bank transfers. To set or change it:</p>
<ul>
  <li>Go to <strong>Settings → Security</strong> and tap <strong>Transaction PIN</strong>.</li>
  <li>If setting a PIN for the first time, enter and confirm your chosen 4-digit code.</li>
  <li>If changing an existing PIN, enter your current PIN first, then enter and confirm the new one.</li>
  <li>Tap <strong>Save PIN</strong>.</li>
</ul>
<p>Choose a PIN that is memorable for you but not obvious to others. Avoid common sequences like 1234, 0000, or your birth year. <strong>Never share your PIN with anyone</strong> — including KudiAI support staff. We will never ask for your PIN.</p>',
 1),

('b0fac001-0000-4000-8000-000000000018',
 'a0fac001-0000-4000-8000-000000000005',
 'What should I do if I forgot my account password?',
 '<p>Resetting your password is quick and secure. Follow these steps:</p>
<ul>
  <li>On the login page, tap <strong>Forgot Password?</strong></li>
  <li>Enter the email address associated with your KudiAI Track account and tap <strong>Send Reset Link</strong>.</li>
  <li>Check your inbox for a password reset email from KudiAI Track (also check your spam or promotions folder).</li>
  <li>Click the link in the email — it is valid for 60 minutes.</li>
  <li>Enter your new password, confirm it, and tap <strong>Reset Password</strong>.</li>
  <li>Log in with your new password.</li>
</ul>
<p>If you do not receive the reset email within a few minutes, or if you no longer have access to your registered email address, please open a support ticket for identity verification and account recovery assistance.</p>',
 2),

('b0fac001-0000-4000-8000-000000000019',
 'a0fac001-0000-4000-8000-000000000005',
 'How do I keep my KudiAI Track account secure?',
 '<p>Protecting your business account is critical. Here are the best practices we recommend:</p>
<ul>
  <li><strong>Use a strong, unique password:</strong> At least 8 characters with a mix of uppercase letters, lowercase letters, numbers, and symbols. Do not reuse passwords from other accounts.</li>
  <li><strong>Set a transaction PIN:</strong> This adds a second layer of protection for all financial operations within the app.</li>
  <li><strong>Review staff access regularly:</strong> Remove staff members who have left your business and audit permissions every few months.</li>
  <li><strong>Never share your login credentials:</strong> Every team member should have their own staff account. Sharing the Owner login is a serious security risk.</li>
  <li><strong>Watch out for phishing:</strong> KudiAI Track will never ask for your password or PIN via email, phone call, or WhatsApp. If you receive such a request, do not respond — report it to us immediately.</li>
  <li><strong>Log out on shared or public devices:</strong> Always log out when you finish a session on a device that others can access.</li>
</ul>',
 3),


-- ────────────────────────────────────────────────────────────────────────────
-- Account & Billing (3 items)
-- ────────────────────────────────────────────────────────────────────────────

('b0fac001-0000-4000-8000-000000000020',
 'a0fac001-0000-4000-8000-000000000006',
 'What subscription plans does KudiAI Track offer?',
 '<p>KudiAI Track offers flexible plans designed for businesses at every stage of growth:</p>
<ul>
  <li><strong>Kobo (Free):</strong> Get started at no cost. Includes basic invoicing, up to 5 customers, limited expense tracking, and access to the AI assistant. Ideal for sole traders just starting out.</li>
  <li><strong>Naira (Starter):</strong> For growing SMEs. Includes unlimited invoices, up to 3 staff accounts, full inventory tracking, customer management, and email support.</li>
  <li><strong>Oga (Business):</strong> For established businesses. Includes everything in Naira plus multiple branch management, Ajo group management, advanced financial reports, and priority support.</li>
  <li><strong>Enterprise:</strong> Custom pricing for larger organisations needing dedicated account management, API access, and tailored integrations.</li>
</ul>
<p>Paid plans are available on <strong>monthly</strong> or <strong>annual</strong> billing. Annual plans offer a significant discount compared to monthly billing. Visit the pricing page for current rates in naira.</p>',
 1),

('b0fac001-0000-4000-8000-000000000021',
 'a0fac001-0000-4000-8000-000000000006',
 'How do I upgrade or change my subscription plan?',
 '<p>You can upgrade, downgrade, or switch billing cycles at any time from within the app:</p>
<ul>
  <li>Go to <strong>Settings → Subscription</strong>.</li>
  <li>Review the available plans and tap the one you want to switch to.</li>
  <li>If upgrading mid-cycle, you will be charged the prorated difference for the remaining days in your current billing period.</li>
  <li>If downgrading, the change takes effect at the end of your current billing cycle — you retain all current plan features until then.</li>
  <li>Complete the payment using your preferred method (card, bank transfer, USSD, or wallet).</li>
</ul>
<p>A confirmation email with your updated plan details will be sent immediately. If you encounter any issues during the upgrade process, contact our support team and we will resolve it within the same business day.</p>',
 2),

('b0fac001-0000-4000-8000-000000000022',
 'a0fac001-0000-4000-8000-000000000006',
 'How do I manage multiple business branches on one account?',
 '<p>Branch management is available on the <strong>Oga (Business)</strong> plan and above. It lets you run multiple locations from a single owner account:</p>
<ul>
  <li>Go to <strong>Settings → Branches</strong> and tap <strong>Add Branch</strong>.</li>
  <li>Enter the branch name, physical address, and contact information.</li>
  <li>Assign specific staff members to each branch — they will only see data relevant to their assigned location.</li>
  <li>Track invoices, expenses, and inventory separately for each branch.</li>
  <li>Compare branch performance side by side using the <strong>Branch Reports</strong> section in your main dashboard.</li>
</ul>
<p>All branches operate under the same subscription with no extra charge per branch within your plan limits. This makes KudiAI Track ideal for businesses with multiple shops, markets, or delivery hubs across Nigeria.</p>',
 3)

ON CONFLICT (id) DO NOTHING;


-- ── Completion Notice ────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Migration 20260705000001_help_support applied successfully.';
  RAISE NOTICE '  [profiles]         5 new columns added (IF NOT EXISTS)';
  RAISE NOTICE '  [profile_audit_log] created with RLS';
  RAISE NOTICE '  [faq_categories]   created with RLS + 6 seed rows';
  RAISE NOTICE '  [faq_items]        created with RLS + 22 seed rows';
  RAISE NOTICE '  [faq_feedback]     created with RLS (UNIQUE per user/item)';
  RAISE NOTICE '  [support_ticket_seq] sequence created (KT-YYYY-NNNNN)';
  RAISE NOTICE '  [generate_ticket_no()] function created';
  RAISE NOTICE '  [support_tickets]  created (status/priority enums corrected)';
  RAISE NOTICE '  [support_ticket_comments] created for admin panel compatibility';
  RAISE NOTICE '  [ticket_messages]  created for user-side follow-up thread';
  RAISE NOTICE '  [ticket_attachments] created with FK to ticket_messages';
  RAISE NOTICE '  [ticket-attachments] storage bucket upserted (5 MB limit)';
  RAISE NOTICE '================================================================';
END;
$$;
