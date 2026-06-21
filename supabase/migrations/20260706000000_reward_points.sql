-- Add reward points balance to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS points_balance INTEGER NOT NULL DEFAULT 0;

-- Reward points history table
CREATE TABLE IF NOT EXISTS reward_points_log (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points           INTEGER     NOT NULL,
  transaction_type TEXT        NOT NULL CHECK (transaction_type IN ('earn','redeem','expire')),
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reward_points_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reward_points_log_select_own" ON reward_points_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "reward_points_log_insert_own" ON reward_points_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
