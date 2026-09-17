-- ═════════════════════════════════════════════════════════════════════════════
-- ajo_entity_stats' esusu (rotating-group) branch computed "available" as
-- contribution - esusu_payout — the reverse of what a member can actually
-- withdraw. That formula answers "how much of my own contribution hasn't
-- come back to me yet," not "how much of my payout haven't I withdrawn yet."
-- For a member who's already been fully paid out, contribution - payout is
-- ~0, so this silently floors "available" at ₦0 for exactly the people who
-- most need to withdraw. It also mislabeled total_withdrawn as the payout
-- amount instead of actual withdrawals for this branch.
--
-- This RPC is the FINAL gate before a client withdrawal request is created
-- (ajo-portal/index.ts's request-withdrawal action, called after PIN
-- confirmation) — a client-side ceiling fix earlier this session corrected
-- the same formula in AjoMemberPortal.jsx's getGroupStats, but that only
-- gates the UI; this server-side copy was the one actually rejecting the
-- request. (The comment left on getGroupStats claiming this RPC "has no
-- other caller today" was wrong — it does, right here.)
--
-- Fix: track the esusu payout amount separately (v_received) from actual
-- withdrawals (v_withdrawn, now correctly withdrawal/disbursement only, for
-- every branch), and compute availability from whichever figure is actually
-- theirs to draw against — contribution for a personal cycle or savings
-- group, payout received for an esusu circle. total_saved keeps its
-- existing meaning (contribution) everywhere, so nothing that already reads
-- it changes; total_received is new and additive.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajo_entity_stats(p_client_id uuid, p_cycle_id uuid DEFAULT NULL, p_group_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saved      NUMERIC := 0;  -- amount THIS member contributed — same meaning in every branch
  v_received   NUMERIC := 0;  -- esusu payout paid TO this member (rotating groups only)
  v_withdrawn  NUMERIC := 0;  -- amount actually withdrawn/disbursed — same meaning in every branch
  v_fees       NUMERIC := 0;
  v_locked     NUMERIC := 0;
  v_pending    NUMERIC := 0;
  v_available  NUMERIC := 0;
  v_group_mode TEXT;
  v_credit     NUMERIC := 0;  -- basis for "available": contribution for a cycle/savings group, payout received for an esusu circle
BEGIN
  IF p_cycle_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN type = 'withdrawal'   THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN type IN ('commission', 'registration_fee', 'withdrawal_fee') THEN amount ELSE 0 END), 0)
    INTO v_saved, v_withdrawn, v_fees
    FROM ajo_contributions
    WHERE cycle_id = p_cycle_id AND aso_client_id = p_client_id AND status = 'completed';

    -- Scoped, per-cycle version of ajo_locked_cycle_amount's logic (that
    -- function aggregates across ALL of a client's active first_period
    -- cycles — a client can run several in parallel, so it can't be reused
    -- as-is for a single entity's figure).
    SELECT GREATEST(COALESCE(SUM(
      CASE c.type
        WHEN 'contribution'              THEN  c.amount
        WHEN 'commission'                THEN -c.amount
        WHEN 'registration_fee'          THEN -c.amount
        WHEN 'reversal_contribution'     THEN -c.amount
        WHEN 'reversal_commission'       THEN  c.amount
        WHEN 'reversal_registration_fee' THEN  c.amount
        ELSE 0
      END
    ), 0), 0)
    INTO v_locked
    FROM ajo_contributions c
    JOIN ajo_cycles cy ON cy.id = c.cycle_id
    WHERE c.cycle_id = p_cycle_id
      AND c.aso_client_id = p_client_id
      AND c.status = 'completed'
      AND cy.status = 'active'
      AND cy.commission_model = 'first_period'
      AND (
        cy.commission_balance >= cy.expected_amount_per_period
        OR EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      );

    SELECT COALESCE(SUM(amount), 0) INTO v_pending
      FROM ajo_withdrawal_requests
      WHERE cycle_id = p_cycle_id AND status IN ('pending', 'held_24h');

    v_credit := v_saved;

  ELSIF p_group_id IS NOT NULL THEN
    SELECT group_mode INTO v_group_mode FROM ajo_groups WHERE id = p_group_id;

    IF v_group_mode = 'rotating' THEN
      SELECT
        COALESCE(SUM(CASE WHEN type = 'contribution'                        THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type = 'esusu_payout'                        THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type IN ('withdrawal', 'disbursement')       THEN amount ELSE 0 END), 0)
      INTO v_saved, v_received, v_withdrawn
      FROM ajo_contributions
      WHERE group_id = p_group_id AND aso_client_id = p_client_id
        AND contribution_context = 'esusu_rotation' AND status = 'completed';

      -- Scoped, per-group version of ajo_locked_esusu_amount's logic.
      SELECT COALESCE(SUM(ac.amount), 0)
      INTO v_locked
      FROM ajo_contributions ac
      WHERE ac.aso_client_id = p_client_id
        AND ac.group_id = p_group_id
        AND ac.contribution_context = 'esusu_rotation'
        AND ac.type = 'contribution'
        AND ac.status = 'completed'
        AND ac.created_at >= (
          SELECT COALESCE(MIN(t.period_start), NOW() + INTERVAL '100 years')
          FROM ajo_group_turns t
          JOIN ajo_group_rounds r ON r.id = t.round_id AND r.status = 'active'
          WHERE t.status = 'current' AND r.group_id = p_group_id
        );

      v_credit := v_received;
    ELSE
      SELECT
        COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type IN ('withdrawal', 'disbursement') THEN amount ELSE 0 END), 0)
      INTO v_saved, v_withdrawn
      FROM ajo_contributions
      WHERE group_id = p_group_id AND aso_client_id = p_client_id
        AND contribution_context = 'group_savings' AND status = 'completed';

      -- Scoped, per-group version of ajo_locked_group_amount's logic.
      SELECT GREATEST(COALESCE(SUM(
        CASE c.type
          WHEN 'contribution'          THEN  c.amount
          WHEN 'reversal_contribution' THEN -c.amount
          WHEN 'disbursement'          THEN -c.amount
          WHEN 'withdrawal'            THEN -c.amount
          WHEN 'reversal_withdrawal'   THEN  c.amount
          WHEN 'group_release'         THEN -c.amount
          ELSE 0
        END
      ), 0), 0)
      INTO v_locked
      FROM ajo_contributions c
      WHERE c.aso_client_id = p_client_id
        AND c.group_id = p_group_id
        AND c.status = 'completed'
        AND (
          (c.type IN ('contribution', 'reversal_contribution')
           AND c.contribution_context = 'group_savings'
           AND EXISTS (SELECT 1 FROM ajo_groups g WHERE g.id = c.group_id AND g.round_status != 'closed'))
          OR
          (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal', 'group_release')
           AND c.contribution_context = 'group_savings')
        );

      v_credit := v_saved;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_pending
      FROM ajo_withdrawal_requests
      WHERE group_id = p_group_id AND status IN ('pending', 'held_24h');
  END IF;

  v_available := GREATEST(0, v_credit - v_withdrawn - v_fees - v_locked - v_pending);

  RETURN jsonb_build_object(
    'total_saved',     v_saved,
    'total_received',  v_received,
    'total_withdrawn', v_withdrawn,
    'fees',            v_fees,
    'locked',          v_locked,
    'pending',         v_pending,
    'available',       v_available
  );
END;
$function$;
