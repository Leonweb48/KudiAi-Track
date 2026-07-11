-- Schedule nightly reconciliation now that pg_cron is enabled.
SELECT cron.schedule(
  'ajo-nightly-recon',
  '0 1 * * *',
  'SELECT ajo_run_reconciliation()'
);
