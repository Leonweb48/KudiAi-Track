-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase A: category schema foundation.
--
-- Today `category` only ever exists transiently in notify-send's request
-- body (used once to look up a CAT_PREF column, then discarded) — it was
-- never persisted on the notifications row. That's why the drawer can't
-- reliably color/icon by category and the push payload is identical for
-- every notification: there's no stored signal to key off. This migration
-- adds the column and backfills every historical row from its `type`,
-- covering the full 56-type inventory found in the pre-redesign audit.
--
-- Also adds 4 new notification_preferences columns (pref_credit, pref_alert,
-- pref_bills, pref_milestone) — needed now because notify-send's CAT_PREF
-- map is being extended in this same phase to cover the 4 new categories
-- that don't have an existing analogue (money/savings/stock/permissions/
-- approvals already did). Defaulting to true keeps every existing user's
-- behavior unchanged until the settings screen (a later phase) gives them
-- toggles for these.
--
-- Raw category taxonomy (9 values, matching notify-send's CAT_PREF):
-- money, savings, stock, permissions, approvals, credit, alert, bills,
-- milestone. "permissions" and "approvals" stay separate preference
-- columns (finer-grained than the 8-bucket visual palette) but both
-- render as the same Account/System bucket visually — see notify-send's
-- CATEGORY_META.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text;

UPDATE public.notifications SET category = CASE type
  -- ajo-write/index.ts
  WHEN 'staff_collection'                         THEN 'money'
  WHEN 'contribution_approved'                    THEN 'savings'
  WHEN 'collection_approved'                       THEN 'approvals'
  WHEN 'assigned_client_contribution_approved'    THEN 'approvals'
  WHEN 'cycle_matured'                            THEN 'savings'
  WHEN 'withdrawal_rejected'                      THEN 'money'
  WHEN 'assigned_client_withdrawal'               THEN 'money'
  WHEN 'assigned_client_withdrawal_approved'      THEN 'money'
  WHEN 'assigned_client_withdrawal_rejected'      THEN 'money'
  WHEN 'withdrawal_approved'                      THEN 'money'
  WHEN 'cycle_settled'                            THEN 'savings'
  WHEN 'contribution_reversed'                    THEN 'savings'
  WHEN 'deposit_confirmed'                        THEN 'money'
  WHEN 'deposit_rejected'                         THEN 'money'
  WHEN 'group_funds_released'                     THEN 'savings'
  WHEN 'payout_received'                          THEN 'savings'
  WHEN 'esusu_turn_skipped'                       THEN 'savings'
  WHEN 'reactivation_approved'                    THEN 'savings'
  WHEN 'reactivation_rejected'                    THEN 'savings'
  WHEN 'contribution_rejected'                    THEN 'savings'
  WHEN 'collection_rejected'                      THEN 'approvals'
  WHEN 'assigned_client_contribution_rejected'    THEN 'approvals'
  -- ajo-portal/index.ts
  WHEN 'withdrawal_request'                       THEN 'money'
  WHEN 'held_24h'                                 THEN 'money'
  WHEN 'manual_deposit'                           THEN 'money'
  WHEN 'assigned_client_deposit'                  THEN 'money'
  WHEN 'reactivation_request'                     THEN 'savings'
  WHEN 'ajo_registration_request'                 THEN 'savings' -- was tagged 'ajo' (bug, unmutable) — fixed here
  -- coop-portal/index.ts
  WHEN 'savings_recorded'                         THEN 'savings'
  WHEN 'savings_debited'                          THEN 'savings'
  WHEN 'disbursement_received'                    THEN 'money'
  WHEN 'coop_program'                             THEN 'savings'
  WHEN 'coop_loan'                                THEN 'credit'
  WHEN 'coop_broadcast'                           THEN 'savings'
  WHEN 'coop_support'                             THEN 'savings'
  WHEN 'coop_finance'                             THEN 'money'
  WHEN 'coop_savings'                             THEN 'savings'
  -- manage-staff-account / manage-staff-profile
  WHEN 'staff_invite'                             THEN 'permissions'
  WHEN 'email_changed'                            THEN 'permissions'
  -- peer-esusu/index.ts
  WHEN 'peer_esusu_invite'                        THEN 'savings'
  WHEN 'peer_esusu_invite_response'               THEN 'savings'
  WHEN 'peer_esusu_started'                       THEN 'savings'
  WHEN 'peer_esusu_contribution'                  THEN 'money'
  WHEN 'peer_esusu_payout_received'               THEN 'money'
  WHEN 'peer_esusu_round_paid'                    THEN 'savings'
  -- one-off / scheduled jobs
  WHEN 'bvn_reverification_required'              THEN 'money'
  WHEN 'wallet_activation_reminder'                THEN 'savings'
  WHEN 'verification_tier1_submitted'             THEN 'approvals'
  -- flutterwave-webhook/index.ts
  WHEN 'wallet_sale'                              THEN 'money'
  WHEN 'wallet_topup'                             THEN 'money'
  WHEN 'wallet_transfer_sent'                     THEN 'money'
  WHEN 'wallet_transfer_failed'                   THEN 'money'
  -- notifyEngine.js (client-triggered, owner/POS side)
  WHEN 'staff_cash_in'                            THEN 'money'
  WHEN 'staff_cash_out'                           THEN 'money'
  WHEN 'credit_created'                           THEN 'credit'
  WHEN 'credit_extended'                          THEN 'credit'
  WHEN 'credit_repayment'                         THEN 'credit'
  WHEN 'credit_completed'                         THEN 'credit'
  WHEN 'ajo_registration'                         THEN 'savings'
  WHEN 'invoice_created'                          THEN 'credit'
  WHEN 'invoice_sent'                             THEN 'credit'
  WHEN 'invoice_paid'                             THEN 'credit'
  WHEN 'branch_restock'                           THEN 'stock'
  WHEN 'low_stock'                                THEN 'stock'
  WHEN 'client_assigned'                          THEN 'permissions'
  WHEN 'shift_changed'                            THEN 'permissions'
  WHEN 'permission_change'                        THEN 'permissions'
  WHEN 'manager_perm_change'                      THEN 'permissions'
  WHEN 'approval_actioned'                        THEN 'approvals'
  WHEN 'approval_request_pending'                 THEN 'approvals'
  -- direct-SQL generic (manager_update_staff_permission / notify_owner_of_staff_change)
  WHEN 'info'                                     THEN 'permissions'
  -- ajo wallet payout cron (already tagged correctly this session)
  WHEN 'ajo_payout'                               THEN 'money'
  WHEN 'ajo_payout_failed'                        THEN 'money'
  WHEN 'ajo_payout_delayed'                       THEN 'savings'
  WHEN 'ajo_payout_shortfall'                     THEN 'money'
  -- confirmed-dead/orphaned types, backfilled defensively in case any stray row exists
  WHEN 'capital_transition'                       THEN 'money'
  WHEN 'credit_overdue'                           THEN 'credit'
  WHEN 'commission_processed'                     THEN 'money'
  WHEN 'manual_deposit_confirmed'                 THEN 'money'
  WHEN 'manual_deposit_rejected'                  THEN 'money'
  ELSE 'money'
END
WHERE category IS NULL;

-- ── notification_preferences: 4 new category columns ────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS pref_credit    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_alert     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_bills     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_milestone boolean NOT NULL DEFAULT true;
