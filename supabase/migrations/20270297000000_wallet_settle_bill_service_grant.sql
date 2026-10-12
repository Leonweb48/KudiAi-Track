-- The stuck bill-charge sweep (clubkonnect `bill-charge-sweep`, 2026-10-12) settles delivered orders' charges as the
-- service role. wallet_settle_bill was only granted to `authenticated` (20261205); make the service role's right
-- explicit. Harmless if it already had it. wallet_reverse_bill already has it.
GRANT EXECUTE ON FUNCTION public.wallet_settle_bill(UUID, UUID) TO service_role;
