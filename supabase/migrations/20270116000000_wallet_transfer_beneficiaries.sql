-- ═════════════════════════════════════════════════════════════════════════════
-- Wallet banking-polish Phase B: saved recipients for bank transfers, reusing
-- bill_beneficiaries rather than a parallel table — the valuable part is the
-- mechanism (offline-first localStorage + remote sync + dedupe), already
-- generic over a `category`. account_no already exists on this table (shared
-- with spectranet/smile); bank_code/bank_name are the only genuinely new
-- columns a bank-transfer beneficiary needs.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE bill_beneficiaries
  ADD COLUMN IF NOT EXISTS bank_code TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT;
