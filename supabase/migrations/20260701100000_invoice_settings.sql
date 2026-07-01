-- ═══════════════════════════════════════════════════════════════
--  INVOICE SETTINGS — one-time setup per business: logo, reg no,
--  bank details, contact info, thank-you note.
--  Also updates next_invoice_number to return an integer counter
--  so client-side can format the new BIZ/CLIENT/MM/NNNN pattern.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url       text,
  reg_number     text,
  contact_email  text,
  contact_phone  text,
  address        text,
  bank_name      text,
  account_number text,
  account_name   text,
  thank_you_note text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_settings_select" ON public.invoice_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "invoice_settings_insert" ON public.invoice_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "invoice_settings_update" ON public.invoice_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Return integer counter so client formats BIZ/CLIENT/MM/(5000-seq)
DROP FUNCTION IF EXISTS public.next_invoice_number(uuid);
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO public.invoice_counters (user_id, last_seq)
  VALUES (p_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET last_seq = invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END;
$$;
