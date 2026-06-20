-- Add 'awaiting_response' status to support_tickets
-- This status is set when an admin requests additional information from the user.

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open','in_progress','escalated','awaiting_response','resolved','closed'));

-- Also broaden the type constraint to include all ticket types used in production
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_type_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_type_check
  CHECK (type IN ('account','payment','transaction','technical','subscription','general','compliance','marketing','ajo','organization'));

-- Add needs_info_message column to store the admin's question to the user
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS needs_info_message TEXT;
