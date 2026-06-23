-- Cashback transactions: track earned and redeemed cashback per user (keyed by email)
CREATE TABLE cashback_transactions (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  text        NOT NULL,
  amount      numeric     NOT NULL,
  type        text        NOT NULL CHECK (type IN ('earned', 'redeemed')),
  bill_type   text,
  description text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE cashback_transactions ENABLE ROW LEVEL SECURITY;

-- Allow full access (amounts are small, email-keyed, business-layer security is sufficient)
CREATE POLICY "cashback_all" ON cashback_transactions
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX cashback_email_idx    ON cashback_transactions(user_email);
CREATE INDEX cashback_created_idx  ON cashback_transactions(created_at DESC);
