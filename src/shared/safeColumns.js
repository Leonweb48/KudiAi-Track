// Columns the app may read from tables that also hold secrets (2026-10-13 security fix). Signed-in users have SELECT
// only on these columns: OTP codes, PIN hashes, session/portal tokens and BVN hashes/references are readable by the
// server functions alone (service role). So the app must never select("*") on aso_clients / staff / org_members —
// it would fail with "permission denied". When a migration adds a column the app needs, add it here too (the
// grant-sync job in 20270323 grants new non-secret columns automatically).
// Shared with the server copy (scripts/sync-shared.mjs); a service-role caller can read more, but doesn't need to.

export const ASO_CLIENT_COLUMNS =
  "id, user_id, full_name, phone, address, state, lga, contribution_frequency, contribution_amount, " +
  "registration_charge, withdrawal_fee_percent, total_saved, total_withdrawn, current_balance, " +
  "next_contribution_date, registration_date, notes, status, created_at, email, ward, profile_image_url, " +
  "transaction_history, nin, next_of_kin, next_of_kin_phone, next_of_kin_email, next_of_kin_address, staff_id, " +
  "branch_id, membership_number, portal_active, client_user_id, last_login_at, ajo_group_id, bank_code, " +
  "account_number, account_name, paystack_subaccount_code, paystack_subaccount_id, otp_expires_at, archived_at, " +
  "archived_by, bank_name, commission_model, commission_percent, pending_otp_expires_at, portal_pin_changed_at, " +
  "pending_archive, next_of_kin_name, created_by, withdrawal_bank_code, withdrawal_account_number, " +
  "withdrawal_bank_name, withdrawal_account_name, portal_pin_attempts, portal_pin_locked_until, " +
  "wallet_reminder_last_sent_at, bvn_verified, bvn_verified_name, bvn_verified_at, last_overdue_email_on";

export const STAFF_COLUMNS =
  "id, owner_id, user_id, full_name, email, phone, role, status, profile_image_url, created_at, branch_id, " +
  "otp_expires_at, address, nok_name, nok_phone, nok_relationship, shift_assignment, email_change_pending, " +
  "email_change_otp_expires_at, bvn_verified, bvn_verified_name, bvn_verified_at";

export const ORG_MEMBER_COLUMNS =
  "id, org_id, membership_id, full_name, email, phone, role, status, profile_image_url, address, occupation, " +
  "date_of_birth, joined_date, suspended_at, suspension_reason, removed_at, savings_balance, created_at, gender, " +
  "next_of_kin, next_of_kin_phone, privacy_balance, privacy_contributions, privacy_activities, must_change_pin, " +
  "user_id, otp_expires_at, avatar_url, chat_role, reputation_points, level, badge_count, message_count, " +
  "is_muted, muted_until, is_banned, banned_at, ban_reason, last_active_at, portal_active, archived_at, " +
  "member_session_expires_at, portal_pin_attempts, portal_pin_locked_until, withdrawal_bank_code, " +
  "withdrawal_bank_name, withdrawal_account_number, withdrawal_account_name, pin_reset_otp_exp";
