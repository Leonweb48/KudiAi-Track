-- sms-send switched from Sendchamp SMS to Sendchamp WhatsApp (SMS's "dnd"
-- route required a business-verification review that was taking too long;
-- WhatsApp's shared sender number works immediately). Add a channel column
-- so historical SMS-era rows stay correctly labeled and future rows record
-- which channel actually carried the message.

ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS channel text;
UPDATE sms_log SET channel = 'sms' WHERE channel IS NULL;
ALTER TABLE sms_log ALTER COLUMN channel SET DEFAULT 'whatsapp';
ALTER TABLE sms_log ALTER COLUMN channel SET NOT NULL;
