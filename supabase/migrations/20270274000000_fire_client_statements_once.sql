-- Proves the scheduled path once, ahead of the first pg_cron window: pg_net → client-statements with the Vault's
-- cron_secret. It asks for LAST month (2026-09), which nobody is due (the first month sent is 2026-10), so nothing is
-- sent or recorded. The next migration reads the function's answer (counts only).
SELECT public.client_statements_trigger();
